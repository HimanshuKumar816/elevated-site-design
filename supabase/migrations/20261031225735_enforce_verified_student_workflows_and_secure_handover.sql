
-- Enforce verified-student access at the database boundary.
-- Existing reports, profiles, claims and notifications are retained unchanged.

create or replace function private.is_verified_student(p_user_id uuid)
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
      and p.verification_status = 'verified'
  );
$$;
revoke all on function private.is_verified_student(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_verified_student(uuid) to authenticated;

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
     or not private.is_verified_student(auth.uid()) then
    raise exception 'A verified student account is required to submit reports.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_verified_student_report() from public, anon, authenticated;
drop trigger if exists items_require_verified_student on public.items;
create trigger items_require_verified_student
before insert on public.items
for each row execute function private.require_verified_student_report();

create or replace function private.require_verified_student_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_type text;
  v_status text;
  v_flag text;
begin
  if auth.uid() is null then return new; end if;

  if new.claimant_id is distinct from auth.uid()
     or not private.is_verified_student(auth.uid()) then
    raise exception 'A verified student account is required to claim an item.'
      using errcode = '42501';
  end if;

  select i.user_id, i.type, i.report_status, i.moderation_flag
    into v_owner_id, v_type, v_status, v_flag
  from public.items i
  where i.id = new.item_id;

  if not found
     or v_type <> 'Found'
     or v_owner_id = auth.uid()
     or v_status not in ('new','under_review','matched')
     or v_flag <> 'none'
     or not private.is_verified_student(v_owner_id) then
    raise exception 'This found report is not currently eligible for a claim.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_verified_student_claim() from public, anon, authenticated;
drop trigger if exists item_claims_require_verified_student on public.item_claims;
create trigger item_claims_require_verified_student
before insert on public.item_claims
for each row execute function private.require_verified_student_claim();

-- Students can insert only their own reports after manual administrator verification.
drop policy if exists "Users add own items" on public.items;
create policy "Verified students add own items"
on public.items for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_verified_student(auth.uid()))
);

-- Public student browsing shows only active, unflagged reports owned by verified students.
-- Owners and administrators retain access to their own/private review records.
drop policy if exists "Users view visible reports and admins view all" on public.items;
create policy "Users view visible reports and admins view all"
on public.items for select to authenticated
using (
  (select private.is_admin())
  or user_id = (select auth.uid())
  or (
    moderation_flag = 'none'
    and report_status in ('new','under_review','matched')
    and (select private.is_verified_student(user_id))
  )
);

-- Claims require both the claimant and the found-item owner to be verified students.
drop policy if exists "Students submit claims for other users found items" on public.item_claims;
create policy "Verified students submit claims for verified students found items"
on public.item_claims for insert to authenticated
with check (
  claimant_id = (select auth.uid())
  and (select private.is_verified_student(auth.uid()))
  and exists (
    select 1
    from public.items i
    where i.id = item_id
      and i.type = 'Found'
      and i.user_id <> (select auth.uid())
      and i.report_status in ('new','under_review','matched')
      and i.moderation_flag = 'none'
      and (select private.is_verified_student(i.user_id))
  )
);

-- Re-create the student search function with the same descriptor/synonym search,
-- while applying the same visibility constraints as direct table access.
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
    and private.is_verified_student(i.user_id)
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

-- A newly detected match is generated only between verified students' visible reports.
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
     or coalesce(new.moderation_flag, '') <> 'none'
     or not private.is_verified_student(new.user_id) then
    return new;
  end if;

  for candidate in
    select i.*
    from public.items as i
    where i.user_id <> new.user_id
      and i.type <> new.type
      and i.report_status in ('new', 'under_review', 'matched')
      and i.moderation_flag = 'none'
      and private.is_verified_student(i.user_id)
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

-- Prevent admins from confirming a match if either report owner has lost verified status.
create or replace function private.require_verified_match_owners()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status = 'confirmed'
     and old.review_status is distinct from new.review_status
     and exists (
       select 1
       from public.items i
       where i.id in (new.lost_item_id, new.found_item_id)
         and (
           i.moderation_flag <> 'none'
           or i.report_status in ('returned','closed')
           or not private.is_verified_student(i.user_id)
         )
     ) then
    raise exception 'A match can only be confirmed for active, unflagged reports owned by verified students.';
  end if;
  return new;
end;
$$;
revoke all on function private.require_verified_match_owners() from public, anon, authenticated;
drop trigger if exists item_matches_zz_verify_owners on public.item_matches;
create trigger item_matches_zz_verify_owners
before update of review_status on public.item_matches
for each row execute function private.require_verified_match_owners();

