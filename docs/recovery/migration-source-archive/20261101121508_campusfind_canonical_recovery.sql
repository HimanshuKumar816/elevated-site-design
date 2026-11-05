-- Canonical CampusFind recovery migration.
-- This is one new, truthful migration event following the two exact ledger versions.
-- It consolidates the 25 archived, never-applied-on-this-project Supabase migrations
-- plus required Drizzle foundation objects. No profiles/items table is dropped or recreated.
-- Logical source order below resolves timestamp dependencies: claim/moderation and status
-- foundations precede trust/discovery; profile role schema is included without admin promotion.
-- Source SQL is archived unchanged at supabase/legacy-migrations/.

BEGIN;

-- Existing bucket settings or object keys must be reviewed, never overwritten.
DO $recovery$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'item-images') THEN
    RAISE EXCEPTION 'Preflight required: item-images bucket already exists; inspect before migration.';
  END IF;
END
$recovery$;


-- Foundation: 1. item image storage
-- Add optional item photos using a private Supabase Storage bucket.
-- Apply the private bucket only after the preflight confirms it is absent.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS image_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'item-images',
  'item-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users can view item images" ON storage.objects;
CREATE POLICY "Authenticated users can view item images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'item-images');

DROP POLICY IF EXISTS "Users upload their own item images" ON storage.objects;
CREATE POLICY "Users upload their own item images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Users delete their own item images" ON storage.objects;
CREATE POLICY "Users delete their own item images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );


-- Foundation: 2. notifications and matching
-- CampusFind smart-match alerts and private mobile notification preferences.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_number text,
  sms_notifications_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  matched_item_id uuid REFERENCES public.items(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notify_item_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  candidate public.items%ROWTYPE;
  match_score integer;
BEGIN
  FOR candidate IN
    SELECT i.*
    FROM public.items AS i
    WHERE i.user_id <> NEW.user_id
      AND i.type <> NEW.type
      AND (i.category = NEW.category OR similarity(lower(i.name), lower(NEW.name)) >= 0.25)
      AND i.created_at > now() - make_interval(days => 180)
    ORDER BY similarity(lower(i.name), lower(NEW.name)) DESC
    LIMIT 25
  LOOP
    match_score := 0;
    IF candidate.category = NEW.category THEN
      match_score := match_score + 35;
    END IF;
    match_score := match_score + round(similarity(lower(candidate.name), lower(NEW.name)) * 50)::integer;
    IF similarity(lower(candidate.location), lower(NEW.location)) >= 0.2 THEN
      match_score := match_score + 15;
    END IF;

    IF match_score >= 45 THEN
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        candidate.user_id, candidate.id, NEW.id,
        'Possible item match',
        'A new ' || lower(NEW.type) || ' report may match your ' || lower(candidate.type) || ' report: ' || NEW.name || '. Open CampusFind to compare details.'
      );
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        NEW.user_id, NEW.id, candidate.id,
        'Possible item match',
        'Your ' || lower(NEW.type) || ' report may match an existing ' || lower(candidate.type) || ' report: ' || candidate.name || '. Open CampusFind to compare details.'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS items_notify_possible_match ON public.items;
CREATE TRIGGER items_notify_possible_match
AFTER INSERT ON public.items
FOR EACH ROW EXECUTE FUNCTION public.notify_item_match();


-- Foundation: 3. notification grants
-- Production hardening: least-privilege notifications and private trigger function.
-- Apply to the configured Supabase project.

-- The matching routine is intended to run only as an items INSERT trigger.
-- Do not allow callers to invoke its SECURITY DEFINER body as an RPC.
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_item_match() TO service_role;

-- Students may mark their own notification as read, but should not be able
-- to rewrite notification content or reassign item references.
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (read_at) ON TABLE public.notifications TO authenticated;

-- Add covering indexes for the notification-to-item foreign keys.
CREATE INDEX IF NOT EXISTS notifications_item_id_idx
  ON public.notifications (item_id);
CREATE INDEX IF NOT EXISTS notifications_matched_item_id_idx
  ON public.notifications (matched_item_id);

-- Foundation: 4. notification RLS
-- Optimize user-scoped notification row-level security policies.
-- Apply to the configured Supabase project.

-- Evaluate the authenticated user's ID once per statement instead of once per
-- matching row in these user-scoped policies.
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences"
  ON public.notification_preferences
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.notifications;
CREATE POLICY "Users mark own notifications read"
  ON public.notifications
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Foundation: 5. trigram extension security
-- Move pg_trgm out of the API-exposed public schema and harden the trigger.
-- Apply to the configured Supabase project.

ALTER EXTENSION pg_trgm SET SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_item_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, pg_temp
AS $function$
DECLARE
  candidate public.items%ROWTYPE;
  match_score integer;
