-- Enforce the claim workflow at the database boundary.
-- Found reports may become claimed only after an approved claim issues a
-- one-time code, and returned only after the admin verifies that code.

-- BEFORE: audit status changes, generate the code on approval, reject sibling
-- claims and notify the parties. Do not change the item lifecycle here because
-- the claim row still has its previous status during a BEFORE trigger.
CREATE OR REPLACE FUNCTION private.handle_item_claim_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item_owner uuid;
  v_item_name text;
  v_handover_code text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  VALUES (
    COALESCE(NEW.reviewed_by, auth.uid()),
    'claim',
    NEW.id,
    'claim_reviewed',
    pg_catalog.jsonb_build_object(
      'item_id', NEW.item_id,
      'from', OLD.status,
      'to', NEW.status,
      'note', NEW.admin_note
    )
  );

  SELECT user_id, name
  INTO v_item_owner, v_item_name
  FROM public.items
  WHERE id = NEW.item_id;

  IF NEW.status = 'approved' THEN
    v_handover_code := pg_catalog.upper(
      pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12)
    );
    NEW.handover_code_hash := pg_catalog.md5(v_handover_code);

    UPDATE public.item_claims
    SET status = 'rejected',
        admin_note = COALESCE(admin_note, 'Another claim was approved for this item.'),
        reviewed_by = COALESCE(NEW.reviewed_by, auth.uid()),
        reviewed_at = pg_catalog.now()
    WHERE item_id = NEW.item_id
      AND id <> NEW.id
      AND status = 'pending';

    INSERT INTO public.notifications (user_id, item_id, title, body)
    VALUES
      (
        NEW.claimant_id,
        NEW.item_id,
        'Your item claim was approved',
        'An administrator approved your claim for ' || COALESCE(v_item_name, 'the found item') ||
        '. Your one-time handover code is ' || v_handover_code ||
        '. Show it to the CampusFind administrator at the actual handover. Do not share it beforehand.'
      ),
      (
        v_item_owner,
        NEW.item_id,
        'A claim was approved',
        'An administrator approved a claim for your found-item report: ' ||
        COALESCE(v_item_name, 'your item') ||
        '. The claimant must show a one-time code to an administrator during handover.'
      );

  ELSIF NEW.status = 'rejected' THEN
    INSERT INTO public.notifications (user_id, item_id, title, body)
    VALUES (
      NEW.claimant_id,
      NEW.item_id,
      'Your item claim was not approved',
      'An administrator could not verify this claim for ' ||
      COALESCE(v_item_name, 'the found item') ||
      '. Contact the CampusFind administrator if you have additional proof.'
    );
  END IF;

  NEW.reviewed_at := COALESCE(NEW.reviewed_at, pg_catalog.now());
  NEW.reviewed_by := COALESCE(NEW.reviewed_by, auth.uid());
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_item_claim_review() FROM PUBLIC, anon, authenticated;

