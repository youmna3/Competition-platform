-- Administrator-only invitations and judge-centric assignment management.
-- Auth invitation e-mails are sent by the Edge Function; no service key is
-- stored in the browser or database.

-- Defense in depth in addition to disabling signups in Supabase Auth settings:
-- new Auth identities must have been created through the invitation endpoint.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.invited_at is null then
    raise exception 'Public registration is disabled; an administrator invitation is required' using errcode='42501';
  end if;
  insert into public.profiles(id,email,full_name,role,status)
  values(new.id,new.email,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),200),'judge','pending')
  on conflict(id) do nothing;
  return new;
end;
$$;

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  email text not null,
  full_name text not null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  invited_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  last_sent_at timestamptz not null default now(),
  send_count int not null default 1 check (send_count > 0),
  constraint user_invitations_email_nonempty check (btrim(email) <> ''),
  constraint user_invitations_name_nonempty check (btrim(full_name) <> '')
);
create unique index user_invitations_active_email_key on public.user_invitations(lower(email)) where status = 'pending';
create index user_invitations_status_idx on public.user_invitations(status, expires_at);

alter table public.user_invitations enable row level security;
revoke all on public.user_invitations from anon, authenticated;
grant select on public.user_invitations to authenticated;
create policy user_invitations_admin_read on public.user_invitations for select to authenticated
  using ((select public.is_admin()));

-- Invited judges may be assigned before accepting, but RLS continues to hide
-- those teams until accept_my_invitation changes the profile to approved.
create or replace function public.guard_team_judge()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.judge_id and (
      p.status = 'approved'
      or (p.status = 'pending' and exists (
        select 1 from public.user_invitations i
        where i.auth_user_id = p.id and i.status = 'pending' and i.expires_at > now()
      ))
    )
  ) then
    raise exception 'Only approved or actively invited judge accounts can be assigned to teams' using errcode = 'P0001';
  end if;
  new.assigned_by := coalesce(new.assigned_by, auth.uid());
  return new;
end;
$$;

create or replace function public.admin_set_judge_teams(p_judge_id uuid, p_team_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_team uuid;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if not exists (select 1 from public.profiles where id=p_judge_id and role='judge') then
    raise exception 'Judge account not found';
  end if;
  if exists (select 1 from unnest(coalesce(p_team_ids,'{}'::uuid[])) as selected(team_id) where not exists(select 1 from public.teams where id=selected.team_id)) then
    raise exception 'One or more selected teams do not exist';
  end if;
  delete from public.team_judges where judge_id=p_judge_id and not (team_id=any(coalesce(p_team_ids,'{}'::uuid[])));
  foreach v_team in array coalesce(p_team_ids,'{}'::uuid[]) loop
    insert into public.team_judges(team_id,judge_id,assigned_by) values(v_team,p_judge_id,auth.uid()) on conflict do nothing;
  end loop;
end;
$$;

create or replace function public.admin_record_invitation(
  p_invitation_id uuid, p_auth_user_id uuid, p_email text, p_full_name text,
  p_expires_at timestamptz, p_team_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_resend boolean := p_invitation_id is not null;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if btrim(coalesce(p_email,''))='' or btrim(coalesce(p_full_name,''))='' then raise exception 'Name and e-mail are required'; end if;
  if p_expires_at <= now() then raise exception 'Invitation expiry must be in the future'; end if;
  update public.profiles set full_name=left(btrim(p_full_name),200),role='judge',status='pending' where id=p_auth_user_id;
  if not found then raise exception 'Invited Auth user profile was not created'; end if;
  if v_resend then
    update public.user_invitations set auth_user_id=p_auth_user_id,email=lower(btrim(p_email)),full_name=left(btrim(p_full_name),200),
      status='pending',invited_by=auth.uid(),invited_at=now(),expires_at=p_expires_at,accepted_at=null,revoked_at=null,last_sent_at=now(),send_count=send_count+1
      where id=p_invitation_id and status in ('pending','revoked') returning id into v_id;
    if v_id is null then raise exception 'Invitation cannot be resent'; end if;
  else
    insert into public.user_invitations(auth_user_id,email,full_name,invited_by,expires_at)
    values(p_auth_user_id,lower(btrim(p_email)),left(btrim(p_full_name),200),auth.uid(),p_expires_at) returning id into v_id;
  end if;
  perform public.admin_set_judge_teams(p_auth_user_id,coalesce(p_team_ids,'{}'::uuid[]));
  perform public._audit(case when v_resend then 'invitation.resent' else 'account.invited' end,'user_invitation',v_id::text,null,null,
    jsonb_build_object('auth_user_id',p_auth_user_id,'email',lower(btrim(p_email)),'expires_at',p_expires_at,'team_count',coalesce(array_length(p_team_ids,1),0)));
  return v_id;
end;
$$;

create or replace function public.admin_revoke_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  update public.user_invitations set status='revoked',revoked_at=now()
  where id=p_invitation_id and status='pending' returning email into v_email;
  if v_email is null then raise exception 'Pending invitation not found'; end if;
  perform public._audit('invitation.revoked','user_invitation',p_invitation_id::text,null,null,jsonb_build_object('email',v_email));
end;
$$;

create or replace function public.accept_my_invitation()
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode='28000'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and coalesce(encrypted_password,'')<>'') then
    raise exception 'Set a password before accepting the invitation';
  end if;
  select id,email into v_id,v_email from public.user_invitations
  where auth_user_id=auth.uid() and status='pending' and expires_at>now() for update;
  if v_id is null then raise exception 'No active invitation found'; end if;
  perform set_config('app.accepting_invitation','on',true);
  update public.profiles set status='approved' where id=auth.uid();
  update public.user_invitations set status='accepted',accepted_at=now() where id=v_id;
  perform public._audit('invitation.accepted','user_invitation',v_id::text,null,null,jsonb_build_object('email',v_email));
end;
$$;

-- Retain the last-administrator and ordinary self-update protections while
-- allowing only accept_my_invitation to activate an invited judge.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_accepting boolean := coalesce(current_setting('app.accepting_invitation',true),'')='on';
begin
  new.id:=old.id; new.created_at:=old.created_at;
  if old.role='admin' and old.status='approved' and (new.role<>'admin' or new.status<>'approved')
     and not exists(select 1 from public.profiles where role='admin' and status='approved' and id<>old.id) then
    raise exception 'Cannot remove or disable the last active administrator' using errcode='P0001';
  end if;
  if v_uid is not null and not public.is_admin() then
    if not (v_accepting and v_uid=old.id and old.role='judge' and new.role='judge' and old.status='pending' and new.status='approved'
      and new.email=old.email and new.reviewed_at is not distinct from old.reviewed_at and new.reviewed_by is not distinct from old.reviewed_by)
      and (new.role<>old.role or new.status<>old.status or new.email<>old.email or new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by) then
      raise exception 'Only administrators can change roles or approval status' using errcode='42501';
    end if;
  end if;
  if new.role<>old.role or new.status<>old.status then
    new.reviewed_at:=now(); new.reviewed_by:=case when v_accepting then null else v_uid end;
    perform public._audit('profile.access_changed','profile',old.id::text,null,null,jsonb_build_object('email',old.email,'old',jsonb_build_object('role',old.role,'status',old.status),'new',jsonb_build_object('role',new.role,'status',new.status)));
  end if;
  new.full_name:=left(btrim(new.full_name),200); return new;
end;
$$;

grant execute on function public.admin_set_judge_teams(uuid,uuid[]) to authenticated;
grant execute on function public.admin_record_invitation(uuid,uuid,text,text,timestamptz,uuid[]) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.accept_my_invitation() to authenticated;

