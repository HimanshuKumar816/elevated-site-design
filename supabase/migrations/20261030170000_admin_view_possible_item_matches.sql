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

