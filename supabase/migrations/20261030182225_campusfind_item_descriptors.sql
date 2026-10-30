-- Structured descriptors and expanded matching/search fields.
alter table public.items
  add column if not exists brand text not null default '',
  add column if not exists color text not null default '',
  add column if not exists model text not null default '',
  add column if not exists item_time text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='items_brand_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_brand_length_check check (char_length(brand) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_color_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_color_length_check check (char_length(color) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_model_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_model_length_check check (char_length(model) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_item_time_format_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_item_time_format_check check (item_time = '' or item_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

create index if not exists items_brand_color_idx on public.items (lower(brand), lower(color))
where brand <> '' or color <> '';

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
      or coalesce(i.brand, '') ilike '%' || q.value || '%'
      or coalesce(i.color, '') ilike '%' || q.value || '%'
      or coalesce(i.model, '') ilike '%' || q.value || '%'
      or extensions.similarity(lower(concat_ws(' ', i.name, i.category, i.location, coalesce(i.note, ''), coalesce(i.brand, ''), coalesce(i.color, ''), coalesce(i.model, ''))), q.value) >= 0.18
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
comment on function public.search_items_v2(text,text,text,text,integer,integer,text,text,date,date,boolean) is
  'Campus board search with typo tolerance, item descriptors, status, location, date and saved-only filters.';
