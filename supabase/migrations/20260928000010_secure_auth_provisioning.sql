-- Authorize Auth Admin user creation without relying on GoTrue fields that may
-- be populated only after auth.users has fired its INSERT trigger.

create table public.account_provisioning_requests (
  token_hash bytea primary key,
  email text not null,
  method text not null check (method in ('invitation','temporary_password')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint account_provisioning_email_nonempty check (btrim(email) <> ''),
  constraint account_provisioning_future_expiry check (expires_at > created_at)
);
create index account_provisioning_expiry_idx on public.account_provisioning_requests(expires_at)
  where consumed_at is null;

alter table public.account_provisioning_requests enable row level security;
revoke all on public.account_provisioning_requests from public, anon, authenticated;

-- Only an authenticated, approved administrator can mint a short-lived token.
-- Only its SHA-256 digest is stored and the raw token is never audited.
create or replace function public.admin_begin_account_provisioning(p_email text, p_method text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_token uuid := gen_random_uuid(); v_email text := lower(btrim(coalesce(p_email,'')));
begin
  if not public.is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
  if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'A valid e-mail is required';
  end if;
  if p_method not in ('invitation','temporary_password') then raise exception 'Unsupported provisioning method'; end if;
  if exists(select 1 from auth.users where lower(email)=v_email) then raise exception 'An account with this e-mail already exists'; end if;

  delete from public.account_provisioning_requests where expires_at < now() - interval '1 day';
  insert into public.account_provisioning_requests(token_hash,email,method,created_by,expires_at)
  values(digest(v_token::text,'sha256'),v_email,p_method,auth.uid(),now()+interval '5 minutes');
  perform public._audit('account.provisioning_authorized','profile',null,null,null,
    jsonb_build_object('email',v_email,'method',p_method));
  return v_token;
end;
$$;

-- The token travels in user_metadata because GoTrue includes that data in the
-- initial INSERT. User metadata itself is not trusted: it only carries a
-- random bearer value whose hash, e-mail, expiry and unused state are checked
-- against the protected table. Public clients cannot create or inspect rows.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text := coalesce(new.raw_user_meta_data->>'provisioning_token','');
  v_method text;
begin
  if v_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    update public.account_provisioning_requests
      set consumed_at=now()
      where token_hash=digest(lower(v_token),'sha256')
        and email=lower(new.email)
        and consumed_at is null
        and expires_at>now()
      returning method into v_method;
  end if;

  -- Retain safe compatibility with Auth implementations that do populate
  -- these server-controlled fields before INSERT. The Edge Function no longer
  -- relies on either fallback.
  if v_method is null and new.invited_at is not null then v_method := 'invitation'; end if;
  if v_method is null and coalesce(new.raw_app_meta_data->>'account_creation','')='temporary_password' then
    v_method := 'temporary_password';
  end if;
  if v_method is null then
    raise exception 'Public registration is disabled; administrator provisioning is required' using errcode='42501';
  end if;

  insert into public.profiles(id,email,full_name,role,status,password_change_required)
  values(
    new.id,
    new.email,
    left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),split_part(new.email,'@',1)),200),
    'judge',
    case when v_method='temporary_password' then 'approved'::public.account_status else 'pending'::public.account_status end,
    v_method='temporary_password'
  )
  on conflict(id) do nothing;
  return new;
end;
$$;

revoke all on function public.admin_begin_account_provisioning(text,text) from public, anon;
grant execute on function public.admin_begin_account_provisioning(text,text) to authenticated;

