-- Optional judge governorate and secure helpers for administrator bulk account
-- creation. Passwords remain exclusively in Supabase Auth.

alter table public.profiles
  add column if not exists governorate_code text;

do $$
begin
  if not exists(select 1 from pg_constraint where conrelid='public.profiles'::regclass and conname='profiles_governorate_code_fkey') then
    alter table public.profiles add constraint profiles_governorate_code_fkey
      foreign key(governorate_code) references public.governorates(code) on delete restrict;
  end if;
end $$;

create index if not exists profiles_governorate_idx on public.profiles(governorate_code);

grant update (governorate_code) on public.profiles to authenticated;

-- Preserve the existing invitation-acceptance and last-admin safeguards while
-- making governorate an administrator-managed profile field.
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
      and new.email=old.email and new.governorate_code is not distinct from old.governorate_code
      and new.reviewed_at is not distinct from old.reviewed_at and new.reviewed_by is not distinct from old.reviewed_by)
      and (new.role<>old.role or new.status<>old.status or new.email<>old.email
        or new.governorate_code is distinct from old.governorate_code
        or new.reviewed_at is distinct from old.reviewed_at or new.reviewed_by is distinct from old.reviewed_by) then
      raise exception 'Only administrators can change roles, approval status or governorate' using errcode='42501';
    end if;
  end if;
  if new.role<>old.role or new.status<>old.status then
    new.reviewed_at:=now(); new.reviewed_by:=case when v_accepting then null else v_uid end;
    perform public._audit('profile.access_changed','profile',old.id::text,null,null,jsonb_build_object('email',old.email,'old',jsonb_build_object('role',old.role,'status',old.status),'new',jsonb_build_object('role',new.role,'status',new.status)));
  end if;
  if new.governorate_code is distinct from old.governorate_code then
    perform public._audit('profile.governorate_changed','profile',old.id::text,null,null,
      jsonb_build_object('email',old.email,'old_governorate',old.governorate_code,'new_governorate',new.governorate_code));
  end if;
  new.full_name:=left(btrim(new.full_name),200); return new;
end;
$$;

create or replace function public.admin_record_bulk_user(
  p_auth_user_id uuid, p_email text, p_full_name text, p_governorate_code text
) returns void language plpgsql security definer set search_path = public as $$
declare v_governorate text;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if btrim(coalesce(p_email,''))='' or btrim(coalesce(p_full_name,''))='' then raise exception 'Name and e-mail are required'; end if;
  select code into v_governorate from public.governorates where code=p_governorate_code;
  if v_governorate is null then raise exception 'Invalid governorate' using errcode='22023'; end if;
  update public.profiles set
    email=lower(btrim(p_email)), full_name=left(btrim(p_full_name),200), role='judge', status='approved',
    governorate_code=v_governorate, password_change_required=true
  where id=p_auth_user_id and password_change_required;
  if not found then raise exception 'Temporary-password Auth user profile was not created'; end if;
  perform public._audit('account.bulk_created','profile',p_auth_user_id::text,null,null,
    jsonb_build_object('email',lower(btrim(p_email)),'governorate_code',v_governorate,'password_change_required',true));
end;
$$;

-- Used only by the service-role Edge Function to validate Auth duplicates.
create or replace function public.service_existing_auth_emails(p_emails text[])
returns text[] language sql stable security definer set search_path = public, auth as $$
  select coalesce(array_agg(lower(u.email) order by lower(u.email)), '{}'::text[])
  from auth.users u
  where lower(u.email)=any(coalesce(p_emails,'{}'::text[]));
$$;

create or replace function public.admin_judges_page(
  p_filters jsonb default '{}'::jsonb, p_page int default 1, p_page_size int default 20
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_size int := public._page_size(p_page_size);
  v_offset int := (greatest(p_page,1)-1)*public._page_size(p_page_size);
  v_q text := lower(btrim(coalesce(p_filters->>'search','')));
  v_result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  with filtered as materialized (
    select p.*,
      count(tj.team_id)::int assigned,
      count(e.id) filter(where e.status='submitted')::int submitted,
      count(e.id) filter(where e.status='draft')::int drafts
    from public.profiles p
    left join public.team_judges tj on tj.judge_id=p.id
    left join public.evaluations e on e.team_id=tj.team_id and e.judge_id=p.id
    where (coalesce(p_filters->>'status','all')='all' or p.status::text=p_filters->>'status')
      and (coalesce(p_filters->>'governorate','')='' or p.governorate_code=p_filters->>'governorate')
      and (v_q='' or lower(p.full_name||' '||p.email) like '%'||v_q||'%')
    group by p.id
  ), paged as (
    select * from filtered order by lower(coalesce(full_name,email)),id offset v_offset limit v_size
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'::jsonb),
    'total',(select count(*) from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_record_bulk_user(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_record_bulk_user(uuid,text,text,text) to authenticated;
revoke all on function public.service_existing_auth_emails(text[]) from public,anon,authenticated;
grant execute on function public.service_existing_auth_emails(text[]) to service_role;
revoke all on function public.admin_judges_page(jsonb,int,int) from public,anon,authenticated;
grant execute on function public.admin_judges_page(jsonb,int,int) to authenticated;