BEGIN
  FOR candidate IN
    SELECT i.*
    FROM public.items AS i
    WHERE i.user_id <> NEW.user_id
      AND i.type <> NEW.type
      AND (
        i.category = NEW.category
        OR extensions.similarity(lower(i.name), lower(NEW.name)) >= 0.25
      )
      AND i.created_at > now() - make_interval(days => 180)
    ORDER BY extensions.similarity(lower(i.name), lower(NEW.name)) DESC
    LIMIT 25
  LOOP
    match_score := 0;
    IF candidate.category = NEW.category THEN
      match_score := match_score + 35;
    END IF;
    match_score := match_score
      + round(extensions.similarity(lower(candidate.name), lower(NEW.name)) * 50)::integer;
    IF extensions.similarity(lower(candidate.location), lower(NEW.location)) >= 0.2 THEN
      match_score := match_score + 15;
    END IF;

    IF match_score >= 45 THEN
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        candidate.user_id, candidate.id, NEW.id,
        'Possible item match',
        'A new ' || lower(NEW.type) || ' report may match your ' || lower(candidate.type) || ' report: ' || NEW.name || '. Open CampusFind to compare details.'
      );
      INSERT INTO public.notifications (user_id, item_id, matched_item_id, title, body)
      VALUES (
        NEW.user_id, NEW.id, candidate.id,
        'Possible item match',
        'Your ' || lower(NEW.type) || ' report may match an existing ' || lower(candidate.type) || ' report: ' || candidate.name || '. Open CampusFind to compare details.'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_item_match() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.notify_item_match() TO service_role;

-- Foundation: 6. health check
-- Minimal invoker-only database health check for the Render readiness route.
-- It returns no application data and does not need a privileged credential.

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO pg_catalog
AS $function$
  SELECT true;
$function$;

REVOKE ALL ON FUNCTION public.health_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.health_check() TO anon, authenticated;

-- Foundation: 7. phone OTP triggers
-- Move CampusFind registration from CU email to verified phone OTP.
-- Delay profile creation until Supabase marks the phone as confirmed so an
-- unverified OTP request cannot reserve a UID in public.profiles.

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

-- Foundation: profile role schema and admin helper only; promotion is separate.
-- Trusted administrator role schema. The confirmed administrator assignment is a separate manual script.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'student';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('student', 'admin'));

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing profile SELECT/UPDATE/ALL policies to avoid broader overlapping rules.
DO $do$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd IN ('SELECT', 'UPDATE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END
$do$;

CREATE POLICY "Own profile or admin can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id OR (SELECT public.is_admin()));

-- The browser must never be able to insert or update profile identity/role fields.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Consolidated source 20261028130853_fix_phone_confirmation_uid_profile_trigger.sql
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


-- Consolidated source 20261028141000_accept_normalized_phone_in_signup_trigger.sql
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


-- Consolidated source 20261028145000_move_is_admin_helper_to_private_schema.sql
-- Move the SECURITY DEFINER admin helper out of the public PostgREST API schema.
-- RLS still uses it to allow administrators to view profiles; authenticated users
-- can execute it in SQL policy evaluation, but it is no longer exposed as /rpc/is_admin.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
  );
$function$;

REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

ALTER POLICY "Own profile or admin can view profiles"
ON public.profiles
USING (
  ((SELECT auth.uid()) = id)
  OR (SELECT private.is_admin())
);

DROP FUNCTION IF EXISTS public.is_admin();

-- Consolidated source 20261029130000_add_private_campus_locations_and_login_audit.sql
-- Record successful sign-ins for administrator visibility and keep exact map pins private.
-- The map bounds are a campus-area approximation around Chandigarh University, Gharuan.

CREATE TABLE IF NOT EXISTS public.login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  login_method text NOT NULL CHECK (login_method IN ('password', 'otp', 'signup')),
  logged_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_events_logged_in_at_idx
  ON public.login_events (logged_in_at DESC);
CREATE INDEX IF NOT EXISTS login_events_user_id_logged_in_at_idx
  ON public.login_events (user_id, logged_in_at DESC);

ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.login_events FROM anon, authenticated;
GRANT INSERT, SELECT ON TABLE public.login_events TO authenticated;

DROP POLICY IF EXISTS "Users record their own login events" ON public.login_events;
CREATE POLICY "Users record their own login events"
  ON public.login_events
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins view login events" ON public.login_events;
CREATE POLICY "Admins view login events"
  ON public.login_events
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

CREATE TABLE IF NOT EXISTS public.item_locations (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_locations_campus_bounds_check
    CHECK (
      latitude BETWEEN 30.761 AND 30.778
      AND longitude BETWEEN 76.560 AND 76.586
    )
);

CREATE INDEX IF NOT EXISTS item_locations_user_id_idx
  ON public.item_locations (user_id);

ALTER TABLE public.item_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.item_locations FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.item_locations TO authenticated;

DROP POLICY IF EXISTS "Owners and admins view exact item locations" ON public.item_locations;
CREATE POLICY "Owners and admins view exact item locations"
  ON public.item_locations
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS "Users add exact locations to their own reports" ON public.item_locations;
CREATE POLICY "Users add exact locations to their own reports"
  ON public.item_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1
      FROM public.items i
      WHERE i.id = item_id
        AND i.user_id = (SELECT auth.uid())
    )
  );

-- Consolidated source 20261029193957_admin_manage_campus_locations.sql
-- Allow verified administrators to assign or correct private campus pins for any report.
-- Public/student users still cannot write or view other users' exact coordinates.

GRANT UPDATE ON TABLE public.item_locations TO authenticated;

DROP POLICY IF EXISTS "Admins assign exact item locations" ON public.item_locations;
CREATE POLICY "Admins assign exact item locations"
  ON public.item_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = item_locations.item_id AND i.user_id = item_locations.user_id
    )
  );

DROP POLICY IF EXISTS "Admins update exact item locations" ON public.item_locations;
CREATE POLICY "Admins update exact item locations"
  ON public.item_locations
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK (
    (SELECT private.is_admin())
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.id = item_locations.item_id AND i.user_id = item_locations.user_id
    )
  );

-- Consolidated source 20261030143000_create_contact_messages.sql
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (
    char_length(email) between 3 and 254
    and email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
  ),
  subject text not null check (char_length(subject) between 3 and 160),
  message text not null check (char_length(message) between 10 and 5000),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

revoke all on table public.contact_messages from anon, authenticated;
grant select on table public.contact_messages to authenticated;
grant all on table public.contact_messages to service_role;

drop policy if exists "Admins view contact messages" on public.contact_messages;
create policy "Admins view contact messages"
on public.contact_messages
for select
to authenticated
using ((select private.is_admin()));

comment on table public.contact_messages is
  'Contact form messages. Inserts are performed by the server-side contact Edge Function; only admins can read.';


-- Consolidated source 20261030150000_add_database_input_constraints.sql
alter table public.items
  add constraint items_name_length_check
    check (char_length(btrim(name)) between 1 and 120) not valid,
  add constraint items_category_length_check
    check (char_length(btrim(category)) between 1 and 60) not valid,
  add constraint items_location_length_check
    check (char_length(btrim(location)) between 1 and 160) not valid,
  add constraint items_note_length_check
    check (char_length(coalesce(note, '')) <= 500) not valid,
  add constraint items_type_allowed_check
    check (type in ('Lost', 'Found')) not valid;

alter table public.items
  validate constraint items_name_length_check,
  validate constraint items_category_length_check,
  validate constraint items_location_length_check,
  validate constraint items_note_length_check,
  validate constraint items_type_allowed_check;

alter table public.profiles
  add constraint profiles_uid_format_check
    check (uid ~ '^[A-Z0-9]{5,20}$') not valid,
  add constraint profiles_full_name_length_check
    check (char_length(btrim(full_name)) between 1 and 80) not valid;

