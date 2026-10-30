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