-- Atomic moderation updates: all non-clear flags require an admin-only reason.
create or replace function public.admin_update_item_moderation(
  p_item_id uuid,
  p_flag text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_flag not in ('none','duplicate','suspicious','hidden') then
    raise exception 'Invalid moderation flag.';
  end if;
  if v_note is not null and (pg_catalog.char_length(v_note) < 3 or pg_catalog.char_length(v_note) > 1000) then
    raise exception 'Moderation reason must be 3–1,000 characters.';
  end if;
  if p_flag <> 'none' and v_note is null then
    raise exception 'Add a private reason before applying a moderation flag.';
  end if;

  update public.items
  set moderation_flag = p_flag,
      moderated_by = auth.uid(),
      moderated_at = pg_catalog.now()
  where id = p_item_id;
  if not found then raise exception 'Report not found.'; end if;

  if v_note is not null then
    insert into public.admin_item_moderation_notes (item_id, actor_id, note)
    values (p_item_id, auth.uid(), v_note);
  end if;
end;
$$;
revoke all on function public.admin_update_item_moderation(uuid,text,text) from public, anon;
grant execute on function public.admin_update_item_moderation(uuid,text,text) to authenticated;

-- A claim approval issues a one-time handover code. Only the claimant receives it.
alter table public.item_claims
  add column if not exists handover_code_hash text;

create or replace function private.handle_item_claim_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_owner uuid;
  v_item_name text;
  v_handover_code text;
begin
  if old.status is not distinct from new.status then return new; end if;

  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (coalesce(new.reviewed_by, auth.uid()), 'claim', new.id, 'claim_reviewed',
    pg_catalog.jsonb_build_object('item_id', new.item_id, 'from', old.status, 'to', new.status, 'note', new.admin_note));

  select user_id, name into v_item_owner, v_item_name from public.items where id = new.item_id;

  if new.status = 'approved' then
    v_handover_code := pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12));
    new.handover_code_hash := pg_catalog.md5(v_handover_code);

    update public.items set report_status = 'claimed' where id = new.item_id;
    update public.item_claims
    set status = 'rejected',
        admin_note = coalesce(admin_note, 'Another claim was approved for this item.'),
        reviewed_by = coalesce(new.reviewed_by, auth.uid()),
        reviewed_at = pg_catalog.now()
    where item_id = new.item_id and id <> new.id and status = 'pending';

    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was approved',
       'An administrator approved your claim for ' || coalesce(v_item_name, 'the found item') || '. Your one-time handover code is ' || v_handover_code || '. Show it to the CampusFind administrator at the actual handover. Do not share it beforehand.'),
      (v_item_owner, new.item_id, 'A claim was approved',
       'An administrator approved a claim for your found-item report: ' || coalesce(v_item_name, 'your item') || '. The claimant must show a one-time code to an administrator during handover.');

  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was not approved',
       'An administrator could not verify this claim for ' || coalesce(v_item_name, 'the found item') || '. Contact the CampusFind administrator if you have additional proof.');

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
      (new.claimant_id, new.item_id, 'Item return completed',
       'CampusFind recorded this item as returned. Thank you for helping reunite it with its owner.'),
      (v_item_owner, new.item_id, 'Item return completed',
       'CampusFind recorded your found item as returned.');
  end if;

  new.reviewed_at := coalesce(new.reviewed_at, pg_catalog.now());
  new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  return new;
end;
$$;
revoke all on function private.handle_item_claim_review() from public, anon, authenticated;

-- A single administrator RPC is the only client path to change claim decisions.
create or replace function public.admin_review_item_claim(
  p_claim_id uuid,
  p_status text,
  p_admin_note text default null,
  p_handover_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_code_hash text;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if p_status not in ('approved','rejected','completed') then
    raise exception 'Invalid claim decision.';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 1000 then
    raise exception 'Review note must be 1,000 characters or fewer.';
  end if;

  select status, handover_code_hash
    into v_current_status, v_code_hash
  from public.item_claims
  where id = p_claim_id
  for update;

  if not found then raise exception 'Claim not found.'; end if;

  if p_status in ('approved','rejected') and v_current_status <> 'pending' then
    raise exception 'Only pending claims can be approved or rejected.';
  end if;
  if p_status = 'completed' then
    if v_current_status <> 'approved' then
      raise exception 'Only an approved claim can be completed.';
    end if;
    if v_code_hash is null
       or p_handover_code is null
       or pg_catalog.length(pg_catalog.btrim(p_handover_code)) <> 12
       or pg_catalog.md5(pg_catalog.upper(pg_catalog.btrim(p_handover_code))) <> v_code_hash then
      raise exception 'The handover code is invalid. Ask the claimant to show the code from their approval notification.';
    end if;
  end if;

  update public.item_claims
  set status = p_status,
      admin_note = coalesce(v_note, admin_note),
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now()
  where id = p_claim_id;
end;
$$;
revoke all on function public.admin_review_item_claim(uuid,text,text,text) from public, anon;
grant execute on function public.admin_review_item_claim(uuid,text,text,text) to authenticated;

-- Never allow claim status or the handover hash to be changed via direct table updates.
revoke update on table public.item_claims from authenticated;
revoke select on table public.item_claims from authenticated;
grant select (
  id, item_id, claimant_id, proof, status, admin_note, created_at, reviewed_at,
  item_name_snapshot, item_location_snapshot, item_category_snapshot
) on table public.item_claims to authenticated;
-- Existing INSERT policy and column grants remain; service_role retains privileged access.

-- Reports keep normal status updates; moderation flags can only be changed through the guarded RPC.
revoke update on table public.items from authenticated;
grant update (report_status, moderated_by, moderated_at) on table public.items to authenticated;

-- Moderation notes are written atomically by the guarded RPC, not by direct client inserts.
revoke insert on table public.admin_item_moderation_notes from authenticated;

-- Keep hidden, duplicate and suspicious item images from being downloaded directly
-- through Storage URLs by ordinary students.
drop policy if exists "Authenticated users can view item images" on storage.objects;
create policy "Users view only visible verified-student item images"
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
        and (select private.is_verified_student(i.user_id))
    )
  )
);

drop policy if exists "Users upload their own item images" on storage.objects;
create policy "Verified students upload their own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (select private.is_verified_student(auth.uid()))
);

-- Add the missing FK index reported by Supabase. Leave low-usage indexes intact until traffic warrants review.
create index if not exists item_status_history_changed_by_idx
  on public.item_status_history (changed_by);
