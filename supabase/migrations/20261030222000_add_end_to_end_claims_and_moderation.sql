-- Report lifecycle and moderation state.
alter table public.items
  add column if not exists report_status text not null default 'new',
  add column if not exists moderation_flag text not null default 'none',
  add column if not exists moderation_note text,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null,
  add column if not exists moderated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_report_status_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_report_status_check
      check (report_status in ('new','under_review','matched','claimed','returned','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_moderation_flag_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_moderation_flag_check
      check (moderation_flag in ('none','duplicate','suspicious','hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_moderation_note_length_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_moderation_note_length_check
      check (moderation_note is null or char_length(moderation_note) <= 1000);
  end if;
end $$;

create index if not exists items_report_status_created_idx
  on public.items (report_status, created_at desc);
create index if not exists items_moderation_flag_idx
  on public.items (moderation_flag);

create table if not exists public.item_matches (
  id uuid primary key default gen_random_uuid(),
  lost_item_id uuid not null references public.items(id) on delete cascade,
  found_item_id uuid not null references public.items(id) on delete cascade,
  score integer check (score is null or score between 0 and 100),
  matching_method text not null default 'text-similarity'
    check (matching_method in ('text-similarity','ai','database-trigger','legacy-notification')),
  review_status text not null default 'pending'
    check (review_status in ('pending','confirmed','rejected','resolved')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint item_matches_distinct_items_check check (lost_item_id <> found_item_id),
  constraint item_matches_one_pair unique (lost_item_id, found_item_id)
);

create index if not exists item_matches_review_status_created_idx
  on public.item_matches (review_status, created_at desc);
create index if not exists item_matches_found_item_idx
  on public.item_matches (found_item_id);

create table if not exists public.item_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  proof text not null check (char_length(btrim(proof)) between 20 and 1500),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists item_claims_one_pending_per_user_item_idx
  on public.item_claims (item_id, claimant_id) where status = 'pending';
create unique index if not exists item_claims_one_approved_per_item_idx
  on public.item_claims (item_id) where status = 'approved';
create index if not exists item_claims_status_created_idx
  on public.item_claims (status, created_at desc);
create index if not exists item_claims_claimant_created_idx
  on public.item_claims (claimant_id, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('item','match','claim')),
  entity_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_entity_idx
  on public.admin_audit_logs (entity_type, entity_id, created_at desc);

alter table public.item_matches enable row level security;
alter table public.item_claims enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.item_matches from anon;
revoke all on table public.item_claims from anon;
revoke all on table public.admin_audit_logs from anon, authenticated;
grant select, update on table public.item_matches to authenticated;
grant select, insert, update on table public.item_claims to authenticated;
grant select on table public.admin_audit_logs to authenticated;
grant all on table public.item_matches, public.item_claims, public.admin_audit_logs to service_role;
grant update on table public.items to authenticated;

drop policy if exists "Users view visible reports and admins view all" on public.items;
drop policy if exists "Signed-in users view items" on public.items;
create policy "Users view visible reports and admins view all"
on public.items for select to authenticated
using (
  (select private.is_admin())
  or user_id = (select auth.uid())
  or (
    moderation_flag <> 'hidden'
    and report_status not in ('returned','closed')
  )
);

drop policy if exists "Admins update item reports" on public.items;
create policy "Admins update item reports"
on public.items for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Claimants and admins view item claims" on public.item_claims;
create policy "Claimants and admins view item claims"
on public.item_claims for select to authenticated
using (claimant_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "Students submit claims for other users found items" on public.item_claims;
create policy "Students submit claims for other users found items"
on public.item_claims for insert to authenticated
with check (
  claimant_id = (select auth.uid())
  and exists (
    select 1
    from public.items i
    where i.id = item_id
      and i.type = 'Found'
      and i.user_id <> (select auth.uid())
      and i.report_status in ('new','under_review','matched')
      and i.moderation_flag <> 'hidden'
  )
);

drop policy if exists "Admins review item claims" on public.item_claims;
create policy "Admins review item claims"
on public.item_claims for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Item owners and admins view possible matches" on public.item_matches;
create policy "Item owners and admins view possible matches"
on public.item_matches for select to authenticated
using (
  (select private.is_admin())
  or exists (select 1 from public.items i where i.id = lost_item_id and i.user_id = (select auth.uid()))
  or exists (select 1 from public.items i where i.id = found_item_id and i.user_id = (select auth.uid()))
);

drop policy if exists "Admins review possible item matches" on public.item_matches;
create policy "Admins review possible item matches"
on public.item_matches for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Admins view audit history" on public.admin_audit_logs;
create policy "Admins view audit history"
on public.admin_audit_logs for select to authenticated
using ((select private.is_admin()));

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items
for each row execute function private.set_updated_at();
drop trigger if exists item_claims_set_updated_at on public.item_claims;
create trigger item_claims_set_updated_at before update on public.item_claims
for each row execute function private.set_updated_at();

create or replace function private.audit_item_admin_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.report_status is distinct from new.report_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'report_status_changed',
      pg_catalog.jsonb_build_object('from', old.report_status, 'to', new.report_status));
  end if;
  if old.moderation_flag is distinct from new.moderation_flag
     or old.moderation_note is distinct from new.moderation_note then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'moderation_updated',
      pg_catalog.jsonb_build_object('from_flag', old.moderation_flag, 'to_flag', new.moderation_flag, 'note', new.moderation_note));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_item_admin_changes() from public, anon, authenticated;

drop trigger if exists items_audit_admin_changes on public.items;
create trigger items_audit_admin_changes
after update of report_status, moderation_flag, moderation_note on public.items
for each row execute function private.audit_item_admin_changes();

create or replace function private.handle_item_match_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_lost_owner uuid;
  v_found_owner uuid;
  v_lost_name text;
  v_found_name text;
begin
  if old.review_status is not distinct from new.review_status then return new; end if;

  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (coalesce(new.reviewed_by, auth.uid()), 'match', new.id, 'match_reviewed',
    pg_catalog.jsonb_build_object('from', old.review_status, 'to', new.review_status, 'score', new.score, 'note', new.admin_note));

  select user_id, name into v_lost_owner, v_lost_name from public.items where id = new.lost_item_id;
  select user_id, name into v_found_owner, v_found_name from public.items where id = new.found_item_id;

  if new.review_status = 'confirmed' then
    if exists (
      select 1 from public.items
      where id in (new.lost_item_id, new.found_item_id)
        and (moderation_flag <> 'none' or report_status in ('returned','closed'))
    ) then
      raise exception 'A closed or moderated report cannot be confirmed as a match.';
    end if;
    update public.items set report_status = 'matched'
    where id in (new.lost_item_id, new.found_item_id);
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Match confirmed by CampusFind', 'An administrator confirmed a possible match for your lost item: ' || coalesce(v_lost_name, 'your report') || '. Please follow the campus handover process.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Match confirmed by CampusFind', 'An administrator confirmed a possible match for your found item: ' || coalesce(v_found_name, 'your report') || '. Please follow the campus handover process.');
  elsif new.review_status = 'rejected' then
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Match reviewed', 'An administrator reviewed and dismissed this possible match. Your report remains active.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Match reviewed', 'An administrator reviewed and dismissed this possible match. Your report remains active.');
  elsif new.review_status = 'resolved' then
    update public.items set report_status = 'returned'
    where id in (new.lost_item_id, new.found_item_id);
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Item return recorded', 'CampusFind marked this matched item as returned. Thank you for helping reunite it with its owner.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Item return recorded', 'CampusFind marked this matched item as returned. Thank you for helping reunite it with its owner.');
  end if;

  new.reviewed_at := pg_catalog.now();
  new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  return new;
end;
$$;
revoke all on function private.handle_item_match_review() from public, anon, authenticated;

drop trigger if exists item_matches_handle_review on public.item_matches;
create trigger item_matches_handle_review before update of review_status on public.item_matches
for each row execute function private.handle_item_match_review();

create or replace function private.handle_item_claim_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_item_owner uuid;
  v_item_name text;
begin
  if old.status is not distinct from new.status then return new; end if;

  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (coalesce(new.reviewed_by, auth.uid()), 'claim', new.id, 'claim_reviewed',
    pg_catalog.jsonb_build_object('item_id', new.item_id, 'from', old.status, 'to', new.status, 'note', new.admin_note));

  select user_id, name into v_item_owner, v_item_name from public.items where id = new.item_id;

  if new.status = 'approved' then
    update public.items set report_status = 'claimed' where id = new.item_id;
    update public.item_claims
    set status = 'rejected',
        admin_note = coalesce(admin_note, 'Another claim was approved for this item.'),
        reviewed_by = coalesce(new.reviewed_by, auth.uid()),
        reviewed_at = pg_catalog.now()
    where item_id = new.item_id and id <> new.id and status = 'pending';
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was approved', 'An administrator approved your claim for ' || coalesce(v_item_name, 'the found item') || '. Follow the campus handover process to collect it.'),
      (v_item_owner, new.item_id, 'A claim was approved', 'An administrator approved a claim for your found-item report: ' || coalesce(v_item_name, 'your item') || '. Follow the campus handover process.');
  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was not approved', 'An administrator could not verify this claim for ' || coalesce(v_item_name, 'the found item') || '. Contact the CampusFind administrator if you have additional proof.');
  elsif new.status = 'completed' then
    update public.items set report_status = 'returned' where id = new.item_id;
    update public.item_matches
    set review_status = 'resolved',
        reviewed_by = coalesce(new.reviewed_by, auth.uid()),
        reviewed_at = pg_catalog.now(),
        admin_note = coalesce(admin_note, 'Return recorded after an approved claim.')
    where found_item_id = new.item_id and review_status = 'confirmed';
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Item return completed', 'CampusFind recorded this item as returned. Thank you for helping reunite it with its owner.'),
      (v_item_owner, new.item_id, 'Item return completed', 'CampusFind recorded your found item as returned.');
  end if;

  new.reviewed_at := coalesce(new.reviewed_at, pg_catalog.now());
  new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  return new;
end;
$$;
revoke all on function private.handle_item_claim_review() from public, anon, authenticated;

drop trigger if exists item_claims_handle_review on public.item_claims;
create trigger item_claims_handle_review before update of status on public.item_claims
for each row execute function private.handle_item_claim_review();

insert into public.item_matches (lost_item_id, found_item_id, matching_method)
select distinct
  case when a.type = 'Lost' then a.id else b.id end,
  case when a.type = 'Found' then a.id else b.id end,
  'legacy-notification'
from public.notifications n
join public.items a on a.id = n.item_id
join public.items b on b.id = n.matched_item_id
where n.matched_item_id is not null and a.type <> b.type
on conflict (lost_item_id, found_item_id) do nothing;

comment on table public.item_claims is 'Private claim evidence. Visible only to claimant and administrators.';
comment on table public.item_matches is 'Possible Lost/Found pairs requiring administrator review.';
comment on table public.admin_audit_logs is 'Administrator review history; private claim evidence is excluded.';
