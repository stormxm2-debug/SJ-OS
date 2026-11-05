-- Health-record manual claim markers. Additive; deploy after review.
-- No health data duplication, no browser storage. Parent RLS and retention apply.
alter table public.health_record_requests
  add column if not exists claim_states jsonb not null default '{}'::jsonb;

create or replace function public.get_health_record_claim_states(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare states jsonb;
begin
  select hr.claim_states into states from public.health_record_requests hr
  where hr.id = p_request_id
    and (hr.staff_id = auth.uid() or public.is_owner_or_admin())
    and hr.status = 'completed' and hr.consent_at is not null and hr.result is not null
    and hr.created_at > now() - interval '30 days';
  if not found then raise exception 'Health record not available'; end if;
  return states;
end;
$$;

create or replace function public.set_health_record_claim_states(p_request_id uuid, p_record_keys text[], p_status text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare states jsonb; record_key text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status is null or p_status not in ('unknown','unclaimed','claimed')
    or p_record_keys is null or coalesce(cardinality(p_record_keys),0) not between 1 and 200 then
    raise exception 'Invalid claim state';
  end if;
  foreach record_key in array p_record_keys loop
    if record_key is null or record_key !~ '^hrv1-[0-9a-f]{64}$' then raise exception 'Invalid record key'; end if;
  end loop;
  -- Lock the parent: concurrent staff updates to different records cannot clobber each other.
  select hr.claim_states into states from public.health_record_requests hr
  where hr.id = p_request_id
    and (hr.staff_id = auth.uid() or public.is_owner_or_admin())
    and hr.status = 'completed' and hr.consent_at is not null and hr.result is not null
    and hr.created_at > now() - interval '30 days'
  for update;
  if not found then raise exception 'Health record not available'; end if;
  foreach record_key in array p_record_keys loop
    states := jsonb_set(states, array[record_key], jsonb_build_object(
      'status', p_status, 'checked_at', now(), 'checked_by', auth.uid()), true);
  end loop;
  update public.health_record_requests set claim_states = states where id = p_request_id;
  return states;
end;
$$;

revoke all on function public.get_health_record_claim_states(uuid) from public, anon;
revoke all on function public.set_health_record_claim_states(uuid,text[],text) from public, anon;
grant execute on function public.get_health_record_claim_states(uuid) to authenticated;
grant execute on function public.set_health_record_claim_states(uuid,text[],text) to authenticated;

comment on column public.health_record_requests.claim_states is
  'Manual record-level claim markers, scoped to this saved request. No insurer claim-history verification; not coverage-level payment status.';