alter table public.profiles
  validate constraint profiles_uid_format_check,
  validate constraint profiles_full_name_length_check;

alter table public.item_locations
  add constraint item_locations_inside_campus_check
    check (
      latitude between 30.761 and 30.778
      and longitude between 76.560 and 76.586
    ) not valid;

alter table public.item_locations
  validate constraint item_locations_inside_campus_check;

comment on constraint item_locations_inside_campus_check on public.item_locations
  is 'Ensures exact pins remain inside the configured Chandigarh University campus bounds.';


-- Consolidated source 20261030160000_add_shared_edge_rate_limits.sql
create table if not exists private.edge_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start bigint not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (key_hash, window_start)
);

alter table private.edge_rate_limits enable row level security;
revoke all on table private.edge_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_edge_rate_limit(
  p_key_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start bigint;
  v_request_count integer;
begin
  if p_key_hash !~ '^[a-f0-9]{64}$'
     or p_window_seconds < 1
     or p_window_seconds > 86400
     or p_max_requests < 1
     or p_max_requests > 10000 then
    return false;
  end if;

  v_window_start := pg_catalog.floor(
    extract(epoch from pg_catalog.now()) / p_window_seconds
  )::bigint;

  insert into private.edge_rate_limits as existing (
    key_hash, window_start, request_count, updated_at
  )
  values (p_key_hash, v_window_start, 1, pg_catalog.now())
  on conflict (key_hash, window_start)
  do update set
    request_count = existing.request_count + 1,
    updated_at = pg_catalog.now()
  returning request_count into v_request_count;

  if pg_catalog.random() < 0.01 then
    delete from private.edge_rate_limits
    where updated_at < pg_catalog.now() - interval '1 day';
  end if;

  return v_request_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer)
  to service_role;

comment on table private.edge_rate_limits is
  'Stores hashed per-endpoint client keys for atomic rate limiting across Edge Function instances.';
comment on function public.consume_edge_rate_limit(text, integer, integer) is
  'Atomically consumes a request in a fixed-window limit. Execution is restricted to service_role.';


-- Consolidated source 20261030170000_admin_view_possible_item_matches.sql
drop policy if exists "Admins view possible item matches" on public.notifications;

create policy "Admins view possible item matches"
on public.notifications
for select
to authenticated
using (
  (select private.is_admin())
  and matched_item_id is not null
);

comment on policy "Admins view possible item matches" on public.notifications is
  'Allows administrators to view only notification rows that link a possible Lost/Found item match.';



