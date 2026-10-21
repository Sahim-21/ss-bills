-- Replace a client's licence key (for example after it leaked). Super admin only.
-- The old key stops working at once: activation and check-in find licences by key. PCs that were already linked
-- stay linked (they are bound by machine ID), so after the owner types the new key into each PC it re-activates
-- without using up a terminal slot. Until then those PCs show "Activate again" and cannot create new bills.

-- The activity log gets a new event kind.
alter table public.license_events drop constraint license_events_event_check;
alter table public.license_events add constraint license_events_event_check check (event in (
  'created', 'updated', 'renewed', 'suspended', 'reactivated',
  'device_bound', 'device_reset', 'activated',
  'plan_updated', 'admin_added', 'admin_removed', 'key_regenerated'));

create function public.vendor_regenerate_key(p_restaurant uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.licenses;
  v_reason text := public.require_text(p_reason, 'A reason');
  v_key text;
begin
  perform public.assert_super_admin();
  select * into l from public.licenses where restaurant_id = p_restaurant for update;
  if not found then raise exception 'Restaurant not found'; end if;
  v_key := public.generate_license_key();
  update public.licenses set license_key = v_key where id = l.id;
  -- the log keeps only the last 4 characters of each key, never a whole key
  perform public.log_event(p_restaurant, 'key_regenerated', v_reason,
    jsonb_build_object('old_tail', right(l.license_key, 4), 'new_tail', right(v_key, 4)));
  return jsonb_build_object('ok', true, 'license_key', v_key);
end $$;

revoke execute on function public.vendor_regenerate_key(uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_regenerate_key(uuid, text) to authenticated;
