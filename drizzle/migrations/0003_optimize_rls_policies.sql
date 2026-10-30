-- Optimize RLS policy evaluation on the standalone Supabase project.
begin;
drop policy if exists "Users view own profile" on public.profiles;
create policy "Users view own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
drop policy if exists "Users add own items" on public.items;
create policy "Users add own items" on public.items
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete own items" on public.items;
create policy "Users delete own items" on public.items
  for delete to authenticated using ((select auth.uid()) = user_id);
commit;
