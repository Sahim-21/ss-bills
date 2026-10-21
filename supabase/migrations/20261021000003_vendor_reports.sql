-- Everything the vendor team can READ, shaped for the portal screens. All return JSON.
-- "Offline" = no check-in for offline_days (counted from creation if it never checked in).
-- Status buckets used by the filter chips:
--   active   = license_state 'active'
--   expiring = 'expiring', 'grace' or 'expired'   (needs a renewal)
--   suspended
--   offline  = offline and not suspended (cuts across the others)

create function public.is_offline(p_check_in timestamptz, p_created timestamptz) returns boolean
language sql stable as $$
  select coalesce(p_check_in, p_created) < now() - make_interval(days => public.setting_int('offline_days', 7))
$$;

-- ---------------------------------------------------------------- overview
create function public.vendor_overview(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 400);
  v_from date := public.today_ist() - (least(greatest(coalesce(p_days, 30), 1), 400) - 1);
  v_to date := public.today_ist();
  v_prev_from date := public.today_ist() - 2 * (least(greatest(coalesce(p_days, 30), 1), 400)) + 1;
  v_prev_to date := public.today_ist() - least(greatest(coalesce(p_days, 30), 1), 400);
  v_counts jsonb;
  v_series jsonb;
  v_total bigint;
  v_prev bigint;
  v_top jsonb;
  v_attention jsonb;
  v_recent jsonb;
begin
  perform public.assert_vendor_admin();

  with b as (
    select public.license_state(l.status, l.expires_at, l.plan_id) as state,
           public.is_offline(l.last_check_in_at, l.created_at) as offline,
           r.created_at
    from public.licenses l join public.restaurants r on r.id = l.restaurant_id
  )
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where state = 'active'),
    'expiring', count(*) filter (where state in ('expiring', 'grace', 'expired')),
    'suspended', count(*) filter (where state = 'suspended'),
    'offline', count(*) filter (where offline and state <> 'suspended'),
    'enrolled_this_month', count(*) filter (where date_trunc('month', created_at at time zone 'Asia/Kolkata')
                                                 = date_trunc('month', now() at time zone 'Asia/Kolkata'))
  ) into v_counts from b;

  select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'sales_paise', coalesce(s.sales, 0),
                                               'bills', coalesce(s.bills, 0), 'outlets', coalesce(s.outlets, 0))
                           order by d), '[]'::jsonb)
  into v_series
  from generate_series(v_from, v_to, interval '1 day') d
  left join (select date, sum(sales_paise) sales, sum(bills) bills, count(*) outlets
             from public.daily_summary where date between v_from and v_to group by date) s on s.date = d::date;

  select coalesce(sum(sales_paise), 0) into v_total from public.daily_summary where date between v_from and v_to;
  select coalesce(sum(sales_paise), 0) into v_prev from public.daily_summary where date between v_prev_from and v_prev_to;

  select coalesce(jsonb_agg(t order by (t->>'sales_paise')::bigint desc), '[]'::jsonb) into v_top from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'city', r.city,
                              'sales_paise', sum(ds.sales_paise), 'bills', sum(ds.bills)) t
    from public.daily_summary ds join public.restaurants r on r.id = ds.restaurant_id
    where ds.date between v_from and v_to
    group by r.id order by sum(ds.sales_paise) desc limit 5) x;

  select coalesce(jsonb_agg(a order by (a->>'severity')::int, a->>'expires_at'), '[]'::jsonb) into v_attention from (
    select jsonb_build_object(
      'id', r.id, 'code', r.code, 'name', r.name, 'city', r.city, 'plan_id', l.plan_id, 'plan_name', pl.name,
      'state', public.license_state(l.status, l.expires_at, l.plan_id), 'expires_at', l.expires_at,
      'days_left', case when l.expires_at is null then null else ceil(extract(epoch from (l.expires_at - now())) / 86400)::int end,
      'last_check_in_at', l.last_check_in_at, 'suspended_reason', l.suspended_reason,
      'offline', public.is_offline(l.last_check_in_at, l.created_at),
      'severity', case public.license_state(l.status, l.expires_at, l.plan_id)
                    when 'suspended' then 1 when 'expired' then 2 when 'grace' then 3 when 'expiring' then 4 else 5 end
    ) a
    from public.licenses l join public.restaurants r on r.id = l.restaurant_id join public.plans pl on pl.id = l.plan_id
    where public.license_state(l.status, l.expires_at, l.plan_id) <> 'active'
       or public.is_offline(l.last_check_in_at, l.created_at)
    limit 12) x;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('id', ev.id, 'event', ev.event, 'reason', ev.reason, 'actor_name', ev.actor_name,
                              'restaurant_id', ev.restaurant_id, 'restaurant_name', r.name, 'payload', ev.payload,
                              'created_at', ev.created_at) e
    from public.license_events ev left join public.restaurants r on r.id = ev.restaurant_id
    order by ev.created_at desc, ev.id desc limit 8) x;

  return jsonb_build_object(
    'counts', v_counts,
    'gmv', jsonb_build_object('total_paise', v_total, 'prev_total_paise', v_prev, 'days', v_days, 'series', v_series),
    'top_clients', v_top, 'attention', v_attention, 'recent', v_recent);
