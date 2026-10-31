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
