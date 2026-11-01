
-- Link an approved AI Lost/Found match to the claimant's secure handover record.
alter table public.item_claims
  add column if not exists source_match_id uuid
  references public.item_matches(id) on delete set null;

create unique index if not exists item_claims_source_match_id_unique
  on public.item_claims(source_match_id)
  where source_match_id is not null;

grant select (source_match_id) on public.item_claims to authenticated;

-- Claims created from an AI match are only created by the administrator RPC.
-- Manual claim creation keeps the existing verified-student requirements.
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
  v_match_lost_id uuid;
  v_match_found_id uuid;
  v_match_status text;
begin
  if auth.uid() is null then return new; end if;

  if new.source_match_id is not null then
    if not private.is_admin() then
      raise exception 'Only an administrator can create a claim from a reviewed AI match.'
        using errcode = '42501';
    end if;

    select lost_item_id, found_item_id, review_status
      into v_match_lost_id, v_match_found_id, v_match_status
    from public.item_matches
    where id = new.source_match_id;

    if not found
       or v_match_lost_id is null
       or v_match_found_id is distinct from new.item_id
       or v_match_status <> 'pending'
       or not exists (
         select 1 from public.items l
         where l.id = v_match_lost_id
           and l.user_id = new.claimant_id
       ) then
      raise exception 'The AI match does not belong to this claimant and found item.'
        using errcode = '42501';
    end if;

    if not private.is_verified_student(new.claimant_id) then
      raise exception 'The Lost report owner must be verified before return approval.'
        using errcode = '42501';
    end if;
  else
    if new.claimant_id is distinct from auth.uid()
       or not private.is_verified_student(auth.uid()) then
      raise exception 'A verified student account is required to claim an item.'
        using errcode = '42501';
    end if;
  end if;

  select i.user_id, i.type, i.report_status, i.moderation_flag
    into v_owner_id, v_type, v_status, v_flag
  from public.items i
  where i.id = new.item_id;

  if not found
     or v_type <> 'Found'
     or v_owner_id = new.claimant_id
     or v_status not in ('new','under_review','matched')
     or v_flag <> 'none'
     or not private.is_verified_student(v_owner_id) then
    raise exception 'This found report is not currently eligible for a verified return.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function private.require_verified_student_claim() from public, anon, authenticated;

-- Both owners must be verified before an AI match may be approved.
-- The later handover-ordering migration tightens resolution to the verified
-- one-time code step performed by the existing claim completion RPC.
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
    raise exception 'Both report owners must be verified and their reports active before return approval.'
      using errcode = '42501';
  end if;

  if new.review_status = 'resolved'
     and old.review_status is distinct from new.review_status
     and not exists (
       select 1
       from public.item_claims c
       where c.item_id = new.found_item_id
         and c.status = 'completed'
     ) then
    raise exception 'A match can be marked returned only after the physical handover code is verified.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_verified_match_owners() from public, anon, authenticated;

