-- Move CampusFind registration from CU email to verified phone OTP.
-- Delay profile creation until Supabase marks the phone as confirmed so an
-- unverified OTP request cannot reserve a UID in public.profiles.

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  normalized_uid text;
  normalized_name text;
BEGIN
  IF NEW.phone_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  normalized_uid := upper(trim(coalesce(NEW.raw_user_meta_data->>'uid', '')));
  normalized_name := trim(coalesce(NEW.raw_user_meta_data->>'full_name', ''));

  IF normalized_uid !~ '^[A-Z0-9]{5,20}$' THEN
    RAISE EXCEPTION 'A valid university UID is required';
  END IF;

  IF coalesce(NEW.phone, '') !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'A verified phone number is required';
  END IF;

  IF normalized_name = '' OR length(normalized_name) > 80 THEN
    RAISE EXCEPTION 'A valid full name is required';
  END IF;

  INSERT INTO public.profiles (id, uid, full_name)
  VALUES (NEW.id, normalized_uid, normalized_name)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_phone_confirmed ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER on_auth_user_phone_confirmed
  AFTER UPDATE OF phone_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();

COMMIT;
