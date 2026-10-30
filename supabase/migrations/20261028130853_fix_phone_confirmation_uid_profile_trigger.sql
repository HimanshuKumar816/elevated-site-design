-- Keep phone signup profile creation aligned with Supabase's verified phone OTP flow.
-- This migration is already applied to the production CampusFind Supabase project.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  normalized_uid text;
  normalized_name text;
BEGIN
  -- Profiles are created only after the phone number is confirmed.
  -- Supabase first inserts the unverified user, then updates phone_confirmed_at.
  IF NEW.phone_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  normalized_uid := upper(trim(coalesce(NEW.raw_user_meta_data->>'uid', '')));
  normalized_name := trim(coalesce(NEW.raw_user_meta_data->>'full_name', ''));

  IF normalized_uid !~ '^[A-Z0-9]{5,20}$' THEN
    RAISE EXCEPTION 'A valid university UID is required';
  END IF;

  -- Check the E.164 number without over-escaping the leading plus sign.
  IF NEW.phone IS NULL
     OR left(NEW.phone, 1) <> '+'
     OR substring(NEW.phone FROM 2) !~ '^[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'A valid phone number in E.164 format is required';
  END IF;

  IF normalized_name = '' OR length(normalized_name) > 80 THEN
    RAISE EXCEPTION 'A valid full name is required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.uid = normalized_uid AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'This university UID is already registered';
  END IF;

  INSERT INTO public.profiles (id, uid, full_name)
  VALUES (NEW.id, normalized_uid, normalized_name)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This university UID is already registered';
END;
$function$;
