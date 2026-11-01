
-- During the BEFORE UPDATE claim trigger, the claim row still reads "approved".
-- The handover RPC validates the claimant's one-time code before setting
-- "completed"; the trigger may therefore resolve the pair while the claim is
-- still approved in the same transaction.
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
         and c.status in ('approved','completed')
         and c.handover_code_hash is not null
     ) then
    raise exception 'A match can be marked returned only after the physical handover code is verified.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function private.require_verified_match_owners() from public, anon, authenticated;
