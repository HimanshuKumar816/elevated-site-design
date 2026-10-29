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
