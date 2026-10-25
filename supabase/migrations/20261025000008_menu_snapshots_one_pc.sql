-- Two changes, both decided on 2026-10-25 (docs/DECISIONS.md D-042, D-043):
--   1. One PC per licence. Each PC keeps its own separate database, so a second counter would not share the menu and would
--      issue the same bill numbers. Every plan now defaults to 1 terminal (a super admin can still raise one client's limit).
--   2. A cloud copy of a restaurant's MENU AND SETTINGS (never bills, never staff or PINs), so a lost or replaced PC does not
--      mean retyping the whole menu. Only the restaurant app, through an Edge Function, can read or write it.

-- ---------------------------------------------------------------- 1. one PC per licence
update public.plans set max_devices = 1;

-- ---------------------------------------------------------------- 2. menu & settings snapshots
create table public.menu_snapshots (
  id             bigint generated always as identity primary key,
  restaurant_id  uuid not null references public.restaurants (id),
  format         integer not null check (format >= 1),
  content        jsonb not null,
  content_hash   text not null,          -- of the content without createdAt: identical menus are not stored twice
  bytes          integer not null,
  source_machine text not null default '',
  created_at     timestamptz not null default now()
);
create index idx_menu_snapshots_restaurant on public.menu_snapshots (restaurant_id, id desc);

alter table public.menu_snapshots enable row level security;
revoke all on public.menu_snapshots from anon, authenticated;

-- True when every key of the JSON object is one of `allowed` (and it is an object). Guards against anything unexpected,
-- such as a PIN or a phone number, ever being stored by a buggy or modified app.
create function public.keys_within(j jsonb, allowed text[]) returns boolean
language sql immutable as $$
  select jsonb_typeof(j) = 'object' and not exists (select 1 from jsonb_object_keys(j) k where k <> all (allowed))
$$;

-- Who is asking? Same rules as activation: a known, active key and a PC that is bound to it, and not suspended or expired.
create function public.menu_caller(p_key text, p_machine text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.licenses; v_machine text := btrim(coalesce(p_machine, '')); v_state text;
begin
  select * into l from public.licenses where license_key = upper(btrim(coalesce(p_key, '')));
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_key', 'message', 'That license key was not found');
  end if;
  if not exists (select 1 from public.license_devices where license_id = l.id and machine_id = v_machine and active) then
    return jsonb_build_object('ok', false, 'code', 'device_not_bound', 'message', 'This PC is not linked to the license. Activate it again');
  end if;
  v_state := public.license_state(l.status, l.expires_at, l.plan_id);
  if v_state = 'suspended' then
    return jsonb_build_object('ok', false, 'code', 'suspended', 'message', 'This license is suspended. Please contact SS Bills');
  end if;
  if v_state = 'expired' then
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'This license has expired. Please renew it with SS Bills');
  end if;
  return jsonb_build_object('ok', true, 'restaurant_id', l.restaurant_id);
end $$;

create function public.license_menu_put(p_key text, p_machine text, p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb := public.menu_caller(p_key, p_machine);
  v_rest uuid;
  v_hash text;
  v_bytes integer;
  v_last text;
  v_count integer;
  e jsonb;
  bad constant jsonb := jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'The menu copy is not in the expected format');
begin
  if (c->>'ok')::boolean is not true then return c; end if;
  v_rest := (c->>'restaurant_id')::uuid;

  -- shape: exactly the agreed fields, nothing else (no staff, PINs, bills, printers or licence data)
  if not public.keys_within(p_snapshot, array['version', 'createdAt', 'profile', 'tax', 'categories', 'menu', 'tables']) then return bad; end if;
  if coalesce(p_snapshot->>'version', '') !~ '^[0-9]{1,3}$' or (p_snapshot->>'version')::integer <> 1 then return bad; end if;
  if jsonb_typeof(p_snapshot->'categories') <> 'array' or jsonb_typeof(p_snapshot->'menu') <> 'array' or jsonb_typeof(p_snapshot->'tables') <> 'array' then return bad; end if;
  if jsonb_array_length(p_snapshot->'categories') > 200 or jsonb_array_length(p_snapshot->'menu') > 5000 or jsonb_array_length(p_snapshot->'tables') > 500 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'The menu is larger than the allowed size');
  end if;
  if not public.keys_within(p_snapshot->'profile', array['name', 'tagline', 'address', 'phone', 'gstin', 'fssai', 'hsnSac', 'receiptHeader', 'receiptFooter', 'showLogo', 'paperWidthMm'])
     or not public.keys_within(p_snapshot->'tax', array['gstRateBp', 'pricesIncludeTax', 'serviceChargeEnabled', 'serviceChargeBp']) then
    return bad;
  end if;
  for e in select * from jsonb_array_elements(p_snapshot->'categories') loop
    if not public.keys_within(e, array['id', 'name', 'sortOrder']) then return bad; end if;
  end loop;
  for e in select * from jsonb_array_elements(p_snapshot->'menu') loop
    if not public.keys_within(e, array['id', 'categoryId', 'name', 'shortCode', 'pricePaise', 'veg', 'available']) then return bad; end if;
  end loop;
  for e in select * from jsonb_array_elements(p_snapshot->'tables') loop
    if not public.keys_within(e, array['id', 'label', 'seats']) then return bad; end if;
  end loop;

  v_bytes := octet_length(p_snapshot::text);
  if v_bytes > 1000000 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'message', 'The menu is larger than the allowed size');
  end if;

  v_hash := md5((p_snapshot - 'createdAt')::text);
  select content_hash into v_last from public.menu_snapshots where restaurant_id = v_rest order by id desc limit 1;
  if v_last is not distinct from v_hash then
    return jsonb_build_object('ok', true, 'stored', false, 'unchanged', true);
  end if;

  insert into public.menu_snapshots (restaurant_id, format, content, content_hash, bytes, source_machine)
  values (v_rest, 1, p_snapshot, v_hash, v_bytes, left(btrim(coalesce(p_machine, '')), 200));
  -- keep the newest 10 copies, so a mistaken change can be undone by support
  delete from public.menu_snapshots where restaurant_id = v_rest
    and id not in (select id from public.menu_snapshots where restaurant_id = v_rest order by id desc limit 10);
  select count(*) into v_count from public.menu_snapshots where restaurant_id = v_rest;
  return jsonb_build_object('ok', true, 'stored', true, 'unchanged', false, 'bytes', v_bytes, 'copies', v_count);
end $$;

create function public.license_menu_get(p_key text, p_machine text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.menu_caller(p_key, p_machine); s public.menu_snapshots;
begin
  if (c->>'ok')::boolean is not true then return c; end if;
  select * into s from public.menu_snapshots where restaurant_id = (c->>'restaurant_id')::uuid order by id desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'found', false); end if;
  return jsonb_build_object('ok', true, 'found', true, 'saved_at', s.created_at, 'bytes', s.bytes, 'content', s.content);
end $$;

-- Only the Edge Function (service role) may call these. Nobody else, including logged-in console users, can read a menu.
revoke execute on function public.keys_within(jsonb, text[]) from public, anon, authenticated;
revoke execute on function public.menu_caller(text, text) from public, anon, authenticated;
revoke execute on function public.license_menu_put(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.license_menu_get(text, text) from public, anon, authenticated;
grant execute on function public.license_menu_put(text, text, jsonb), public.license_menu_get(text, text) to service_role;