-- Consolidated source 20261030222000_add_end_to_end_claims_and_moderation.sql
-- Report lifecycle and moderation state.
alter table public.items
  add column if not exists report_status text not null default 'new',
  add column if not exists moderation_flag text not null default 'none',
  add column if not exists moderation_note text,
  add column if not exists moderated_by uuid references auth.users(id) on delete set null,
  add column if not exists moderated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'items_report_status_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_report_status_check
      check (report_status in ('new','under_review','matched','claimed','returned','closed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_moderation_flag_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_moderation_flag_check
      check (moderation_flag in ('none','duplicate','suspicious','hidden'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'items_moderation_note_length_check' and conrelid = 'public.items'::regclass) then
    alter table public.items add constraint items_moderation_note_length_check
      check (moderation_note is null or char_length(moderation_note) <= 1000);
  end if;
end $$;

create index if not exists items_report_status_created_idx
  on public.items (report_status, created_at desc);
create index if not exists items_moderation_flag_idx
  on public.items (moderation_flag);

create table if not exists public.item_matches (
  id uuid primary key default gen_random_uuid(),
  lost_item_id uuid not null references public.items(id) on delete cascade,
  found_item_id uuid not null references public.items(id) on delete cascade,
  score integer check (score is null or score between 0 and 100),
  matching_method text not null default 'text-similarity'
    check (matching_method in ('text-similarity','ai','database-trigger','legacy-notification')),
  review_status text not null default 'pending'
    check (review_status in ('pending','confirmed','rejected','resolved')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint item_matches_distinct_items_check check (lost_item_id <> found_item_id),
  constraint item_matches_one_pair unique (lost_item_id, found_item_id)
);

create index if not exists item_matches_review_status_created_idx
  on public.item_matches (review_status, created_at desc);
create index if not exists item_matches_found_item_idx
  on public.item_matches (found_item_id);

create table if not exists public.item_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  proof text not null check (char_length(btrim(proof)) between 20 and 1500),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 1000),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists item_claims_one_pending_per_user_item_idx
  on public.item_claims (item_id, claimant_id) where status = 'pending';
create unique index if not exists item_claims_one_approved_per_item_idx
  on public.item_claims (item_id) where status = 'approved';
create index if not exists item_claims_status_created_idx
  on public.item_claims (status, created_at desc);
create index if not exists item_claims_claimant_created_idx
  on public.item_claims (claimant_id, created_at desc);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  entity_type text not null check (entity_type in ('item','match','claim')),
  entity_id uuid not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_entity_idx
  on public.admin_audit_logs (entity_type, entity_id, created_at desc);

alter table public.item_matches enable row level security;
alter table public.item_claims enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.item_matches from anon;
revoke all on table public.item_claims from anon;
revoke all on table public.admin_audit_logs from anon, authenticated;
grant select, update on table public.item_matches to authenticated;
grant select, insert, update on table public.item_claims to authenticated;
grant select on table public.admin_audit_logs to authenticated;
grant all on table public.item_matches, public.item_claims, public.admin_audit_logs to service_role;
grant update on table public.items to authenticated;

drop policy if exists "Users view visible reports and admins view all" on public.items;
drop policy if exists "Signed-in users view items" on public.items;
create policy "Users view visible reports and admins view all"
on public.items for select to authenticated
using (
  (select private.is_admin())
  or user_id = (select auth.uid())
  or (
    moderation_flag <> 'hidden'
    and report_status not in ('returned','closed')
  )
);

drop policy if exists "Admins update item reports" on public.items;
create policy "Admins update item reports"
on public.items for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Claimants and admins view item claims" on public.item_claims;
create policy "Claimants and admins view item claims"
on public.item_claims for select to authenticated
using (claimant_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "Students submit claims for other users found items" on public.item_claims;
create policy "Students submit claims for other users found items"
on public.item_claims for insert to authenticated
with check (
  claimant_id = (select auth.uid())
  and exists (
    select 1
    from public.items i
    where i.id = item_id
      and i.type = 'Found'
      and i.user_id <> (select auth.uid())
      and i.report_status in ('new','under_review','matched')
      and i.moderation_flag <> 'hidden'
  )
);

drop policy if exists "Admins review item claims" on public.item_claims;
create policy "Admins review item claims"
on public.item_claims for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Item owners and admins view possible matches" on public.item_matches;
create policy "Item owners and admins view possible matches"
on public.item_matches for select to authenticated
using (
  (select private.is_admin())
  or exists (select 1 from public.items i where i.id = lost_item_id and i.user_id = (select auth.uid()))
  or exists (select 1 from public.items i where i.id = found_item_id and i.user_id = (select auth.uid()))
);

drop policy if exists "Admins review possible item matches" on public.item_matches;
create policy "Admins review possible item matches"
on public.item_matches for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists "Admins view audit history" on public.admin_audit_logs;
create policy "Admins view audit history"
on public.admin_audit_logs for select to authenticated
using ((select private.is_admin()));

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists items_set_updated_at on public.items;
create trigger items_set_updated_at before update on public.items
for each row execute function private.set_updated_at();
drop trigger if exists item_claims_set_updated_at on public.item_claims;
create trigger item_claims_set_updated_at before update on public.item_claims
for each row execute function private.set_updated_at();

create or replace function private.audit_item_admin_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.report_status is distinct from new.report_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'report_status_changed',
      pg_catalog.jsonb_build_object('from', old.report_status, 'to', new.report_status));
  end if;
  if old.moderation_flag is distinct from new.moderation_flag
     or old.moderation_note is distinct from new.moderation_note then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'moderation_updated',
      pg_catalog.jsonb_build_object('from_flag', old.moderation_flag, 'to_flag', new.moderation_flag, 'note', new.moderation_note));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_item_admin_changes() from public, anon, authenticated;

drop trigger if exists items_audit_admin_changes on public.items;
create trigger items_audit_admin_changes
after update of report_status, moderation_flag, moderation_note on public.items
for each row execute function private.audit_item_admin_changes();

create or replace function private.handle_item_match_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_lost_owner uuid;
  v_found_owner uuid;
  v_lost_name text;
  v_found_name text;
begin
  if old.review_status is not distinct from new.review_status then return new; end if;

  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (coalesce(new.reviewed_by, auth.uid()), 'match', new.id, 'match_reviewed',
    pg_catalog.jsonb_build_object('from', old.review_status, 'to', new.review_status, 'score', new.score, 'note', new.admin_note));

  select user_id, name into v_lost_owner, v_lost_name from public.items where id = new.lost_item_id;
  select user_id, name into v_found_owner, v_found_name from public.items where id = new.found_item_id;

  if new.review_status = 'confirmed' then
    if exists (
      select 1 from public.items
      where id in (new.lost_item_id, new.found_item_id)
        and (moderation_flag <> 'none' or report_status in ('returned','closed'))
    ) then
      raise exception 'A closed or moderated report cannot be confirmed as a match.';
    end if;
    update public.items set report_status = 'matched'
    where id in (new.lost_item_id, new.found_item_id);
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Match confirmed by CampusFind', 'An administrator confirmed a possible match for your lost item: ' || coalesce(v_lost_name, 'your report') || '. Please follow the campus handover process.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Match confirmed by CampusFind', 'An administrator confirmed a possible match for your found item: ' || coalesce(v_found_name, 'your report') || '. Please follow the campus handover process.');
  elsif new.review_status = 'rejected' then
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Match reviewed', 'An administrator reviewed and dismissed this possible match. Your report remains active.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Match reviewed', 'An administrator reviewed and dismissed this possible match. Your report remains active.');
  elsif new.review_status = 'resolved' then
    update public.items set report_status = 'returned'
    where id in (new.lost_item_id, new.found_item_id);
    insert into public.notifications (user_id, item_id, matched_item_id, title, body)
    values
      (v_lost_owner, new.lost_item_id, new.found_item_id, 'Item return recorded', 'CampusFind marked this matched item as returned. Thank you for helping reunite it with its owner.'),
      (v_found_owner, new.found_item_id, new.lost_item_id, 'Item return recorded', 'CampusFind marked this matched item as returned. Thank you for helping reunite it with its owner.');
  end if;

  new.reviewed_at := pg_catalog.now();
  new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  return new;
end;
$$;
revoke all on function private.handle_item_match_review() from public, anon, authenticated;

drop trigger if exists item_matches_handle_review on public.item_matches;
create trigger item_matches_handle_review before update of review_status on public.item_matches
for each row execute function private.handle_item_match_review();

create or replace function private.handle_item_claim_review()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_item_owner uuid;
  v_item_name text;
begin
  if old.status is not distinct from new.status then return new; end if;

  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (coalesce(new.reviewed_by, auth.uid()), 'claim', new.id, 'claim_reviewed',
    pg_catalog.jsonb_build_object('item_id', new.item_id, 'from', old.status, 'to', new.status, 'note', new.admin_note));

  select user_id, name into v_item_owner, v_item_name from public.items where id = new.item_id;

  if new.status = 'approved' then
    update public.items set report_status = 'claimed' where id = new.item_id;
    update public.item_claims
    set status = 'rejected',
        admin_note = coalesce(admin_note, 'Another claim was approved for this item.'),
        reviewed_by = coalesce(new.reviewed_by, auth.uid()),
        reviewed_at = pg_catalog.now()
    where item_id = new.item_id and id <> new.id and status = 'pending';
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was approved', 'An administrator approved your claim for ' || coalesce(v_item_name, 'the found item') || '. Follow the campus handover process to collect it.'),
      (v_item_owner, new.item_id, 'A claim was approved', 'An administrator approved a claim for your found-item report: ' || coalesce(v_item_name, 'your item') || '. Follow the campus handover process.');
  elsif new.status = 'rejected' then
    insert into public.notifications (user_id, item_id, title, body)
    values
      (new.claimant_id, new.item_id, 'Your item claim was not approved', 'An administrator could not verify this claim for ' || coalesce(v_item_name, 'the found item') || '. Contact the CampusFind administrator if you have additional proof.');
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
      (new.claimant_id, new.item_id, 'Item return completed', 'CampusFind recorded this item as returned. Thank you for helping reunite it with its owner.'),
      (v_item_owner, new.item_id, 'Item return completed', 'CampusFind recorded your found item as returned.');
  end if;

  new.reviewed_at := coalesce(new.reviewed_at, pg_catalog.now());
  new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  return new;
end;
$$;
revoke all on function private.handle_item_claim_review() from public, anon, authenticated;

drop trigger if exists item_claims_handle_review on public.item_claims;
create trigger item_claims_handle_review before update of status on public.item_claims
for each row execute function private.handle_item_claim_review();

insert into public.item_matches (lost_item_id, found_item_id, matching_method)
select distinct
  case when a.type = 'Lost' then a.id else b.id end,
  case when a.type = 'Found' then a.id else b.id end,
  'legacy-notification'
from public.notifications n
join public.items a on a.id = n.item_id
join public.items b on b.id = n.matched_item_id
where n.matched_item_id is not null and a.type <> b.type
on conflict (lost_item_id, found_item_id) do nothing;

comment on table public.item_claims is 'Private claim evidence. Visible only to claimant and administrators.';
comment on table public.item_matches is 'Possible Lost/Found pairs requiring administrator review.';
comment on table public.admin_audit_logs is 'Administrator review history; private claim evidence is excluded.';


-- Consolidated source 20261031222712_add_report_status_history_and_owner_notifications.sql
create table if not exists public.item_status_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  previous_status text check (
    previous_status is null or previous_status in ('new','under_review','matched','claimed','returned','closed')
  ),
  new_status text not null check (
    new_status in ('new','under_review','matched','claimed','returned','closed')
  ),
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists item_status_history_item_created_idx
  on public.item_status_history (item_id, created_at asc);

alter table public.item_status_history enable row level security;
revoke all on table public.item_status_history from public, anon;
grant select on table public.item_status_history to authenticated;
grant all on table public.item_status_history to service_role;

drop policy if exists "Owners and admins view report status history" on public.item_status_history;
create policy "Owners and admins view report status history"
on public.item_status_history
for select
to authenticated
using (
  exists (
    select 1
    from public.items i
    where i.id = item_id
      and i.user_id = (select auth.uid())
  )
  or (select private.is_admin())
);

insert into public.item_status_history (item_id, previous_status, new_status, changed_by, created_at)
select i.id, null, 'new', i.user_id, i.created_at
from public.items i
where not exists (
  select 1 from public.item_status_history h where h.item_id = i.id
);

insert into public.item_status_history (item_id, previous_status, new_status, changed_by, created_at)
select i.id, 'new', i.report_status, i.moderated_by,
       coalesce(i.moderated_at, i.updated_at, i.created_at)
from public.items i
where i.report_status <> 'new'
  and not exists (
    select 1
    from public.item_status_history h
    where h.item_id = i.id
      and h.new_status = i.report_status
  );

create or replace function private.record_item_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    insert into public.item_status_history (
      item_id, previous_status, new_status, changed_by, created_at
    )
    values (
      new.id, null, new.report_status, coalesce(auth.uid(), new.user_id), new.created_at
    );
    return new;
  end if;

  if old.report_status is not distinct from new.report_status then
    return new;
  end if;

  insert into public.item_status_history (
    item_id, previous_status, new_status, changed_by
  )
  values (
    new.id, old.report_status, new.report_status, coalesce(auth.uid(), new.moderated_by)
  );

  if new.user_id is not null then
    if new.report_status = 'under_review' then
      v_title := 'Your report is under review';
      v_body := 'An administrator has started reviewing "' || new.name || '". You can follow its progress in My Reports.';
    elsif new.report_status = 'closed' then
      v_title := 'Your report has been closed';
      v_body := 'The report "' || new.name || '" was closed by an administrator. Contact CampusFind if you think this needs another review.';
    elsif new.report_status = 'new' then
      v_title := 'Your report was reopened';
      v_body := 'The report "' || new.name || '" is active again and can be reviewed for possible matches.';
    else
      v_title := null;
      v_body := null;
    end if;

    if v_title is not null then
      insert into public.notifications (user_id, item_id, title, body)
      values (new.user_id, new.id, v_title, v_body);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.record_item_status_history() from public, anon, authenticated;

drop trigger if exists items_record_initial_status on public.items;
create trigger items_record_initial_status
after insert on public.items
for each row execute function private.record_item_status_history();

drop trigger if exists items_record_status_changes on public.items;
create trigger items_record_status_changes
after update of report_status on public.items
for each row execute function private.record_item_status_history();

comment on table public.item_status_history is
  'Student-visible report lifecycle history. Only the report owner and administrators can read it.';
comment on function private.record_item_status_history() is
  'Records report lifecycle changes and notifies owners about moderation actions not already covered by match or claim notifications.';


-- Consolidated source 20261030222500_add_private_moderation_notes_and_search.sql
drop trigger if exists items_audit_admin_changes on public.items;
drop function if exists private.audit_item_admin_changes();

-- Never discard inline notes: stop the whole canonical migration if any exist.
DO $recovery$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.items i
    WHERE to_jsonb(i)->>'moderation_note' IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Preflight required: items.moderation_note contains values; preserve/review them before removal.';
  END IF;
END
$recovery$;

alter table public.items drop column if exists moderation_note;

create or replace function private.audit_item_admin_changes()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.report_status is distinct from new.report_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'report_status_changed',
      pg_catalog.jsonb_build_object('from', old.report_status, 'to', new.report_status));
  end if;
  if old.moderation_flag is distinct from new.moderation_flag then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'item', new.id, 'moderation_flag_changed',
      pg_catalog.jsonb_build_object('from', old.moderation_flag, 'to', new.moderation_flag));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_item_admin_changes() from public, anon, authenticated;
