drop trigger if exists items_audit_admin_changes on public.items;
drop function if exists private.audit_item_admin_changes();
alter table public.items drop column if exists moderation_note;

create or replace function private.audit_item_admin_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.report_status is distinct from new.report_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'report_status_changed',
      pg_catalog.jsonb_build_object('from', old.report_status, 'to', new.report_status));
  end if;
  if old.moderation_flag is distinct from new.moderation_flag then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'moderation_flag_changed',
      pg_catalog.jsonb_build_object('from', old.moderation_flag, 'to', new.moderation_flag));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_item_admin_changes() from public, anon, authenticated;
create trigger items_audit_admin_changes
after update of report_status, moderation_flag on public.items
for each row execute function private.audit_item_admin_changes();

create table if not exists public.admin_item_moderation_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists admin_item_moderation_notes_item_created_idx
  on public.admin_item_moderation_notes (item_id, created_at desc);
alter table public.admin_item_moderation_notes enable row level security;
revoke all on table public.admin_item_moderation_notes from anon;
grant select, insert on table public.admin_item_moderation_notes to authenticated;
grant all on table public.admin_item_moderation_notes to service_role;

drop policy if exists "Admins read moderation notes" on public.admin_item_moderation_notes;
create policy "Admins read moderation notes"
on public.admin_item_moderation_notes for select to authenticated
using ((select private.is_admin()));
drop policy if exists "Admins add moderation notes" on public.admin_item_moderation_notes;
create policy "Admins add moderation notes"
on public.admin_item_moderation_notes for insert to authenticated
with check ((select private.is_admin()) and actor_id = (select auth.uid()));

create or replace function private.audit_moderation_note_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (new.actor_id, 'item', new.item_id, 'moderation_note_added',
    pg_catalog.jsonb_build_object('note', new.note, 'moderation_note_id', new.id));
  return new;
end;
$$;
revoke all on function private.audit_moderation_note_insert() from public, anon, authenticated;
drop trigger if exists admin_item_moderation_notes_audit on public.admin_item_moderation_notes;
create trigger admin_item_moderation_notes_audit
after insert on public.admin_item_moderation_notes
for each row execute function private.audit_moderation_note_insert();

alter table public.item_matches add column if not exists match_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='item_matches_reason_length_check' and conrelid='public.item_matches'::regclass) then
    alter table public.item_matches add constraint item_matches_reason_length_check
      check (match_reason is null or char_length(match_reason) <= 500);
  end if;
end $$;

create or replace function public.search_items(
  p_query text default null,
  p_type text default 'All',
  p_category text default 'All',
  p_sort text default 'newest',
  p_offset integer default 0,
  p_limit integer default 25
)
returns setof public.items
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (
    select lower(btrim(coalesce(p_query, ''))) as value
  )
  select i.*
  from public.items i
  cross join query_text q
  where
    (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (
      q.value = ''
      or i.name ilike '%' || q.value || '%'
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

revoke all on function public.search_items(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.search_items(text,text,text,text,integer,integer) to authenticated;
comment on function public.search_items(text,text,text,text,integer,integer) is
  'Paginated, RLS-respecting Lost/Found search with trigram typo tolerance and common item synonyms.';
