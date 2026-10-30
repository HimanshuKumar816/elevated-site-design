-- Supabase may store phone numbers as digits without the leading '+' even when
-- the signup request was sent in E.164 format. Accept either representation,
-- while still enforcing international digits and length.
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
  IF NEW.phone_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  normalized_uid := upper(trim(coalesce(NEW.raw_user_meta_data->>'uid', '')));
  normalized_name := trim(coalesce(NEW.raw_user_meta_data->>'full_name', ''));

  IF normalized_uid !~ '^[A-Z0-9]{5,20}$' THEN
    RAISE EXCEPTION 'A valid university UID is required';
  END IF;

  IF NEW.phone IS NULL
     OR (
       left(NEW.phone, 1) = '+'
       AND substring(NEW.phone FROM 2) !~ '^[1-9][0-9]{7,14}$'
     )
     OR (
       left(NEW.phone, 1) <> '+'
       AND NEW.phone !~ '^[1-9][0-9]{7,14}$'
     ) THEN
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