create trigger items_audit_admin_changes
after update of report_status, moderation_flag on public.items
for each row execute function private.audit_item_admin_changes();

create table if not exists public.admin_item_moderation_notes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  note text not null check (char_length(btrim(note)) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists admin_item_moderation_notes_item_created_idx
  on public.admin_item_moderation_notes (item_id, created_at desc);
alter table public.admin_item_moderation_notes enable row level security;
revoke all on table public.admin_item_moderation_notes from anon;
grant select, insert on table public.admin_item_moderation_notes to authenticated;
grant all on table public.admin_item_moderation_notes to service_role;

drop policy if exists "Admins read moderation notes" on public.admin_item_moderation_notes;
create policy "Admins read moderation notes"
on public.admin_item_moderation_notes for select to authenticated
using ((select private.is_admin()));
drop policy if exists "Admins add moderation notes" on public.admin_item_moderation_notes;
create policy "Admins add moderation notes"
on public.admin_item_moderation_notes for insert to authenticated
with check ((select private.is_admin()) and actor_id = (select auth.uid()));

create or replace function private.audit_moderation_note_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
  values (new.actor_id, 'item', new.item_id, 'moderation_note_added',
    pg_catalog.jsonb_build_object('note', new.note, 'moderation_note_id', new.id));
  return new;
end;
$$;
revoke all on function private.audit_moderation_note_insert() from public, anon, authenticated;
drop trigger if exists admin_item_moderation_notes_audit on public.admin_item_moderation_notes;
create trigger admin_item_moderation_notes_audit
after insert on public.admin_item_moderation_notes
for each row execute function private.audit_moderation_note_insert();

alter table public.item_matches add column if not exists match_reason text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='item_matches_reason_length_check' and conrelid='public.item_matches'::regclass) then
    alter table public.item_matches add constraint item_matches_reason_length_check
      check (match_reason is null or char_length(match_reason) <= 500);
  end if;