end $$;

-- ---------------------------------------------------------------- clients
-- p: { status, plan, city, search, limit, offset }
create function public.vendor_list_clients(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_status text := coalesce(p->>'status', 'all');
  v_plan text := nullif(p->>'plan', '');
  v_city text := nullif(btrim(coalesce(p->>'city', '')), '');
  v_search text := lower(nullif(btrim(coalesce(p->>'search', '')), ''));
  v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 25), 1), 100);
  v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_counts jsonb;
  v_total integer;
  v_rows jsonb;
  v_cities jsonb;
begin
  perform public.assert_vendor_admin();

  with base as (
    select r.id, r.code, r.name, r.city, r.owner_name, r.phone, r.email, l.license_key,
           l.plan_id, pl.name as plan_name, l.expires_at, l.last_check_in_at, l.max_devices, l.status,
           public.license_state(l.status, l.expires_at, l.plan_id) as state,
           public.is_offline(l.last_check_in_at, l.created_at) as offline,
           coalesce(ds.sales_paise, 0) as today_sales_paise, coalesce(ds.bills, 0) as today_bills,
           (select count(*) from public.license_devices d where d.license_id = l.id and d.active) as devices_used
    from public.restaurants r
    join public.licenses l on l.restaurant_id = r.id
    join public.plans pl on pl.id = l.plan_id
    left join public.daily_summary ds on ds.restaurant_id = r.id and ds.date = public.today_ist()
  ), scoped as (
    select * from base
    where (v_plan is null or plan_id = v_plan)
      and (v_city is null or lower(city) = lower(v_city))
      and (v_search is null
           or position(v_search in lower(name)) > 0 or position(v_search in lower(city)) > 0
           or position(v_search in lower(code)) > 0 or position(v_search in lower(license_key)) > 0
           or position(v_search in lower(owner_name)) > 0)
  ), picked as (
    select * from scoped
    where case v_status
            when 'active' then state = 'active'
            when 'expiring' then state in ('expiring', 'grace', 'expired')
            when 'suspended' then state = 'suspended'
            when 'offline' then offline and state <> 'suspended'
            else true end
  )
  select
    (select jsonb_build_object(
        'all', count(*), 'active', count(*) filter (where state = 'active'),
        'expiring', count(*) filter (where state in ('expiring', 'grace', 'expired')),
        'suspended', count(*) filter (where state = 'suspended'),
        'offline', count(*) filter (where offline and state <> 'suspended')) from scoped),
    (select count(*) from picked),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb)
       from (select * from picked order by name limit v_limit offset v_offset) x)
  into v_counts, v_total, v_rows;

  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'n', n) order by n desc, city), '[]'::jsonb) into v_cities
  from (select city, count(*) n from public.restaurants group by city order by count(*) desc, city limit 8) c;

  return jsonb_build_object('total', v_total, 'counts', v_counts, 'rows', v_rows, 'cities', v_cities);
end $$;

