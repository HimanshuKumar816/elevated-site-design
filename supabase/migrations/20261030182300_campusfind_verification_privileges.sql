-- Restrict verification updates to specific columns and require admin RLS.
revoke update on table public.profiles from anon, authenticated;
grant update (verification_status, verified_at, verified_by) on table public.profiles to authenticated;

drop policy if exists "Admins update student verification" on public.profiles;
create policy "Admins update student verification"
on public.profiles for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create or replace function public.admin_set_student_verification(
  p_user_id uuid,
  p_verified boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  update public.profiles
  set verification_status = case when p_verified then 'verified' else 'unverified' end,
      verified_at = case when p_verified then pg_catalog.now() else null end,
      verified_by = case when p_verified then auth.uid() else null end
  where id = p_user_id and role = 'student';

  if not found then
    raise exception 'Student profile not found.';
  end if;
end;
$$;
revoke all on function public.admin_set_student_verification(uuid, boolean) from public, anon;
grant execute on function public.admin_set_student_verification(uuid, boolean) to authenticated;

create index if not exists profiles_verified_by_idx on public.profiles (verified_by);
