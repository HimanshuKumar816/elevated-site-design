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
