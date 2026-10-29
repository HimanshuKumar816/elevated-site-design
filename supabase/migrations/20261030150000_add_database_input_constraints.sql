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
