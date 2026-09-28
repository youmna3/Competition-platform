-- Administrator-created accounts with one-time temporary passwords.
-- Passwords remain solely in Supabase Auth and are never stored in public tables.

alter table public.profiles
  add column if not exists password_change_required boolean not null default false;

-- A user is not application-approved until the mandatory password change is
-- complete, even though the account itself is active in Supabase Auth.
create or replace function public.is_approved_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and not password_change_required
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and status = 'approved' and not password_change_required
  );
$$;

-- Public signups still fail. The app_metadata marker can only be supplied by
-- the trusted Auth Admin API, unlike user_metadata supplied during signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_temporary boolean := coalesce(new.raw_app_meta_data->>'account_creation','') = 'temporary_password';
begin
  if new.invited_at is null and not v_temporary then
    raise exception 'Public registration is disabled; an administrator invitation is required' using errcode='42501';
  end if;
  insert into public.profiles(id,email,full_name,role,status,password_change_required)
  values(
    new.id,
    new.email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),200),
    'judge',
    case when v_temporary then 'approved'::public.account_status else 'pending'::public.account_status end,
    v_temporary
  )
  on conflict(id) do nothing;
  return new;
end;
$$;

create or replace function public.admin_record_temporary_user(
  p_auth_user_id uuid, p_email text, p_full_name text, p_team_ids uuid[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if btrim(coalesce(p_email,''))='' or btrim(coalesce(p_full_name,''))='' then raise exception 'Name and e-mail are required'; end if;
  update public.profiles
    set email=lower(btrim(p_email)), full_name=left(btrim(p_full_name),200), role='judge', status='approved'
    where id=p_auth_user_id and password_change_required;
  if not found then raise exception 'Temporary-password Auth user profile was not created'; end if;
  perform public.admin_set_judge_teams(p_auth_user_id,coalesce(p_team_ids,'{}'::uuid[]));
  perform public._audit('account.temporary_created','profile',p_auth_user_id::text,null,null,
    jsonb_build_object('email',lower(btrim(p_email)),'team_count',coalesce(array_length(p_team_ids,1),0),'password_change_required',true));
end;
$$;

-- This endpoint is intentionally service-role-only. The Edge Function changes
-- the Auth password first, then clears the application gate here.
create or replace function public.service_complete_password_change(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  update public.profiles set password_change_required=false
    where id=p_user_id and status='approved' and password_change_required
    returning email into v_email;
  if v_email is null then raise exception 'Password change is not required for this account'; end if;
  insert into public.audit_log(actor_id,actor_email,action,entity,entity_id,details)
  values(p_user_id,v_email,'account.password_changed','profile',p_user_id::text,jsonb_build_object('mandatory',true));
end;
$$;

revoke all on function public.admin_record_temporary_user(uuid,text,text,uuid[]) from public, anon;
grant execute on function public.admin_record_temporary_user(uuid,text,text,uuid[]) to authenticated;
revoke all on function public.service_complete_password_change(uuid) from public, anon, authenticated;
grant execute on function public.service_complete_password_change(uuid) to service_role;