-- One restaurant with everything the detail page shows.
create function public.vendor_client(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.restaurants;
  l public.licenses;
  pl public.plans;
  v_from date := public.today_ist() - 29;
  v_summaries jsonb; v_totals jsonb; v_devices jsonb; v_events jsonb; v_payments jsonb;
begin
  perform public.assert_vendor_admin();
  select * into r from public.restaurants where id = p_id;
  if not found then raise exception 'Restaurant not found'; end if;
  select * into l from public.licenses where restaurant_id = p_id;
  select * into pl from public.plans where id = l.plan_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', date, 'sales_paise', sales_paise, 'bills', bills, 'cancelled', cancelled, 'cash_paise', cash_paise,
    'upi_paise', upi_paise, 'card_paise', card_paise, 'tax_paise', tax_paise, 'top_item_name', top_item_name,
    'top_item_qty', top_item_qty, 'synced_at', synced_at) order by date), '[]'::jsonb)
  into v_summaries from public.daily_summary where restaurant_id = p_id and date >= v_from;

  select jsonb_build_object(
    'sales_paise', coalesce(sum(sales_paise), 0), 'bills', coalesce(sum(bills), 0),
    'cancelled', coalesce(sum(cancelled), 0), 'cash_paise', coalesce(sum(cash_paise), 0),
    'upi_paise', coalesce(sum(upi_paise), 0), 'card_paise', coalesce(sum(card_paise), 0),
    'tax_paise', coalesce(sum(tax_paise), 0))
  into v_totals from public.daily_summary where restaurant_id = p_id and date >= v_from;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'machine_id', machine_id, 'device_name', device_name, 'app_version', app_version,
    'first_seen_at', first_seen_at, 'last_seen_at', last_seen_at, 'active', active) order by first_seen_at), '[]'::jsonb)
  into v_devices from public.license_devices where license_id = l.id;

  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_events from (
    select jsonb_build_object('id', id, 'event', event, 'reason', reason, 'actor_name', actor_name,
                              'payload', payload, 'created_at', created_at) e
    from public.license_events where restaurant_id = p_id order by created_at desc, id desc limit 50) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'plan_id', plan_id, 'periods', periods, 'subtotal_paise', subtotal_paise, 'gst_paise', gst_paise,
    'total_paise', total_paise, 'method', method, 'reference', reference, 'period_from', period_from,
    'period_to', period_to, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
  into v_payments from public.payments where restaurant_id = p_id;

  return jsonb_build_object(
    'restaurant', to_jsonb(r),
    'license', jsonb_build_object(
      'license_key', l.license_key, 'plan_id', l.plan_id, 'plan_name', pl.name, 'plan_price_paise', pl.price_paise,
      'status', l.status, 'state', public.license_state(l.status, l.expires_at, l.plan_id), 'starts_at', l.starts_at,
      'expires_at', l.expires_at, 'max_devices', l.max_devices, 'suspended_reason', l.suspended_reason,
      'suspended_at', l.suspended_at, 'last_check_in_at', l.last_check_in_at, 'app_version', l.app_version,
      'offline', public.is_offline(l.last_check_in_at, l.created_at)),
    'devices', v_devices, 'summaries', v_summaries, 'totals', v_totals, 'events', v_events, 'payments', v_payments);
end $$;