end $$;

create or replace function public.search_items(
  p_query text default null,
  p_type text default 'All',
  p_category text default 'All',
  p_sort text default 'newest',
  p_offset integer default 0,
  p_limit integer default 25
)
returns setof public.items
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (
    select lower(btrim(coalesce(p_query, ''))) as value
  )
  select i.*
  from public.items i
  cross join query_text q
  where
    (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (
      q.value = ''
      or i.name ilike '%' || q.value || '%'
      or i.category ilike '%' || q.value || '%'
      or i.location ilike '%' || q.value || '%'
      or coalesce(i.note, '') ilike '%' || q.value || '%'
      or extensions.similarity(lower(concat_ws(' ', i.name, i.category, i.location, coalesce(i.note, ''))), q.value) >= 0.18
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

revoke all on function public.search_items(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.search_items(text,text,text,text,integer,integer) to authenticated;
comment on function public.search_items(text,text,text,text,integer,integer) is
  'Paginated, RLS-respecting Lost/Found search with trigram typo tolerance and common item synonyms.';


-- Consolidated source 20261030182055_campusfind_trust_and_discovery.sql
-- CampusFind trust, retention, saved reports, and discovery improvements.
drop policy if exists "Users delete own items" on public.items;

alter table public.item_claims
  add column if not exists item_name_snapshot text,
  add column if not exists item_location_snapshot text,
  add column if not exists item_category_snapshot text;

update public.item_claims c
set item_name_snapshot = coalesce(c.item_name_snapshot, i.name),
    item_location_snapshot = coalesce(c.item_location_snapshot, i.location),
    item_category_snapshot = coalesce(c.item_category_snapshot, i.category)
from public.items i
where i.id = c.item_id
  and (c.item_name_snapshot is null or c.item_location_snapshot is null or c.item_category_snapshot is null);

create or replace function private.snapshot_claimed_item()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select i.name, i.location, i.category
    into new.item_name_snapshot, new.item_location_snapshot, new.item_category_snapshot
  from public.items i where i.id = new.item_id;
  if new.item_name_snapshot is null then
    raise exception 'The found item is no longer available for claiming.';
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_claimed_item() from public, anon, authenticated;
drop trigger if exists item_claims_snapshot_item on public.item_claims;
create trigger item_claims_snapshot_item before insert on public.item_claims
for each row execute function private.snapshot_claimed_item();

alter table public.profiles
  add column if not exists verification_status text not null default 'unverified',
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_verification_status_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_verification_status_check
      check (verification_status in ('unverified','verified'));
  end if;
end $$;

create index if not exists profiles_role_verification_idx
  on public.profiles (role, verification_status, created_at desc);

alter table public.admin_audit_logs drop constraint if exists admin_audit_logs_entity_type_check;
alter table public.admin_audit_logs add constraint admin_audit_logs_entity_type_check
  check (entity_type in ('item','match','claim','profile'));

create or replace function private.audit_profile_verification()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.verification_status is distinct from new.verification_status then
    insert into public.admin_audit_logs (actor_id, entity_type, entity_id, action, details)
    values (auth.uid(), 'profile', new.id, 'student_verification_changed',
      pg_catalog.jsonb_build_object('from', old.verification_status, 'to', new.verification_status));
  end if;
  return new;
end;
$$;
revoke all on function private.audit_profile_verification() from public, anon, authenticated;
drop trigger if exists profiles_audit_verification on public.profiles;
create trigger profiles_audit_verification after update of verification_status on public.profiles
for each row execute function private.audit_profile_verification();

create or replace function public.admin_set_student_verification(p_user_id uuid, p_verified boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;
  update public.profiles
  set verification_status = case when p_verified then 'verified' else 'unverified' end,
      verified_at = case when p_verified then pg_catalog.now() else null end,
      verified_by = case when p_verified then auth.uid() else null end
  where id = p_user_id and role = 'student';
  if not found then raise exception 'Student profile not found.'; end if;
end;
$$;
revoke all on function public.admin_set_student_verification(uuid, boolean) from public, anon;
grant execute on function public.admin_set_student_verification(uuid, boolean) to authenticated;

create or replace function private.notify_report_owner_status_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_label text;
begin
  if old.report_status is not distinct from new.report_status then return new; end if;
  if pg_catalog.pg_trigger_depth() > 1 then return new; end if;
  v_label := case new.report_status
    when 'new' then 'New'
    when 'under_review' then 'Under review'
    when 'matched' then 'Possible match confirmed'
    when 'claimed' then 'Claim approved'
    when 'returned' then 'Returned'
    when 'closed' then 'Closed'
    else 'Updated'
  end;
  insert into public.notifications (user_id, item_id, title, body)
  values (new.user_id, new.id, 'Your report status changed',
    'An administrator updated "' || new.name || '" to: ' || v_label || '. Open My Reports to view the latest status.');
  return new;
end;
$$;
revoke all on function private.notify_report_owner_status_change() from public, anon, authenticated;
drop trigger if exists items_notify_owner_status_change on public.items;
create trigger items_notify_owner_status_change after update of report_status on public.items
for each row execute function private.notify_report_owner_status_change();

create table if not exists public.saved_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
alter table public.saved_items enable row level security;
revoke all on table public.saved_items from anon;
grant select, insert, delete on table public.saved_items to authenticated;
drop policy if exists "Users manage their own saved items" on public.saved_items;
create policy "Users manage their own saved items" on public.saved_items for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Admins assign exact item locations" on public.item_locations;
drop policy if exists "Users add exact locations to their own reports" on public.item_locations;
create policy "Owners and admins add exact item locations" on public.item_locations for insert to authenticated
with check (
  ((select private.is_admin()) and exists (
    select 1 from public.items i where i.id = item_locations.item_id and i.user_id = item_locations.user_id
  ))
  or
  (item_locations.user_id = (select auth.uid()) and exists (
    select 1 from public.items i where i.id = item_locations.item_id and i.user_id = (select auth.uid())
  ))
);

drop policy if exists "Admins view possible item matches" on public.notifications;
drop policy if exists "Users read own notifications" on public.notifications;
create policy "Owners and admins read notifications" on public.notifications for select to authenticated
using (user_id = (select auth.uid()) or ((select private.is_admin()) and matched_item_id is not null));

create index if not exists admin_audit_logs_actor_id_idx on public.admin_audit_logs (actor_id);
create index if not exists admin_item_moderation_notes_actor_id_idx on public.admin_item_moderation_notes (actor_id);
create index if not exists item_claims_reviewed_by_idx on public.item_claims (reviewed_by);
create index if not exists item_matches_reviewed_by_idx on public.item_matches (reviewed_by);
create index if not exists items_moderated_by_idx on public.items (moderated_by);
create index if not exists saved_items_item_id_idx on public.saved_items (item_id);
create index if not exists items_location_status_date_idx on public.items (location, report_status, item_date desc);

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
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (select lower(btrim(coalesce(p_query, ''))) as value)
  select i.* from public.items i cross join query_text q
  where
    (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (coalesce(p_status, 'All') = 'All' or i.report_status = p_status)
    and (nullif(btrim(coalesce(p_location, '')), '') is null or i.location ilike '%' || btrim(p_location) || '%')
    and (p_date_from is null or i.item_date >= p_date_from)
    and (p_date_to is null or i.item_date <= p_date_to)
    and (not coalesce(p_saved_only, false) or exists (
      select 1 from public.saved_items s where s.item_id = i.id and s.user_id = (select auth.uid())
    ))
    and (
      q.value = '' or i.name ilike '%' || q.value || '%'
      or i.category ilike '%' || q.value || '%'
      or i.location ilike '%' || q.value || '%'
      or coalesce(i.note, '') ilike '%' || q.value || '%'
      or extensions.similarity(lower(concat_ws(' ', i.name, i.category, i.location, coalesce(i.note, ''))), q.value) >= 0.18
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
comment on table public.saved_items is 'Private bookmarks owned by each authenticated CampusFind student.';


-- Consolidated source 20261030182225_campusfind_item_descriptors.sql
-- Structured descriptors and expanded matching/search fields.
alter table public.items
  add column if not exists brand text not null default '',
  add column if not exists color text not null default '',
  add column if not exists model text not null default '',
  add column if not exists item_time text not null default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname='items_brand_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_brand_length_check check (char_length(brand) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_color_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_color_length_check check (char_length(color) <= 50);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_model_length_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_model_length_check check (char_length(model) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname='items_item_time_format_check' and conrelid='public.items'::regclass) then
    alter table public.items add constraint items_item_time_format_check check (item_time = '' or item_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

create index if not exists items_brand_color_idx on public.items (lower(brand), lower(color))
where brand <> '' or color <> '';

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
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  with query_text as (select lower(btrim(coalesce(p_query, ''))) as value)
  select i.* from public.items i cross join query_text q
  where
    (coalesce(p_type, 'All') = 'All' or i.type = p_type)
    and (coalesce(p_category, 'All') = 'All' or i.category = p_category)
    and (coalesce(p_status, 'All') = 'All' or i.report_status = p_status)
    and (nullif(btrim(coalesce(p_location, '')), '') is null or i.location ilike '%' || btrim(p_location) || '%')
    and (p_date_from is null or i.item_date >= p_date_from)
    and (p_date_to is null or i.item_date <= p_date_to)
    and (not coalesce(p_saved_only, false) or exists (
      select 1 from public.saved_items s where s.item_id = i.id and s.user_id = (select auth.uid())
    ))
    and (
      q.value = '' or i.name ilike '%' || q.value || '%'
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
comment on function public.search_items_v2(text,text,text,text,integer,integer,text,text,date,date,boolean) is
  'Campus board search with typo tolerance, item descriptors, status, location, date and saved-only filters.';


-- Consolidated source 20261030182300_campusfind_verification_privileges.sql
-- Restrict verification updates to specific columns and require admin RLS.
revoke update on table public.profiles from anon, authenticated;
grant update (verification_status, verified_at, verified_by) on table public.profiles to authenticated;

drop policy if exists "Admins update student verification" on public.profiles;
create policy "Admins update student verification"
on public.profiles for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create or replace function public.admin_set_student_verification(
  p_user_id uuid,
  p_verified boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Administrator access is required.' using errcode = '42501';
  end if;

  update public.profiles
  set verification_status = case when p_verified then 'verified' else 'unverified' end,
      verified_at = case when p_verified then pg_catalog.now() else null end,
      verified_by = case when p_verified then auth.uid() else null end
  where id = p_user_id and role = 'student';

  if not found then
    raise exception 'Student profile not found.';
  end if;
end;
$$;
revoke all on function public.admin_set_student_verification(uuid, boolean) from public, anon;
grant execute on function public.admin_set_student_verification(uuid, boolean) to authenticated;

create index if not exists profiles_verified_by_idx on public.profiles (verified_by);


-- Consolidated source 20261030184413_revoke_student_report_deletion.sql
-- Direct report deletion is not part of the CampusFind workflow.
-- Students archive reports through report_status; privileged service operations
-- remain available to service_role for controlled maintenance.
revoke delete on table public.items from anon, authenticated;


-- Consolidated source 20261031170437_filter_match_trigger_to_active_reports.sql
-- Only active, unflagged reports should generate database-level possible-match alerts.
-- This trigger function is SECURITY DEFINER, so it must repeat the visibility checks
-- rather than relying on the caller's RLS policies.

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


-- Consolidated source 20261031225735_enforce_verified_student_workflows_and_secure_handover.sql

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


-- Consolidated source 20261031225811_harden_public_admin_rpcs_and_claim_privileges.sql

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
grant update (moderation_flag, moderated_by, moderated_at) on public.items to authenticated;
grant insert on public.admin_item_moderation_notes to authenticated;

-- The hash is readable only by this private helper, never through the Data API.
create or replace function private.verify_claim_handover_code(p_claim_id uuid, p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if p_code is null or pg_catalog.length(pg_catalog.btrim(p_code)) <> 12 then
    return false;
  end if;
  select handover_code_hash into v_hash
  from public.item_claims
  where id = p_claim_id;
  return v_hash is not null
    and pg_catalog.md5(pg_catalog.upper(pg_catalog.btrim(p_code))) = v_hash;
end;
$$;
revoke all on function private.verify_claim_handover_code(uuid,text) from public, anon, authenticated;
grant execute on function private.verify_claim_handover_code(uuid,text) to authenticated;

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
declare
  v_current_status text;
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

  select status into v_current_status
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
    if not private.verify_claim_handover_code(p_claim_id, p_handover_code) then
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

-- Only verified student claimants can create a row; do not let them set review fields or the private hash.
revoke insert on table public.item_claims from authenticated;
grant insert (item_id, claimant_id, proof) on table public.item_claims to authenticated;

-- Only admin RLS rows can be updated; only decision fields are granted.
grant update (status, admin_note, reviewed_by, reviewed_at) on table public.item_claims to authenticated;


-- Consolidated source 20261031225847_move_privileged_admin_actions_into_private_schema.sql

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


-- Consolidated source 20261101073131_allow_unverified_student_reporting.sql

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


-- Consolidated source 20261101080000_allow_all_authenticated_accounts_to_report.sql

-- Allow any signed-in CampusFind account with a profile to submit Lost/Found
-- reports. Student identity verification and account role are not prerequisites.
-- Reports remain owned by auth.uid(); claims/handover retain their existing
-- verified-student restrictions.

create or replace function private.require_authenticated_item_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Privileged service operations without an end-user JWT remain available.
  if auth.uid() is null then return new; end if;
  if new.user_id is distinct from auth.uid() then
    raise exception 'You can only submit a report for your own signed-in account.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.require_authenticated_item_report() from public, anon, authenticated;

drop trigger if exists items_require_verified_student on public.items;
drop trigger if exists items_require_authenticated_account on public.items;
create trigger items_require_authenticated_account
before insert on public.items
for each row execute function private.require_authenticated_item_report();

drop policy if exists "Students add own items" on public.items;
drop policy if exists "Authenticated accounts add own items" on public.items;
create policy "Authenticated accounts add own items"
on public.items for insert to authenticated
with check (user_id = (select auth.uid()));

-- Image upload is allowed to any signed-in owner, in the owner's UUID folder.
drop policy if exists "Verified students upload their own item images" on storage.objects;
drop policy if exists "Students upload their own item images" on storage.objects;
drop policy if exists "Authenticated users upload their own item images" on storage.objects;
create policy "Authenticated users upload their own item images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'item-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Remove the now-unused role-specific reporting trigger function.
drop function if exists private.require_verified_student_report();


-- Consolidated source 20261101081000_unify_ai_match_approval_and_secure_handover.sql

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


-- Consolidated source 20261101082000_allow_verified_handover_trigger_to_resolve_match.sql

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


-- Consolidated source 20261101083000_allow_trusted_admin_found_reports_in_verified_returns.sql

-- A verified student may claim a Found report owned by a trusted Admin account.
-- A Lost-report claimant must still be a verified student. Student accounts that
-- own Found reports must also be verified before an administrator can approve
-- the pair for return.

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
  v_found_owner_is_admin boolean := false;
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

  select i.user_id, i.type, i.report_status, i.moderation_flag,
         exists (select 1 from public.profiles p where p.id=i.user_id and p.role='admin')
    into v_owner_id, v_type, v_status, v_flag, v_found_owner_is_admin
  from public.items i
  where i.id = new.item_id;

  if not found
     or v_type <> 'Found'
     or v_owner_id = new.claimant_id
     or v_status not in ('new','under_review','matched')
     or v_flag <> 'none'
     or (not private.is_verified_student(v_owner_id) and not v_found_owner_is_admin) then
    raise exception 'This found report is not currently eligible for a verified return.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
revoke all on function private.require_verified_student_claim() from public, anon, authenticated;

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
           or (i.type = 'Lost' and not private.is_verified_student(i.user_id))
           or (
             i.type = 'Found'
             and not private.is_verified_student(i.user_id)
             and not exists (
               select 1 from public.profiles p
               where p.id=i.user_id and p.role='admin'
             )
           )
         )
     ) then
    raise exception 'The Lost owner must be a verified student; the Found owner must be verified or a trusted Admin account, and both reports must be active.'
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
  v_found_owner_is_admin boolean := false;
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
         l.moderation_flag, f.moderation_flag,
         exists (select 1 from public.profiles p where p.id=f.user_id and p.role='admin')
    into v_lost_user, v_found_user, v_lost_status, v_found_status,
         v_lost_flag, v_found_flag, v_found_owner_is_admin
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

  if not private.is_verified_student(v_lost_user) then
    raise exception 'The Lost report owner must complete student verification before return approval.';
  end if;
  if not private.is_verified_student(v_found_user) and not v_found_owner_is_admin then
    raise exception 'The Found report owner must be verified or be a trusted Admin account before return approval.';
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

-- Strip Supabase default utility privileges from client roles. RLS does not
-- constrain TRUNCATE, and these privileges are not used by the CampusFind UI.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM anon, authenticated;

COMMIT;
