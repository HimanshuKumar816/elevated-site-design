
-- Allow signed-in student accounts to report lost and found items before
-- administrator identity verification. Claims and handover confirmation
-- remain restricted to verified student accounts.

create or replace function private.is_student(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.role = 'student'
  );
$$;
revoke all on function private.is_student(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_student(uuid) to authenticated;

create or replace function private.require_verified_student_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Privileged service operations without an end-user JWT remain available.
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid()
     or not private.is_student(auth.uid()) then
    raise exception 'A signed-in student account is required to submit reports.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_verified_student_report() from public, anon, authenticated;

-- Students may submit only their own reports; verification is not required.
drop policy if exists "Verified students add own items" on public.items;
drop policy if exists "Students add own items" on public.items;
create policy "Students add own items"
on public.items for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_student(auth.uid()))
);

-- Active, unflagged reports are visible on the board regardless of verification.
drop policy if exists "Users view visible reports and admins view all" on public.items;
create policy "Users view visible reports and admins view all"
on public.items for select to authenticated
using (
  (select private.is_admin())
  or user_id = (select auth.uid())
  or (
    moderation_flag = 'none'
    and report_status in ('new','under_review','matched')
  )
);

-- Retain existing search filters/sorting/pagination; remove verification gating.
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
language sql
stable
security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (
    select lower(btrim(coalesce(p_query, ''))) as value
  )
  select i.*
  from public.items i
  cross join query_text q
  where
    i.moderation_flag = 'none'
    and i.report_status in ('new','under_review','matched')
    and (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (coalesce(p_status, 'All') = 'All' or i.report_status = p_status)
    and (nullif(btrim(coalesce(p_location, '')), '') is null or i.location ilike '%' || btrim(p_location) || '%')
    and (p_date_from is null or i.item_date >= p_date_from)
    and (p_date_to is null or i.item_date <= p_date_to)
    and (
      not coalesce(p_saved_only, false)
      or exists (
        select 1 from public.saved_items s
        where s.item_id = i.id and s.user_id = (select auth.uid())
      )
    )
    and (
      q.value = ''
      or i.name ilike '%' || q.value || '%'
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

-- Match suggestions can include unverified reports; confirmation still requires
-- both report owners to be verified (private.require_verified_match_owners).
create or replace function public.notify_item_match()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  candidate public.items%ROWTYPE;
  match_score integer;
begin
  if coalesce(new.report_status, '') not in ('new', 'under_review', 'matched')
     or coalesce(new.moderation_flag, '') <> 'none' then
    return new;
  end if;

  for candidate in
    select i.*
    from public.items as i
    where i.user_id <> new.user_id
      and i.type <> new.type
      and i.report_status in ('new', 'under_review', 'matched')
      and i.moderation_flag = 'none'
      and i.created_at > pg_catalog.now() - pg_catalog.make_interval(days => 180)
      and (
        i.category = new.category
        or extensions.similarity(lower(i.name), lower(new.name)) >= 0.25
      )
    order by extensions.similarity(lower(i.name), lower(new.name)) desc
    limit 25
  loop
    match_score := 0;
    if candidate.category = new.category then
      match_score := match_score + 35;
    end if;
    match_score := match_score
      + round(extensions.similarity(lower(candidate.name), lower(new.name)) * 50)::integer;
    if extensions.similarity(lower(candidate.location), lower(new.location)) >= 0.2 then
      match_score := match_score + 15;
    end if;

    if match_score >= 45 then
      insert into public.notifications (user_id, item_id, matched_item_id, title, body)
      values (
        candidate.user_id, candidate.id, new.id,
        'Possible item match',
        'A new ' || lower(new.type) || ' report may match your ' || lower(candidate.type) || ' report: ' || new.name || '. Open CampusFind to compare details.'
      );
      insert into public.notifications (user_id, item_id, matched_item_id, title, body)
      values (
        new.user_id, new.id, candidate.id,
        'Possible item match',
        'Your ' || lower(new.type) || ' report may match an existing ' || lower(candidate.type) || ' report: ' || candidate.name || '. Open CampusFind to compare details.'
      );
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.notify_item_match() from public, anon, authenticated;

-- Allow signed-in students to upload their own report images before verification.
drop policy if exists "Verified students upload their own item images" on storage.objects;
drop policy if exists "Students upload their own item images" on storage.objects;
create policy "Students upload their own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.is_student(auth.uid()))
);

-- Keep hidden/inactive images private, but display images for all visible reports.
drop policy if exists "Users view only visible verified-student item images" on storage.objects;
drop policy if exists "Users view only visible item images" on storage.objects;
create policy "Users view only visible item images"
on storage.objects for select to authenticated
using (
  bucket_id = 'item-images'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.is_admin())
    or exists (
      select 1
      from public.items i
      where i.image_path = storage.objects.name
        and i.moderation_flag = 'none'
        and i.report_status in ('new','under_review','matched')
    )
  )
);
