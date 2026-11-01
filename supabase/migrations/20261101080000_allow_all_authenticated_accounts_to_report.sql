
-- Allow any signed-in CampusFind account with a profile to submit Lost/Found
-- reports. Student identity verification and account role are not prerequisites.
-- Reports remain owned by auth.uid(); claims/handover retain their existing
-- verified-student restrictions.

create or replace function private.require_authenticated_item_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Privileged service operations without an end-user JWT remain available.
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only submit a report for your own signed-in account.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_authenticated_item_report() from public, anon, authenticated;

drop trigger if exists items_require_verified_student on public.items;
drop trigger if exists items_require_authenticated_account on public.items;
create trigger items_require_authenticated_account
before insert on public.items
for each row execute function private.require_authenticated_item_report();

drop policy if exists "Students add own items" on public.items;
drop policy if exists "Authenticated accounts add own items" on public.items;
create policy "Authenticated accounts add own items"
on public.items for insert to authenticated
with check (user_id = (select auth.uid()));

-- Image upload is allowed to any signed-in owner, in the owner's UUID folder.
drop policy if exists "Verified students upload their own item images" on storage.objects;
drop policy if exists "Students upload their own item images" on storage.objects;
drop policy if exists "Authenticated users upload their own item images" on storage.objects;
create policy "Authenticated users upload their own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Remove the now-unused role-specific reporting trigger function.
drop function if exists private.require_verified_student_report();
