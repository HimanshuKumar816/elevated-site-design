
-- Public RPCs stay SECURITY INVOKER. Their only privileged work is delegated to
-- private-schema SECURITY DEFINER functions with explicit administrator checks.

create or replace function private.apply_item_moderation(
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
revoke all on function private.apply_item_moderation(uuid,text,text) from public, anon, authenticated;
grant execute on function private.apply_item_moderation(uuid,text,text) to authenticated;

create or replace function public.admin_update_item_moderation(
  p_item_id uuid,
  p_flag text,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.apply_item_moderation(p_item_id, p_flag, p_note);
end;
$$;
revoke all on function public.admin_update_item_moderation(uuid,text,text) from public, anon;
grant execute on function public.admin_update_item_moderation(uuid,text,text) to authenticated;

-- Restore least privilege for direct writes; flag changes go only through the RPC.
revoke update (moderation_flag) on public.items from authenticated;
revoke insert on public.admin_item_moderation_notes from authenticated;

create or replace function private.apply_item_claim_decision(
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
revoke all on function private.apply_item_claim_decision(uuid,text,text,text) from public, anon, authenticated;
grant execute on function private.apply_item_claim_decision(uuid,text,text,text) to authenticated;

create or replace function public.admin_review_item_claim(
  p_claim_id uuid,
  p_status text,
  p_admin_note text default null,
  p_handover_code text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.apply_item_claim_decision(p_claim_id, p_status, p_admin_note, p_handover_code);
end;
$$;
revoke all on function public.admin_review_item_claim(uuid,text,text,text) from public, anon;
grant execute on function public.admin_review_item_claim(uuid,text,text,text) to authenticated;

-- Claim decision fields are writable only through the guarded private RPC.
revoke update on table public.item_claims from authenticated;
