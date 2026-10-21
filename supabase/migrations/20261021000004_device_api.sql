-- What a restaurant's app calls (through Edge Functions using the service role, never directly).
-- Both functions return { ok, code, message, ... } instead of raising, so the Edge Function can pass the
-- reason straight on to the app. They never return other restaurants' data.

create function public.license_status_json(l public.licenses, r public.restaurants, pl public.plans, p_used integer)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'restaurant_name', r.name, 'restaurant_code', r.code, 'plan', pl.name, 'plan_id', pl.id,
    'state', public.license_state(l.status, l.expires_at, l.plan_id), 'expires_at', l.expires_at,
    'max_devices', l.max_devices, 'devices_used', p_used,
    'grace_days', public.setting_int('grace_days', 7), 'suspended_reason', l.suspended_reason,
    'server_time', now())
$$;

-- First launch: bind this PC to the license key (if a terminal slot is free).
create function public.license_activate(p_key text, p_machine text, p_device_name text, p_app_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.licenses; r public.restaurants; pl public.plans; d public.license_devices;
  v_key text := upper(btrim(coalesce(p_key, '')));
  v_machine text := btrim(coalesce(p_machine, ''));
  v_used integer; v_state text; v_first boolean; v_known boolean;
begin
  if v_machine = '' or length(v_machine) > 200 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'This PC could not be identified');
  end if;
  select * into l from public.licenses where license_key = v_key;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_key', 'message', 'That license key was not found. Check it and try again');
  end if;
  select * into r from public.restaurants where id = l.restaurant_id;
  select * into pl from public.plans where id = l.plan_id;
  v_state := public.license_state(l.status, l.expires_at, l.plan_id);

  if v_state = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'suspended', 'message', 'This license is suspended. Please contact SS Bills');
  end if;
  if v_state = 'expired' then
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'This license has expired. Please renew it with SS Bills');
  end if;

  select * into d from public.license_devices where license_id = l.id and machine_id = v_machine;
  v_known := found; -- FOUND would be overwritten by the count(*) below, which always returns a row
  select count(*) into v_used from public.license_devices where license_id = l.id and active;

  if v_known and d.active then
    update public.license_devices set last_seen_at = now(), app_version = p_app_version,
      device_name = coalesce(nullif(btrim(p_device_name), ''), device_name) where id = d.id;
  else
    if v_used >= l.max_devices then
      return jsonb_build_object('ok', false, 'code', 'device_limit',
        'message', format('All %s terminals for this license are in use. Ask SS Bills to free one', l.max_devices));
    end if;
    v_first := not exists (select 1 from public.license_devices where license_id = l.id);
    insert into public.license_devices (license_id, machine_id, device_name, app_version)
    values (l.id, v_machine, coalesce(btrim(p_device_name), ''), p_app_version)
    on conflict (license_id, machine_id) do update set active = true, last_seen_at = now(),
      app_version = excluded.app_version, device_name = excluded.device_name;
    v_used := v_used + 1;
    perform public.log_event(r.id, case when v_first then 'activated' else 'device_bound' end, '',
      jsonb_build_object('machine_id', v_machine, 'device_name', coalesce(btrim(p_device_name), '')), 'Restaurant PC');
  end if;

  update public.licenses set last_check_in_at = now(), app_version = p_app_version where id = l.id;
  return jsonb_build_object('ok', true) || public.license_status_json(l, r, pl, v_used);
end $$;

-- Daily check-in: refresh status and upload daily summaries (and nothing else).
-- p_summaries: [{date, salesPaise, bills, cancelled, cashPaise, upiPaise, cardPaise, taxPaise, topItemName, topItemQty}]
create function public.license_checkin(p_key text, p_machine text, p_app_version text, p_summaries jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.licenses; r public.restaurants; pl public.plans; d public.license_devices;
  s jsonb; v_date date; v_used integer; v_n integer := 0; v_key text;
  v_summaries jsonb := coalesce(p_summaries, '[]'::jsonb);
begin
  select * into l from public.licenses where license_key = upper(btrim(coalesce(p_key, '')));
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_key', 'message', 'That license key was not found');
  end if;
  select * into d from public.license_devices where license_id = l.id and machine_id = btrim(coalesce(p_machine, ''));
  if not found or not d.active then
    return jsonb_build_object('ok', false, 'code', 'device_not_bound',
      'message', 'This PC is not linked to the license. Activate it again');
  end if;
  if jsonb_typeof(v_summaries) <> 'array' or jsonb_array_length(v_summaries) > 400 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'Too many summaries in one upload');
  end if;

  select * into r from public.restaurants where id = l.restaurant_id;
  select * into pl from public.plans where id = l.plan_id;

  -- Pass 1: check every summary before saving any, so a bad batch is rejected whole (never half-stored).
  for s in select * from jsonb_array_elements(v_summaries) loop
    begin
      v_date := (s->>'date')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'A summary has an invalid date');
    end;
    if v_date > public.today_ist() + 1 or v_date < date '2020-01-01' then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'A summary date is out of range');
    end if;
    -- every amount must be a non-negative whole number: reject fractions, negatives and text up front,
    -- so a buggy client gets a clean "bad request" instead of a database error
    foreach v_key in array array['salesPaise', 'bills', 'cancelled', 'cashPaise', 'upiPaise', 'cardPaise', 'taxPaise', 'topItemQty'] loop
      if coalesce(s->>v_key, '0') !~ '^[0-9]{1,15}$' then
        return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', format('"%s" must be a whole number', v_key));
      end if;
    end loop;
  end loop;

  -- Pass 2: save.
  for s in select * from jsonb_array_elements(v_summaries) loop
    insert into public.daily_summary (restaurant_id, date, sales_paise, bills, cancelled, cash_paise, upi_paise,
                                      card_paise, tax_paise, top_item_name, top_item_qty, synced_at)
    values (r.id, (s->>'date')::date, coalesce((s->>'salesPaise')::bigint, 0), coalesce((s->>'bills')::integer, 0),
            coalesce((s->>'cancelled')::integer, 0), coalesce((s->>'cashPaise')::bigint, 0),
            coalesce((s->>'upiPaise')::bigint, 0), coalesce((s->>'cardPaise')::bigint, 0),
            coalesce((s->>'taxPaise')::bigint, 0), left(nullif(s->>'topItemName', ''), 120),
            nullif(s->>'topItemQty', '')::integer, now())
    on conflict (restaurant_id, date) do update set
      sales_paise = excluded.sales_paise, bills = excluded.bills, cancelled = excluded.cancelled,
      cash_paise = excluded.cash_paise, upi_paise = excluded.upi_paise, card_paise = excluded.card_paise,
      tax_paise = excluded.tax_paise, top_item_name = excluded.top_item_name, top_item_qty = excluded.top_item_qty,
      synced_at = excluded.synced_at;
    v_n := v_n + 1;
  end loop;

  update public.license_devices set last_seen_at = now(), app_version = p_app_version where id = d.id;
  update public.licenses set last_check_in_at = now(), app_version = p_app_version where id = l.id;
  select count(*) into v_used from public.license_devices where license_id = l.id and active;

  return jsonb_build_object('ok', true, 'accepted', v_n) || public.license_status_json(l, r, pl, v_used);
end $$;
