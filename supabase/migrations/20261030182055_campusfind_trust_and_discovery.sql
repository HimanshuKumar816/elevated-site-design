-- CampusFind trust, retention, saved reports, and discovery improvements.
drop policy if exists "Users delete own items" on public.items;

alter table public.item_claims
  add column if not exists item_name_snapshot text,
  add column if not exists item_location_snapshot text,
  add column if not exists item_category_snapshot text;

update public.item_claims c
set item_name_snapshot = coalesce(c.item_name_snapshot, i.name),
    item_location_snapshot = coalesce(c.item_location_snapshot, i.location),
    item_category_snapshot = coalesce(c.item_category_snapshot, i.category)
from public.items i
where i.id = c.item_id
  and (c.item_name_snapshot is null or c.item_location_snapshot is null or c.item_category_snapshot is null);

create or replace function private.snapshot_claimed_item()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select i.name, i.location, i.category
    into new.item_name_snapshot, new.item_location_snapshot, new.item_category_snapshot
  from public.items i where i.id = new.item_id;
  if new.item_name_snapshot is null then
    raise exception 'The found item is no longer available for claiming.';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_claimed_item() from public, anon, authenticated;
drop trigger if exists item_claims_snapshot_item on public.item_claims;
create trigger item_claims_snapshot_item before insert on public.item_claims
for each row execute function private.snapshot_claimed_item();

alter table public.profiles
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_verification_status_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_verification_status_check
      check (verification_status in ('unverified','verified'));
  end if;
end $$;

create index if not exists profiles_role_verification_idx
  on public.profiles (role, verification_status, created_at desc);

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_entity_type_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_entity_type_check
  check (entity_type in ('item','match','claim','profile'));

create or replace function private.audit_profile_verification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.verification_status is distinct from new.verification_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'profile', new.id, 'student_verification_changed',
      pg_catalog.jsonb_build_object('from', old.verification_status, 'to', new.verification_status));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_profile_verification() from public, anon, authenticated;
drop trigger if exists profiles_audit_verification on public.profiles;
create trigger profiles_audit_verification after update of verification_status on public.profiles
for each row execute function private.audit_profile_verification();

