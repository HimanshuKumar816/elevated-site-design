-- Keep student-facing report status notifications short and easy to understand.
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
      v_title := 'Your report is being reviewed';
      v_body := 'We are reviewing your report. Check My Reports for updates.';
    elsif new.report_status = 'closed' then
      v_title := 'Your report was closed';
      v_body := 'Your report is closed. Contact support if you need help.';
    elsif new.report_status = 'new' then
      v_title := 'Your report is active again';
      v_body := 'Your report is open again and can be checked for matches.';
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
