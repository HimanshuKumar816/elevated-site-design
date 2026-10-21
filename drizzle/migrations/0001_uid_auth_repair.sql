-- UID login repair migration for CampusFind / Elevated Site Design.
-- Safe to run against the project's intended Supabase database.
-- Creates the required schema if it is missing, reinstalls the profile trigger,
-- and backfills profiles for existing Auth users that have a UID in user metadata.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  uid text not null unique,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('Lost', 'Found')),
  name text not null,
  category text not null,
  location text not null,
  item_date date not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists profiles_uid_upper_idx on public.profiles (upper(uid));
create index if not exists items_created_at_idx on public.items (created_at desc);
create index if not exists items_user_id_idx on public.items (user_id);
create index if not exists items_type_idx on public.items (type);
create index if not exists items_category_idx on public.items (category);

grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select, insert, update, delete on public.items to authenticated;
grant all on public.items to service_role;

alter table public.profiles enable row level security;
alter table public.items enable row level security;

drop policy if exists "Signed-in users can view profiles" on public.profiles;
drop policy if exists "Users view own profile" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users view own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Signed-in users view items" on public.items;
drop policy if exists "Users add own items" on public.items;
drop policy if exists "Users update own items" on public.items;
drop policy if exists "Users delete own items" on public.items;
create policy "Signed-in users view items" on public.items
  for select to authenticated using (true);
create policy "Users add own items" on public.items
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users update own items" on public.items
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users delete own items" on public.items
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_uid text;
begin
  normalized_uid := upper(trim(coalesce(new.raw_user_meta_data->>'uid', '')));
  if normalized_uid = '' then
    raise exception 'A university UID is required to create a CampusFind profile';
  end if;

  insert into public.profiles (id, uid, full_name)
  values (
    new.id,
    normalized_uid,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), '')
  )
  on conflict (id) do update
    set uid = excluded.uid,
        full_name = excluded.full_name;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for existing Auth users whose metadata contains a UID.
-- Conflicts are intentionally skipped so duplicate UIDs are not silently reassigned.
insert into public.profiles (id, uid, full_name)
select
  u.id,
  upper(trim(u.raw_user_meta_data->>'uid')),
  coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), '')
from auth.users u
where nullif(trim(coalesce(u.raw_user_meta_data->>'uid', '')), '') is not null
on conflict do nothing;

commit;