create or replace function public.admin_set_student_verification(p_user_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = ''
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
  if not found then raise exception 'Student profile not found.'; end if;
end;
$$;
revoke all on function public.admin_set_student_verification(uuid, boolean) from public, anon;
grant execute on function public.admin_set_student_verification(uuid, boolean) to authenticated;

create or replace function private.notify_report_owner_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_label text;
begin
  if old.report_status is not distinct from new.report_status then return new; end if;
  if pg_catalog.pg_trigger_depth() > 1 then return new; end if;
  v_label := case new.report_status
    when 'new' then 'New'
    when 'under_review' then 'Under review'
    when 'matched' then 'Possible match confirmed'
    when 'claimed' then 'Claim approved'
    when 'returned' then 'Returned'
    when 'closed' then 'Closed'
    else 'Updated'
  end;
  insert into public.notifications (user_id, item_id, title, body)
  values (new.user_id, new.id, 'Your report status changed',
    'An administrator updated "' || new.name || '" to: ' || v_label || '. Open My Reports to view the latest status.');
  return new;
end;
$$;
revoke all on function private.notify_report_owner_status_change() from public, anon, authenticated;
drop trigger if exists items_notify_owner_status_change on public.items;
create trigger items_notify_owner_status_change after update of report_status on public.items
for each row execute function private.notify_report_owner_status_change();

create table if not exists public.saved_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.saved_items enable row level security;
revoke all on table public.saved_items from anon;
grant select, insert, delete on table public.saved_items to authenticated;
drop policy if exists "Users manage their own saved items" on public.saved_items;
create policy "Users manage their own saved items" on public.saved_items for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Admins assign exact item locations" on public.item_locations;
drop policy if exists "Users add exact locations to their own reports" on public.item_locations;
create policy "Owners and admins add exact item locations" on public.item_locations for insert to authenticated
with check (
  ((select private.is_admin()) and exists (
    select 1 from public.items i where i.id = item_locations.item_id and i.user_id = item_locations.user_id
  ))
  or
  (item_locations.user_id = (select auth.uid()) and exists (
    select 1 from public.items i where i.id = item_locations.item_id and i.user_id = (select auth.uid())
  ))
);

drop policy if exists "Admins view possible item matches" on public.notifications;
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Owners and admins read notifications" on public.notifications for select to authenticated
using (user_id = (select auth.uid()) or ((select private.is_admin()) and matched_item_id is not null));

create index if not exists admin_audit_logs_actor_id_idx on public.admin_audit_logs (actor_id);
create index if not exists admin_item_moderation_notes_actor_id_idx on public.admin_item_moderation_notes (actor_id);
create index if not exists item_claims_reviewed_by_idx on public.item_claims (reviewed_by);
create index if not exists item_matches_reviewed_by_idx on public.item_matches (reviewed_by);
create index if not exists items_moderated_by_idx on public.items (moderated_by);
create index if not exists saved_items_item_id_idx on public.saved_items (item_id);
create index if not exists items_location_status_date_idx on public.items (location, report_status, item_date desc);

create or replace function public.search_items_v2(
  p_query text default null,
  p_type text default 'All',
  p_category text default 'All',
  p_sort text default 'newest',
  p_offset integer default 0,
  p_limit integer default 25,
  p_location text default null,
  p_status text default 'All',
  p_date_from date default null,
  p_date_to date default null,
  p_saved_only boolean default false
)
returns setof public.items
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (select lower(btrim(coalesce(p_query, ''))) as value)
  select i.* from public.items i cross join query_text q
  where
    (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (coalesce(p_status, 'All') = 'All' or i.report_status = p_status)
    and (nullif(btrim(coalesce(p_location, '')), '') is null or i.location ilike '%' || btrim(p_location) || '%')
    and (p_date_from is null or i.item_date >= p_date_from)
    and (p_date_to is null or i.item_date <= p_date_to)
    and (not coalesce(p_saved_only, false) or exists (
      select 1 from public.saved_items s where s.item_id = i.id and s.user_id = (select auth.uid())
    ))
    and (
      q.value = '' or i.name ilike '%' || q.value || '%'
      or i.category ilike '%' || q.value || '%'
      or i.location ilike '%' || q.value || '%'
      or coalesce(i.note, '') ilike '%' || q.value || '%'
      or extensions.similarity(lower(concat_ws(' ', i.name, i.category, i.location, coalesce(i.note, ''))), q.value) >= 0.18
      or (q.value in ('purse','billfold') and i.name ilike '%wallet%')
      or (q.value = 'wallet' and i.name ~* '(purse|billfold)')
      or (q.value in ('cell','cellphone','mobile','smartphone') and i.name ~* '(phone|mobile|smartphone)')
      or (q.value in ('phone','smartphone') and i.name ~* '(cell|mobile)')
      or (q.value in ('id','identity') and i.name ~* '(id card|identity card)')
      or (q.value in ('earbuds','earphones','headphones') and i.name ~* '(earbuds|earphones|headphones)')
      or (q.value in ('backpack','rucksack','bag') and i.name ~* '(backpack|rucksack|bag)')
      or (q.value in ('flask','water bottle') and i.name ~* '(bottle|flask)')
      or (q.value in ('laptop','notebook','computer') and i.name ~* '(laptop|notebook|computer)')
    )
  order by
    case when p_sort = 'name' then lower(i.name) end asc nulls last,
    case when p_sort = 'oldest' then i.item_date end asc nulls last,
    case when p_sort not in ('name','oldest') then i.item_date end desc nulls last,
    i.created_at desc
  limit least(greatest(coalesce(p_limit,25),1),51)
  offset greatest(coalesce(p_offset,0),0);
$$;
revoke all on function public.search_items_v2(text,text,text,text,integer,integer,text,text,date,date,boolean) from public, anon;
grant execute on function public.search_items_v2(text,text,text,text,integer,integer,text,text,date,date,boolean) to authenticated;
comment on table public.saved_items is 'Private bookmarks owned by each authenticated CampusFind student.';