-- ---------------------------------------------------------------- licenses & renewals
-- p: { tab: expiring|expired|suspended|all, horizon_days, plan, search }
create function public.vendor_list_licenses(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tab text := coalesce(p->>'tab', 'expiring');
  v_horizon integer := nullif(p->>'horizon_days', '')::integer;
  v_plan text := nullif(p->>'plan', '');
  v_search text := lower(nullif(btrim(coalesce(p->>'search', '')), ''));
  v_strip jsonb; v_counts jsonb; v_rows jsonb;
begin
  perform public.assert_vendor_admin();

  with base as (
    select r.id as restaurant_id, r.code, r.name, r.city, r.owner_name, r.phone, l.license_key, l.plan_id,
           pl.name as plan_name, pl.price_paise, pl.kind, l.expires_at, l.max_devices, l.suspended_reason,
           public.license_state(l.status, l.expires_at, l.plan_id) as state,
           case when l.expires_at is null then null else ceil(extract(epoch from (l.expires_at - now())) / 86400)::int end as days_left,
           (select count(*) from public.license_devices d where d.license_id = l.id and d.active) as devices_used
    from public.licenses l join public.restaurants r on r.id = l.restaurant_id join public.plans pl on pl.id = l.plan_id
  ), scoped as (
    select * from base
    where (v_plan is null or plan_id = v_plan)
      and (v_search is null or position(v_search in lower(name)) > 0 or position(v_search in lower(city)) > 0
           or position(v_search in lower(license_key)) > 0 or position(v_search in lower(code)) > 0)
  )
  select
    (select jsonb_build_object(
       'due_this_month', count(*) filter (where expires_at is not null and state <> 'suspended'
            and (expires_at at time zone 'Asia/Kolkata') < date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '1 month'),
       'pipeline_paise', coalesce(sum(price_paise) filter (where state = 'expiring' and kind <> 'lifetime'), 0),
       'in_grace', count(*) filter (where state in ('grace', 'expired')),
       'suspended', count(*) filter (where state = 'suspended')) from base),
    (select jsonb_build_object('expiring', count(*) filter (where state = 'expiring'),
                               'expired', count(*) filter (where state in ('grace', 'expired')),
                               'suspended', count(*) filter (where state = 'suspended'),
                               'all', count(*)) from scoped),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_key, x.name), '[]'::jsonb) from (
       select s.*, coalesce(s.days_left, 999999) as sort_key from scoped s
       where case v_tab
               when 'expiring' then state = 'expiring' and (v_horizon is null or days_left <= v_horizon)
               when 'expired' then state in ('grace', 'expired')
               when 'suspended' then state = 'suspended'
               else true end) x)
  into v_strip, v_counts, v_rows;

  return jsonb_build_object('strip', v_strip, 'counts', v_counts, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------- sales insights
create function public.vendor_sales_insights(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_len integer;
  v_prev_to date; v_prev_from date;
  v_tot jsonb; v_prev jsonb; v_series jsonb; v_prev_series jsonb; v_clients jsonb; v_cities jsonb;
begin
  perform public.assert_vendor_admin();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'Pick a range of at most 400 days'; end if;
  v_len := (p_to - p_from) + 1;
  v_prev_to := p_from - 1;
  v_prev_from := p_from - v_len;

  select jsonb_build_object('sales_paise', coalesce(sum(sales_paise), 0), 'bills', coalesce(sum(bills), 0),
    'cash_paise', coalesce(sum(cash_paise), 0), 'upi_paise', coalesce(sum(upi_paise), 0),
    'card_paise', coalesce(sum(card_paise), 0)) into v_tot
  from public.daily_summary where date between p_from and p_to;

  select jsonb_build_object('sales_paise', coalesce(sum(sales_paise), 0), 'bills', coalesce(sum(bills), 0))
  into v_prev from public.daily_summary where date between v_prev_from and v_prev_to;

  select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'sales_paise', coalesce(s.sales, 0),
                                               'bills', coalesce(s.bills, 0)) order by d), '[]'::jsonb)
  into v_series from generate_series(p_from, p_to, interval '1 day') d
  left join (select date, sum(sales_paise) sales, sum(bills) bills from public.daily_summary
             where date between p_from and p_to group by date) s on s.date = d::date;

  -- previous period lined up day by day with the current one
  select coalesce(jsonb_agg(jsonb_build_object('date', (d + (v_len || ' days')::interval)::date, 'sales_paise', coalesce(s.sales, 0))
                            order by d), '[]'::jsonb)
  into v_prev_series from generate_series(v_prev_from, v_prev_to, interval '1 day') d
  left join (select date, sum(sales_paise) sales from public.daily_summary
             where date between v_prev_from and v_prev_to group by date) s on s.date = d::date;

  select coalesce(jsonb_agg(c order by (c->>'sales_paise')::bigint desc), '[]'::jsonb) into v_clients from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'city', r.city, 'devices', l.max_devices,
      'sales_paise', cur.sales, 'prev_sales_paise', coalesce(prv.sales, 0), 'bills', cur.bills,
      'avg_ticket_paise', case when cur.bills > 0 then round(cur.sales::numeric / cur.bills)::bigint else 0 end,
      'growth_pct', case when coalesce(prv.sales, 0) > 0 then round((cur.sales - prv.sales)::numeric * 100 / prv.sales, 1) else null end,
      'is_new', coalesce(prv.sales, 0) = 0,
      'top_item', (select top_item_name from public.daily_summary t
                   where t.restaurant_id = r.id and t.date between p_from and p_to and t.top_item_name is not null
                   group by t.top_item_name order by sum(coalesce(t.top_item_qty, 0)) desc, t.top_item_name limit 1)
    ) c
    from (select restaurant_id, sum(sales_paise) sales, sum(bills) bills from public.daily_summary
          where date between p_from and p_to group by restaurant_id) cur
    left join (select restaurant_id, sum(sales_paise) sales from public.daily_summary
               where date between v_prev_from and v_prev_to group by restaurant_id) prv on prv.restaurant_id = cur.restaurant_id
    join public.restaurants r on r.id = cur.restaurant_id
    join public.licenses l on l.restaurant_id = r.id) x;

  select coalesce(jsonb_agg(jsonb_build_object('city', city, 'sales_paise', sales) order by sales desc), '[]'::jsonb) into v_cities from (
    select r.city, sum(ds.sales_paise) sales from public.daily_summary ds join public.restaurants r on r.id = ds.restaurant_id
    where ds.date between p_from and p_to group by r.city order by sum(ds.sales_paise) desc limit 5) y;

  return jsonb_build_object('from', p_from, 'to', p_to, 'days', v_len, 'totals', v_tot, 'prev', v_prev,
                            'series', v_series, 'prev_series', v_prev_series, 'clients', v_clients, 'cities', v_cities);
