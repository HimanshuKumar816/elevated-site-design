-- Production hardening for CampusFind auth and least-privilege access.
-- Apply to the configured Supabase project.
begin;

-- Profiles are only needed by the signed-in owner on the client. UID-to-email
-- resolution remains server-only; do not allow clients to enumerate all UIDs.
drop policy if exists "Signed-in users can view profiles" on public.profiles;
drop policy if exists "Users view own profile" on public.profiles;
create policy "Users view own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

-- No client-side profile editing is currently needed. This prevents a client
-- from changing its UID or profile identity through the public API.
drop policy if exists "Users update own profile" on public.profiles;
revoke update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Item updates are not part of the UI. Keep reports immutable to clients;
-- users can create and delete only their own reports.
drop policy if exists "Users update own items" on public.items;
revoke update on public.items from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_uid text;
  normalized_name text;
begin
  normalized_uid := upper(trim(coalesce(new.raw_user_meta_data->>'uid', '')));
  normalized_name := trim(coalesce(new.raw_user_meta_data->>'full_name', ''));

  if normalized_uid !~ '^[A-Z0-9]{5,20}$' then
    raise exception 'A valid university UID is required';
  end if;

  if lower(coalesce(new.email, '')) !~ '^[^@]+@cuchd[.]in$' then
    raise exception 'Use a Chandigarh University email address';
  end if;

  if length(normalized_name) > 80 then
    raise exception 'Full name must be at most 80 characters';
  end if;

  insert into public.profiles (id, uid, full_name)
  values (new.id, normalized_uid, normalized_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
commit;
