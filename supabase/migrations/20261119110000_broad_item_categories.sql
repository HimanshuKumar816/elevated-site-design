-- Use broad categories in the student UI while keeping existing reports searchable.
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
    and (
      coalesce(p_category, 'All') = 'All'
      or case
        when p_category = 'Personal Belongings' then lower(i.category) in ('personal belongings','id card','wallet','keys','bag','accessories')
        when p_category = 'Electronics & Technology' then lower(i.category) in ('electronics & technology','electronics')
        when p_category = 'Study Materials' then lower(i.category) in ('study materials','books')
        when p_category = 'Clothing & Wearables' then lower(i.category) in ('clothing & wearables','clothing')
        when p_category = 'Everyday Essentials' then lower(i.category) in ('everyday essentials','bottle')
        when p_category = 'Important Documents' then lower(i.category) in ('important documents','documents')
        when p_category = 'Other / Miscellaneous' then lower(i.category) in ('other / miscellaneous','other')
        else i.category = p_category
      end
    )
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
