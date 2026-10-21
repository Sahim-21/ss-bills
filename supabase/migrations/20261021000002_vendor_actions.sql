-- Everything the vendor team can CHANGE. Each function checks the caller is a vendor admin first,
-- runs as the table owner (security definer), writes an audit event, and returns plain JSON.
-- The portal never writes to tables directly (see the security migration).

-- ---------------------------------------------------------------- who is calling
create function public.is_vendor_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.vendor_admins where user_id = auth.uid()) and public.mfa_ok()
$$;

create function public.assert_vendor_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_vendor_admin() then
    raise exception 'Not allowed' using errcode = '42501', hint = 'Sign in with your authenticator code';
  end if;
end $$;

create function public.assert_super_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.mfa_ok() and exists (select 1 from public.vendor_admins where user_id = auth.uid() and role = 'super_admin')) then
    raise exception 'Only a super admin can do this' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
-- Audit log entry. `p_actor` names a non-human actor (for example 'Restaurant PC').
create function public.log_event(
  p_restaurant uuid, p_event text, p_reason text default '', p_payload jsonb default '{}'::jsonb, p_actor text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from public.vendor_admins where user_id = auth.uid();
  insert into public.license_events (restaurant_id, event, reason, actor_id, actor_name, payload)
  values (p_restaurant, p_event, coalesce(p_reason, ''), auth.uid(),
          coalesce(p_actor, v_name, 'System'), coalesce(p_payload, '{}'::jsonb));
end $$;

-- 16 hex characters from a random UUID (64 bits), shown as XXXX-XXXX-XXXX-XXXX.
create function public.generate_license_key() returns text
language plpgsql volatile set search_path = public as $$
declare k text;
begin
  loop
    k := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    k := substr(k, 1, 4) || '-' || substr(k, 5, 4) || '-' || substr(k, 9, 4) || '-' || substr(k, 13, 4);
    exit when not exists (select 1 from public.licenses where license_key = k);
  end loop;
  return k;
end $$;

-- What a period costs. Prices exclude GST; an override is the final amount actually agreed (GST inside).
create function public.calc_charge(
  p_price integer, p_periods integer, p_override integer,
  out subtotal integer, out gst integer, out total integer
) language plpgsql stable as $$
declare bp integer := public.setting_int('gst_bp', 1800);
begin
  if p_override is not null then
    total := p_override;
    gst := total - round(total::numeric * 10000 / (10000 + bp))::integer;
    subtotal := total - gst;
  else
    subtotal := p_price * p_periods;
    gst := round(subtotal::numeric * bp / 10000)::integer;
    total := subtotal + gst;
  end if;
end $$;

create function public.require_text(p_value text, p_label text) returns text
language plpgsql immutable as $$
begin
  if p_value is null or btrim(p_value) = '' then
    raise exception '% is required', p_label;
  end if;
  return btrim(p_value);
end $$;

create function public.check_gstin(p_gstin text) returns text
language plpgsql immutable as $$
declare g text := nullif(upper(btrim(coalesce(p_gstin, ''))), '');
begin
  if g is not null and g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
    raise exception 'GSTIN does not look valid';
  end if;
  return g;
end $$;

create function public.check_email(p_email text) returns text
language plpgsql immutable as $$
declare e text := btrim(coalesce(p_email, ''));
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  return e;
end $$;

-- ---------------------------------------------------------------- clients
-- Onboard a restaurant: creates the restaurant, its license and key, and optionally records the
-- first payment. Returns the key to hand over.
create function public.vendor_create_client(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_plan public.plans;
  v_rest uuid;
  v_lic uuid;
  v_name text := public.require_text(p->>'name', 'Restaurant name');
  v_owner text := public.require_text(p->>'owner_name', 'Owner name');
  v_phone text := public.require_text(p->>'phone', 'Phone');
  v_email text := public.check_email(p->>'email');
  v_city text := public.require_text(p->>'city', 'City');
  v_gstin text := public.check_gstin(p->>'gstin');
  v_start timestamptz;
  v_exp timestamptz;
  v_devices integer;
  v_code text;
  v_key text;
  v_pay jsonb := p->'payment';
  v_charge record;
  v_method text;
begin
  perform public.assert_super_admin();

  select * into v_plan from public.plans where id = p->>'plan_id' and active;
  if not found then raise exception 'Choose a plan'; end if;

  v_start := (coalesce(nullif(p->>'starts_on', '')::date, public.today_ist())::timestamp) at time zone 'Asia/Kolkata';
  v_exp := case when v_plan.duration_days is null then null else v_start + make_interval(days => v_plan.duration_days) end;
  v_devices := coalesce(nullif(p->>'max_devices', '')::integer, v_plan.max_devices);
  if v_devices < 1 or v_devices > 50 then raise exception 'Terminals must be between 1 and 50'; end if;

  v_code := 'CL-' || rpad(upper(substr(regexp_replace(v_city, '[^A-Za-z]', '', 'g'), 1, 3)), 3, 'X')
            || '-' || lpad(nextval('public.restaurant_seq')::text, 4, '0');
  v_key := public.generate_license_key();

  insert into public.restaurants (code, name, owner_name, phone, email, city, address, gstin, notes, created_by)
  values (v_code, v_name, v_owner, v_phone, v_email, v_city, coalesce(btrim(p->>'address'), ''), v_gstin,
          coalesce(btrim(p->>'notes'), ''), auth.uid())
  returning id into v_rest;

  insert into public.licenses (restaurant_id, license_key, plan_id, starts_at, expires_at, max_devices)
  values (v_rest, v_key, v_plan.id, v_start, v_exp, v_devices)
  returning id into v_lic;

  perform public.log_event(v_rest, 'created', '', jsonb_build_object(
    'code', v_code, 'plan', v_plan.id, 'expires_at', v_exp, 'max_devices', v_devices));

  if coalesce((v_pay->>'received')::boolean, false) then
    v_method := coalesce(nullif(v_pay->>'method', ''), 'other');
    select * into v_charge from public.calc_charge(
      v_plan.price_paise, 1, nullif(v_pay->>'amount_paise', '')::integer);
    insert into public.payments (restaurant_id, license_id, plan_id, periods, subtotal_paise, gst_paise,
                                 total_paise, method, reference, period_from, period_to, recorded_by)
    values (v_rest, v_lic, v_plan.id, 1, v_charge.subtotal, v_charge.gst, v_charge.total, v_method,
            coalesce(btrim(v_pay->>'reference'), ''), v_start, v_exp, auth.uid());
  end if;

  return jsonb_build_object('restaurant_id', v_rest, 'code', v_code, 'license_key', v_key,
                            'plan', v_plan.id, 'starts_at', v_start, 'expires_at', v_exp, 'max_devices', v_devices);
end $$;

create function public.vendor_update_client(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  l public.licenses;
  v_changed text[] := '{}';
  v_devices integer;
  v_used integer;
begin
  perform public.assert_vendor_admin();
  select * into r from public.restaurants where id = p_id for update;
  if not found then raise exception 'Restaurant not found'; end if;
  select * into l from public.licenses where restaurant_id = p_id for update;

  if p ? 'name'       then r.name := public.require_text(p->>'name', 'Restaurant name');    v_changed := array_append(v_changed, 'name'); end if;
  if p ? 'owner_name' then r.owner_name := public.require_text(p->>'owner_name', 'Owner name'); v_changed := array_append(v_changed, 'owner_name'); end if;
  if p ? 'phone'      then r.phone := public.require_text(p->>'phone', 'Phone');            v_changed := array_append(v_changed, 'phone'); end if;
  if p ? 'email'      then r.email := public.check_email(p->>'email');                      v_changed := array_append(v_changed, 'email'); end if;
  if p ? 'city'       then r.city := public.require_text(p->>'city', 'City');               v_changed := array_append(v_changed, 'city'); end if;
  if p ? 'address'    then r.address := coalesce(btrim(p->>'address'), '');                 v_changed := array_append(v_changed, 'address'); end if;
  if p ? 'gstin'      then r.gstin := public.check_gstin(p->>'gstin');                      v_changed := array_append(v_changed, 'gstin'); end if;
  if p ? 'notes'      then r.notes := coalesce(btrim(p->>'notes'), '');                     v_changed := array_append(v_changed, 'notes'); end if;

  if p ? 'max_devices' then
    perform public.assert_super_admin(); -- how many terminals a client may use is a commercial decision
    v_devices := (p->>'max_devices')::integer;
    if v_devices < 1 or v_devices > 50 then raise exception 'Terminals must be between 1 and 50'; end if;
    select count(*) into v_used from public.license_devices where license_id = l.id and active;
    if v_devices < v_used then
      raise exception '% terminals are already bound. Reset one first', v_used;
    end if;
    update public.licenses set max_devices = v_devices where id = l.id;
    v_changed := array_append(v_changed, 'max_devices');
  end if;

  update public.restaurants set name = r.name, owner_name = r.owner_name, phone = r.phone, email = r.email,
    city = r.city, address = r.address, gstin = r.gstin, notes = r.notes where id = p_id;

  if cardinality(v_changed) > 0 then
    perform public.log_event(p_id, 'updated', '', jsonb_build_object('changed', to_jsonb(v_changed)));
  end if;
  return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
end $$;

-- ---------------------------------------------------------------- license actions
-- Record a payment and extend the license. The new period starts when the old one ends, or today
-- if it already ended, so paying early never loses days.
create function public.vendor_renew(
  p_restaurant uuid, p_plan text, p_periods integer default 1,
  p_method text default 'other', p_reference text default '',
  p_amount_paise integer default null, p_reactivate boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.licenses;
  v_plan public.plans;
  v_base timestamptz;
  v_new timestamptz;
  v_charge record;
  v_periods integer := coalesce(p_periods, 1);
begin
  perform public.assert_vendor_admin();
  select * into l from public.licenses where restaurant_id = p_restaurant for update;
  if not found then raise exception 'Restaurant not found'; end if;
  select * into v_plan from public.plans where id = p_plan and active;
  if not found then raise exception 'Choose a plan'; end if;
  if v_periods < 1 or v_periods > 60 then raise exception 'Periods must be between 1 and 60'; end if;
  if p_method not in ('cash', 'upi', 'bank', 'cheque', 'card', 'other', 'waived') then
    raise exception 'Choose how the payment was received';
  end if;
  if p_amount_paise is not null and p_amount_paise < 0 then raise exception 'Amount cannot be negative'; end if;
  if l.expires_at is null then raise exception 'This is a lifetime license. It does not need renewing'; end if;
  if l.status = 'suspended' then
    if not coalesce(p_reactivate, false) then
      raise exception 'This license is suspended. Reactivate it, or tick "reactivate" when renewing';
    end if;
  end if;

  if v_plan.duration_days is null then
    v_new := null; v_periods := 1; -- upgrading to lifetime
  else
    v_base := greatest(l.expires_at, now());
    v_new := v_base + make_interval(days => v_plan.duration_days * v_periods);
  end if;

  select * into v_charge from public.calc_charge(v_plan.price_paise, v_periods, p_amount_paise);

  insert into public.payments (restaurant_id, license_id, plan_id, periods, subtotal_paise, gst_paise, total_paise,
                               method, reference, period_from, period_to, recorded_by)
  values (p_restaurant, l.id, v_plan.id, v_periods, v_charge.subtotal, v_charge.gst, v_charge.total,
          p_method, coalesce(btrim(p_reference), ''), coalesce(v_base, now()), v_new, auth.uid());

  update public.licenses set
    plan_id = v_plan.id,
    expires_at = v_new,
    max_devices = greatest(max_devices, v_plan.max_devices),
    status = 'active',
    suspended_reason = null,
    suspended_at = null
  where id = l.id;

  perform public.log_event(p_restaurant, 'renewed', '', jsonb_build_object(
    'plan', v_plan.id, 'periods', v_periods, 'from', l.expires_at, 'to', v_new,
    'total_paise', v_charge.total, 'method', p_method, 'reference', coalesce(btrim(p_reference), '')));
  if l.status = 'suspended' then
    perform public.log_event(p_restaurant, 'reactivated', 'Reactivated with payment', '{}'::jsonb);
  end if;

  return jsonb_build_object('ok', true, 'expires_at', v_new, 'total_paise', v_charge.total,
                            'subtotal_paise', v_charge.subtotal, 'gst_paise', v_charge.gst);
end $$;

-- Takes effect when the restaurant's app next syncs. Their data stays on their PC.
create function public.vendor_suspend(p_restaurant uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.licenses; v_reason text := public.require_text(p_reason, 'A reason');
begin
  perform public.assert_super_admin();
  select * into l from public.licenses where restaurant_id = p_restaurant for update;
  if not found then raise exception 'Restaurant not found'; end if;
  if l.status = 'suspended' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.licenses set status = 'suspended', suspended_reason = v_reason, suspended_at = now() where id = l.id;
  perform public.log_event(p_restaurant, 'suspended', v_reason, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

create function public.vendor_reactivate(p_restaurant uuid, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.licenses;
begin
  perform public.assert_vendor_admin();
  select * into l from public.licenses where restaurant_id = p_restaurant for update;
  if not found then raise exception 'Restaurant not found'; end if;
  if l.status <> 'suspended' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.licenses set status = 'active', suspended_reason = null, suspended_at = null where id = l.id;
  perform public.log_event(p_restaurant, 'reactivated', coalesce(btrim(p_note), ''), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'state', public.license_state('active', l.expires_at, l.plan_id));
end $$;

-- Frees a terminal slot, for when a restaurant changes PC. The old PC stops syncing.
create function public.vendor_reset_device(p_device uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d public.license_devices; l public.licenses; v_reason text := public.require_text(p_reason, 'A reason');
begin
  perform public.assert_vendor_admin();
  select * into d from public.license_devices where id = p_device for update;
  if not found then raise exception 'Terminal not found'; end if;
  if not d.active then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into l from public.licenses where id = d.license_id;
  update public.license_devices set active = false where id = d.id;
  perform public.log_event(l.restaurant_id, 'device_reset', v_reason,
    jsonb_build_object('machine_id', d.machine_id, 'device_name', d.device_name));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- plans and team
create function public.vendor_update_plan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pl public.plans;
begin
  perform public.assert_super_admin();
  select * into pl from public.plans where id = p->>'id' for update;
  if not found then raise exception 'Plan not found'; end if;
  if p ? 'name' then pl.name := public.require_text(p->>'name', 'Plan name'); end if;
  if p ? 'price_paise' then pl.price_paise := (p->>'price_paise')::integer; end if;
  if p ? 'max_devices' then pl.max_devices := (p->>'max_devices')::integer; end if;
  if p ? 'active' then pl.active := (p->>'active')::boolean; end if;
  if pl.price_paise < 0 then raise exception 'Price cannot be negative'; end if;
  if pl.max_devices < 1 or pl.max_devices > 50 then raise exception 'Terminals must be between 1 and 50'; end if;
  update public.plans set name = pl.name, price_paise = pl.price_paise, max_devices = pl.max_devices, active = pl.active
    where id = pl.id;
  perform public.log_event(null, 'plan_updated', '', jsonb_build_object(
    'plan', pl.id, 'price_paise', pl.price_paise, 'max_devices', pl.max_devices, 'active', pl.active));
  return jsonb_build_object('ok', true);
end $$;

-- The person must already exist in Supabase Auth (invite them from the Supabase dashboard first).
create function public.vendor_add_admin(p_email text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_name text := public.require_text(p_name, 'Name');
begin
  perform public.assert_super_admin();
  if p_role not in ('super_admin', 'support') then raise exception 'Choose a role'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'No login exists for that email. Invite them from the Supabase dashboard first';
  end if;
  insert into public.vendor_admins (user_id, name, role) values (v_user, v_name, p_role)
    on conflict (user_id) do update set name = excluded.name, role = excluded.role;
  perform public.log_event(null, 'admin_added', '', jsonb_build_object('email', btrim(p_email), 'role', p_role));
  return jsonb_build_object('ok', true);
end $$;

create function public.vendor_remove_admin(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.vendor_admins;
begin
  perform public.assert_super_admin();
  if p_user = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  select * into a from public.vendor_admins where user_id = p_user;
  if not found then raise exception 'Not a team member'; end if;
  if a.role = 'super_admin' and (select count(*) from public.vendor_admins where role = 'super_admin') <= 1 then
    raise exception 'There must always be one super admin';
  end if;
  delete from public.vendor_admins where user_id = p_user;
  perform public.log_event(null, 'admin_removed', '', jsonb_build_object('name', a.name));
  return jsonb_build_object('ok', true);
end $$;
