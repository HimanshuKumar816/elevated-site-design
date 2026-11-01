-- Prevent a Found report from being marked returned through the general
-- admin status dropdown. Completion is allowed only after the one-time
-- handover code has been checked by public.admin_review_item_claim().

-- Keep the BEFORE trigger responsible for auditing, generating the code on
-- approval, updating the claim status metadata, and notifications for
-- approval/rejection. Do not mark the item returned here: the claim row still
-- has its old status while a BEFORE trigger is running.
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

    UPDATE public.items
    SET report_status = 'claimed'
    WHERE id = NEW.item_id;

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

-- After the claim row has been written as completed, finalize the Found report
-- and resolve its confirmed match. The existing match guard now sees the
-- completed claim and its private handover hash.
CREATE OR REPLACE FUNCTION private.finalize_item_claim_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item_owner uuid;
  v_item_name text;
BEGIN
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

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_item_claim_return() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS item_claims_finalize_verified_return ON public.item_claims;
CREATE TRIGGER item_claims_finalize_verified_return
AFTER UPDATE OF status ON public.item_claims
FOR EACH ROW
EXECUTE FUNCTION private.finalize_item_claim_return();

-- Defense in depth: a Found report cannot be marked returned from a direct
-- table update, even by an authenticated administrator. The completed claim
-- is the durable record that the one-time handover code was checked.
CREATE OR REPLACE FUNCTION private.require_completed_handover_for_found_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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

REVOKE ALL ON FUNCTION private.require_completed_handover_for_found_return() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS items_require_completed_handover_for_found_return ON public.items;
CREATE TRIGGER items_require_completed_handover_for_found_return
BEFORE UPDATE OF report_status ON public.items
FOR EACH ROW
EXECUTE FUNCTION private.require_completed_handover_for_found_return();