-- AFTER: the claim row is now visible with its new state, so item lifecycle
-- changes can require that exact persisted approval/completion record.
CREATE OR REPLACE FUNCTION private.finalize_item_claim_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item_owner uuid;
  v_item_name text;
  v_item_status text;
  v_resolved_match_count integer := 0;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'approved' THEN
    IF NEW.handover_code_hash IS NULL THEN
      RAISE EXCEPTION 'An approved claim must have a one-time handover code.'
        USING ERRCODE = '42501';
    END IF;

    SELECT user_id, name, report_status
    INTO v_item_owner, v_item_name, v_item_status
    FROM public.items
    WHERE id = NEW.item_id
      AND type = 'Found'
    FOR UPDATE;

    IF NOT FOUND
       OR v_item_status NOT IN ('new', 'under_review', 'matched', 'claimed') THEN
      RAISE EXCEPTION 'The Found report is no longer eligible for claim approval.'
        USING ERRCODE = '42501';
    END IF;

    UPDATE public.items
    SET report_status = 'claimed'
    WHERE id = NEW.item_id
      AND report_status IS DISTINCT FROM 'claimed';

    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'approved'
     OR NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NEW;
  END IF;

  IF NEW.handover_code_hash IS NULL THEN
    RAISE EXCEPTION 'A completed claim must have a verified handover code.'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, name
  INTO v_item_owner, v_item_name
  FROM public.items
  WHERE id = NEW.item_id
    AND type = 'Found'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The Found report for this claim could not be found.'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.items
  SET report_status = 'returned'
  WHERE id = NEW.item_id
    AND report_status IS DISTINCT FROM 'returned';

  UPDATE public.item_matches
  SET review_status = 'resolved',
      reviewed_by = COALESCE(NEW.reviewed_by, auth.uid()),
      reviewed_at = pg_catalog.now(),
      admin_note = COALESCE(admin_note, 'Return recorded after the verified physical handover.')
  WHERE found_item_id = NEW.item_id
    AND review_status = 'confirmed';
  GET DIAGNOSTICS v_resolved_match_count = ROW_COUNT;

  -- The existing match-review trigger notifies both report owners when a
  -- confirmed AI match is resolved. Manual claims have no match row, so send
  -- their return notifications here.
  IF v_resolved_match_count = 0 THEN
    INSERT INTO public.notifications (user_id, item_id, title, body)
    VALUES
      (
        NEW.claimant_id,
        NEW.item_id,
        'Item return completed',
        'CampusFind recorded this item as returned. Thank you for helping reunite it with its owner.'
      ),
      (
        v_item_owner,
        NEW.item_id,
        'Item return completed',
        'CampusFind recorded your found item as returned.'
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_item_claim_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS item_claims_finalize_verified_return ON public.item_claims;
DROP TRIGGER IF EXISTS item_claims_finalize_workflow_state ON public.item_claims;
CREATE TRIGGER item_claims_finalize_workflow_state
AFTER UPDATE OF status ON public.item_claims
FOR EACH ROW
EXECUTE FUNCTION private.finalize_item_claim_lifecycle();

-- Defense in depth: public report creation must use the initial state. A Found
-- report can be marked claimed only when an approved claim with a code exists,
-- and returned only when that claim has been completed after code verification.
CREATE OR REPLACE FUNCTION private.require_claim_state_for_found_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.report_status IS DISTINCT FROM 'new'
       OR NEW.moderation_flag IS DISTINCT FROM 'none' THEN
      RAISE EXCEPTION 'New reports must begin in the New state without a moderation flag.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.type = 'Found'
     AND NEW.report_status = 'claimed'
     AND OLD.report_status IS DISTINCT FROM NEW.report_status
     AND NOT EXISTS (
       SELECT 1
       FROM public.item_claims AS claim
       WHERE claim.item_id = NEW.id
         AND claim.status IN ('approved', 'completed')
         AND claim.handover_code_hash IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'A Found report can be marked claimed only after a claim has been approved and its handover code issued.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.type = 'Found'
     AND NEW.report_status = 'returned'
     AND OLD.report_status IS DISTINCT FROM NEW.report_status
     AND NOT EXISTS (
       SELECT 1
       FROM public.item_claims AS claim
       WHERE claim.item_id = NEW.id
         AND claim.status = 'completed'
         AND claim.handover_code_hash IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'A Found report can be marked returned only after the administrator verifies the one-time handover code.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_claim_state_for_found_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS items_require_completed_handover_for_found_return ON public.items;
DROP TRIGGER IF EXISTS items_require_claim_state_for_found_lifecycle ON public.items;
CREATE TRIGGER items_require_claim_state_for_found_lifecycle
BEFORE INSERT OR UPDATE OF report_status ON public.items
FOR EACH ROW
EXECUTE FUNCTION private.require_claim_state_for_found_lifecycle();