-- One administrator action approves an AI candidate for return, creates or
-- reuses the matched claimant record, and causes the existing claim trigger to
-- generate the one-time handover code.
create or replace function public.admin_approve_item_match_for_return(
  p_match_id uuid,
  p_admin_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.item_matches%ROWTYPE;
  v_lost_user uuid;
  v_found_user uuid;
  v_lost_status text;
  v_found_status text;
  v_lost_flag text;
  v_found_flag text;
  v_claim_id uuid;
  v_claimant_id uuid;
  v_claim_status text;
  v_source_match_id uuid;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 1000 then
    raise exception 'Review note must be 1,000 characters or fewer.';
  end if;

  select * into v_match
  from public.item_matches
  where id = p_match_id
  for update;

  if not found then raise exception 'Possible match not found.'; end if;

  if v_match.review_status = 'confirmed' then
    select id into v_claim_id
    from public.item_claims
    where source_match_id = p_match_id
    limit 1;
    if v_claim_id is not null then return v_claim_id; end if;
    raise exception 'This match was already approved. Refresh the claims queue.';
  end if;

  if v_match.review_status <> 'pending' then
    raise exception 'Only pending AI suggestions can be approved.';
  end if;

  select l.user_id, f.user_id, l.report_status, f.report_status,
         l.moderation_flag, f.moderation_flag
    into v_lost_user, v_found_user, v_lost_status, v_found_status,
         v_lost_flag, v_found_flag
  from public.items l
  join public.items f on f.id = v_match.found_item_id
  where l.id = v_match.lost_item_id
    and l.type = 'Lost'
    and f.type = 'Found'
  for update of l, f;

  if not found
     or v_lost_user is null
     or v_found_user is null
     or v_lost_user = v_found_user
     or v_lost_status not in ('new','under_review','matched')
     or v_found_status not in ('new','under_review','matched')
     or v_lost_flag <> 'none'
     or v_found_flag <> 'none' then
    raise exception 'Both reports must still be active, unflagged Lost/Found reports from different accounts.';
  end if;

  if not private.is_verified_student(v_lost_user)
     or not private.is_verified_student(v_found_user) then
    raise exception 'Both report owners must complete student verification before return approval.';
  end if;

  if exists (
    select 1
    from public.item_matches other_match
    where other_match.id <> p_match_id
      and other_match.review_status = 'confirmed'
      and (
        other_match.lost_item_id = v_match.lost_item_id
        or other_match.found_item_id = v_match.found_item_id
      )
  ) then
    raise exception 'One of these reports is already paired with another approved match.';
  end if;

  -- Reuse a claimant's existing open claim where possible. Do not take a
  -- pending claim away from a different claimant.
  select c.id, c.claimant_id, c.status, c.source_match_id
    into v_claim_id, v_claimant_id, v_claim_status, v_source_match_id
  from public.item_claims c
  where c.item_id = v_match.found_item_id
    and c.status in ('pending','approved')
  order by c.created_at desc
  limit 1
  for update;

  if found then
    if v_claimant_id <> v_lost_user then
      raise exception 'A different claim already exists for this found item. Review that claim before approving this match.';
    end if;
    if v_source_match_id is not null and v_source_match_id <> p_match_id then
      raise exception 'This claim is already linked to another AI match.';
    end if;
    update public.item_claims
    set source_match_id = p_match_id,
        admin_note = coalesce(v_note, admin_note)
    where id = v_claim_id;
  else
    insert into public.item_claims (
      item_id, claimant_id, proof, status, admin_note, source_match_id
    ) values (
      v_match.found_item_id,
      v_lost_user,
      'System handover record created from an AI-suggested Lost/Found pair and approved by a CampusFind administrator. This is not independent proof of ownership. The administrator must verify the one-time code in person at handover.',
      'pending',
      v_note,
      p_match_id
    )
    returning id into v_claim_id;
    v_claim_status := 'pending';
  end if;

  update public.item_matches
  set review_status = 'confirmed',
      admin_note = coalesce(v_note, admin_note),
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now()
  where id = p_match_id;

  if v_claim_status = 'pending' then
    update public.item_claims
    set status = 'approved',
        admin_note = coalesce(v_note, admin_note),
        reviewed_by = auth.uid(),
        reviewed_at = pg_catalog.now()
    where id = v_claim_id;
  else
    update public.items
    set report_status = 'claimed'
    where id = v_match.found_item_id
      and report_status <> 'claimed';
  end if;

  -- One report pair can proceed to return at a time.
  update public.item_matches
  set review_status = 'rejected',
      admin_note = coalesce(admin_note, 'Another possible match for this report was approved.'),
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now()
  where id <> p_match_id
    and review_status = 'pending'
    and (
      lost_item_id = v_match.lost_item_id
      or found_item_id = v_match.found_item_id
    );

  return v_claim_id;
end;
$$;
revoke all on function public.admin_approve_item_match_for_return(uuid,text) from public, anon;
grant execute on function public.admin_approve_item_match_for_return(uuid,text) to authenticated;

create or replace function public.admin_reject_item_match(
  p_match_id uuid,
  p_admin_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_admin_note, '')), '');
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 1000 then
    raise exception 'Review note must be 1,000 characters or fewer.';
  end if;

  select review_status into v_status
  from public.item_matches
  where id = p_match_id
  for update;

  if not found then raise exception 'Possible match not found.'; end if;
  if v_status <> 'pending' then
    raise exception 'Only pending AI suggestions can be dismissed.';
  end if;

  update public.item_matches
  set review_status = 'rejected',
      admin_note = coalesce(v_note, admin_note),
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now()
  where id = p_match_id;
end;
$$;
revoke all on function public.admin_reject_item_match(uuid,text) from public, anon;
grant execute on function public.admin_reject_item_match(uuid,text) to authenticated;

-- All match state changes must go through the guarded administrator RPCs.
drop trigger if exists items_notify_possible_match on public.items;
drop function if exists public.notify_item_match();
revoke update on public.item_matches from authenticated;
