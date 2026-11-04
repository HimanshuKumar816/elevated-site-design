-- CampusFind DSW physical custody workflow.
alter table public.items
  add column if not exists dsw_received_at timestamptz,
  add column if not exists dsw_received_by uuid references public.profiles(id),
  add column if not exists dsw_storage_reference text,
  add column if not exists dsw_collected_at timestamptz,
  add column if not exists dsw_collected_by uuid references public.profiles(id);

alter table public.items
  add constraint items_dsw_storage_reference_length
  check (dsw_storage_reference is null or char_length(dsw_storage_reference) <= 120);

create index if not exists items_dsw_pending_idx
  on public.items (dsw_received_at, created_at desc)
  where type = 'Found' and dsw_received_at is not null and dsw_collected_at is null;

create or replace function public.admin_record_dsw_receipt(p_item_id uuid, p_storage_reference text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Only authorized CampusFind administrators can record DSW custody.'
      using errcode = '42501';
  end if;
  if p_storage_reference is not null and char_length(btrim(p_storage_reference)) > 120 then
    raise exception 'Storage reference must be 120 characters or fewer.'
      using errcode = '22023';
  end if;
  select * into v_item from public.items where id = p_item_id and type = 'Found' for update;
  if not found then raise exception 'Found report not found.' using errcode = 'P0002'; end if;
  if v_item.dsw_received_at is not null then raise exception 'This item is already recorded at DSW.' using errcode = '23505'; end if;
  if v_item.report_status in ('returned','closed') then raise exception 'Closed or returned items cannot be deposited.' using errcode = '23514'; end if;
  update public.items
  set dsw_received_at = now(),
      dsw_received_by = auth.uid(),
      dsw_storage_reference = nullif(btrim(p_storage_reference),'')
  where id = p_item_id;
  insert into public.notifications(user_id,item_id,title,body)
  values(v_item.user_id,p_item_id,'Item received at DSW','Your found item was received by DSW. It is kept securely for collection, 9 AM–5 PM.');
end;
$$;
revoke all on function public.admin_record_dsw_receipt(uuid,text) from public, anon;
grant execute on function public.admin_record_dsw_receipt(uuid,text) to authenticated;

create or replace function public.admin_record_dsw_collection(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.items%rowtype;
begin
  if not private.is_admin() then
    raise exception 'Only authorized CampusFind administrators can record DSW collection.'
      using errcode = '42501';
  end if;
  select * into v_item from public.items where id=p_item_id and type='Found' for update;
  if not found then raise exception 'Found report not found.' using errcode='P0002'; end if;
  if v_item.dsw_received_at is null then raise exception 'Record DSW receipt before collection.' using errcode='23514'; end if;
  if v_item.dsw_collected_at is not null then raise exception 'This item is already marked collected.' using errcode='23505'; end if;
  if v_item.report_status not in ('returned','closed') then raise exception 'Complete the approved claim and handover verification before marking collected.' using errcode='23514'; end if;
  update public.items set dsw_collected_at=now(), dsw_collected_by=auth.uid() where id=p_item_id;
  insert into public.notifications(user_id,item_id,title,body)
  values(v_item.user_id,p_item_id,'Item collected from DSW','Your item handover has been recorded. Thank you for using CampusFind.');
end;
$$;
revoke all on function public.admin_record_dsw_collection(uuid) from public, anon;
grant execute on function public.admin_record_dsw_collection(uuid) to authenticated;