end $$;

-- ---------------------------------------------------------------- activity log
-- p: { event, actor, from, to, search, limit, offset }
create function public.vendor_activity(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_event text := nullif(p->>'event', '');
  v_actor uuid := nullif(p->>'actor', '')::uuid;
  v_from date := nullif(p->>'from', '')::date;
  v_to date := nullif(p->>'to', '')::date;
  v_search text := lower(nullif(btrim(coalesce(p->>'search', '')), ''));
  v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 25), 1), 100);
  v_offset integer := greatest(coalesce((p->>'offset')::integer, 0), 0);
  v_counts jsonb; v_total integer; v_rows jsonb; v_actors jsonb;
begin
  perform public.assert_vendor_admin();

  with e as (
    select ev.*, r.name as restaurant_name, r.code as restaurant_code, r.city as restaurant_city
    from public.license_events ev left join public.restaurants r on r.id = ev.restaurant_id
    where (v_actor is null or ev.actor_id = v_actor)
      and (v_from is null or (ev.created_at at time zone 'Asia/Kolkata')::date >= v_from)
      and (v_to is null or (ev.created_at at time zone 'Asia/Kolkata')::date <= v_to)
      and (v_search is null or position(v_search in lower(coalesce(r.name, ''))) > 0
           or position(v_search in lower(ev.actor_name)) > 0 or position(v_search in lower(ev.reason)) > 0
           or position(v_search in lower(ev.payload::text)) > 0)
  )
  select
    (select coalesce(jsonb_object_agg(event, n), '{}'::jsonb) from (select event, count(*) n from e group by event) c),
    (select count(*) from e where v_event is null or event = v_event),
    (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb) from (
       select id, restaurant_id, restaurant_name, restaurant_code, restaurant_city, event, reason, actor_id, actor_name,
              payload, created_at
       from e where v_event is null or event = v_event
       order by created_at desc, id desc limit v_limit offset v_offset) x)
  into v_counts, v_total, v_rows;

  select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'name', name, 'role', role) order by name), '[]'::jsonb)
  into v_actors from public.vendor_admins;

  return jsonb_build_object('total', v_total, 'counts', v_counts, 'rows', v_rows, 'actors', v_actors);
end $$;

-- ---------------------------------------------------------------- plans and team (read)
create function public.vendor_plans() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_vendor_admin();
  return (select coalesce(jsonb_agg(to_jsonb(p) order by price_paise), '[]'::jsonb) from public.plans p);
end $$;

create function public.vendor_team() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_vendor_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'name', a.name, 'role', a.role,
                                                       'email', u.email, 'created_at', a.created_at) order by a.created_at), '[]'::jsonb)
          from public.vendor_admins a left join auth.users u on u.id = a.user_id);
end $$;

create function public.vendor_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.vendor_admins;
begin
  select * into a from public.vendor_admins where user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object('user_id', a.user_id, 'name', a.name, 'role', a.role);
end $$;

-- The few numbers the screens need to explain themselves (GST on SS Bills' invoices, grace period, ...).
create function public.vendor_config() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_vendor_admin();
  return jsonb_build_object(
    'gst_bp', public.setting_int('gst_bp', 1800),
    'grace_days', public.setting_int('grace_days', 7),
    'expiring_days', public.setting_int('expiring_days', 30),
    'expiring_days_monthly', public.setting_int('expiring_days_monthly', 7),
    'offline_days', public.setting_int('offline_days', 7));
end $$;
