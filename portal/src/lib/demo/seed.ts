// Demo data for the browser demo: a believable fleet of restaurants, built by calling the real
// database functions (so the audit log, payments and states are all genuine) plus bulk daily summaries.
// Dates are relative to today, so the demo always looks current.

export const DEMO_BOSS_ID = "00000000-0000-4000-8000-0000000000a1";
export const DEMO_SUPPORT_ID = "00000000-0000-4000-8000-0000000000a2";
export const DEMO_EMAIL = "rajesh.verma@ssbills.in";
export const DEMO_CODE = "123456";

export const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public to anon, authenticated, service_role;
`;

export const SEED = `
insert into auth.users (id, email) values
  ('${DEMO_BOSS_ID}', '${DEMO_EMAIL}'),
  ('${DEMO_SUPPORT_ID}', 'pooja.sharma@ssbills.in');
insert into public.vendor_admins (user_id, name, role) values
  ('${DEMO_BOSS_ID}', 'Rajesh Verma', 'super_admin'),
  ('${DEMO_SUPPORT_ID}', 'Pooja Sharma', 'support');

-- act as the super admin so the audit log names a person
select set_config('request.jwt.claim.sub', '${DEMO_BOSS_ID}', false),
       set_config('request.jwt.claims', '{"sub":"${DEMO_BOSS_ID}","aal":"aal2"}', false);
select setseed(0.37);

do $seed$
declare
  -- name, owner, city, plan, days since the license started, terminals, daily sales in rupees, quiet days (no sync), cuisine
  c record;
  r jsonb;
  rid uuid;
  lid uuid;
  d integer;
  i integer;
  base numeric;
  sales bigint;
  bills integer;
  upi bigint; card bigint; cash bigint;
  v_exp timestamptz;
  k integer := 0;
  v_start date;
  v_phone text;
begin
  for c in select * from (values
    ('Punjab Grill Express',   'Harpreet Singh',   'Delhi NCR', 'yearly',   300, 3, 140000, 0, array['Butter Chicken','Dal Makhani','Garlic Naan']),
    ('Bawarchi Grand',         'Syed Khaleel',     'Hyderabad', 'yearly',   361, 3,  55000, 0, array['Chicken Biryani','Mutton Haleem','Double Ka Meetha']),
    ('The Saffron Lounge',     'Ananya Sen',       'Mumbai',    'monthly',   26, 1,  45000, 0, array['Paneer Tikka','Veg Kolhapuri','Masala Chai']),
    ('Coastal Spice Kiosk',    'Pramod Joshi',     'Pune',      'monthly',   36, 1,  20000, 0, array['Fish Curry Meals','Prawn Fry','Solkadhi']),
    ('Hotel Annapurna',        'Ramanathan Iyer',  'Pune',      'yearly',   380, 2,  18000, 18, array['Thali','Masala Dosa','Filter Coffee']),
    ('Spice Garden',           'Manish Kapoor',    'Hyderabad', 'yearly',   400, 3,  64000, 0, array['Hyderabadi Chicken Dum Biryani','Mutton Haleem','Paneer Butter Masala']),
    ('Dosa Plaza Indiranagar', 'Venkatesh Murthy', 'Bengaluru', 'yearly',   180, 2,  78000, 0, array['Masala Dosa','Idli Vada','Filter Coffee']),
    ('Karim''s Heritage',      'Zeeshan Ahmed',    'Delhi NCR', 'lifetime', 700, 4,  95000, 0, array['Mutton Korma','Seekh Kebab','Butter Naan']),
    ('Peshawari Zaika',        'Vikram Malhotra',  'Mumbai',    'yearly',    12, 2,  38000, 0, array['Dal Bukhara','Tandoori Platter','Kulcha']),
    ('Haldiram''s Express',    'Rohit Agarwal',    'Delhi NCR', 'monthly',   17, 1,  71000, 0, array['Chaat','Pav Bhaji','Gulab Jamun']),
    ('Chai Point Franchise 14','Ritu Menon',       'Bengaluru', 'monthly',   29, 1,  26000, 0, array['Masala Chai','Samosa','Bun Maska']),
    ('Biryani Blues',          'Aamir Qureshi',    'Hyderabad', 'yearly',   120, 2,  47000, 0, array['Chicken Biryani','Mirchi Ka Salan','Raita']),
    ('Udupi Kitchen',          'Sunil Shetty',     'Bengaluru', 'yearly',   220, 2,  33000, 0, array['Ghee Roast Dosa','Medu Vada','Rava Idli']),
    ('Gokul Sweets',           'Nitin Gokhale',    'Pune',      'monthly',   22, 1,  15000, 10, array['Kaju Katli','Jalebi','Samosa'])
  ) as t(name, owner, city, plan, started, devices, daily, quiet, items)
  loop
    k := k + 1;
    v_start := public.today_ist() - c.started;
    v_phone := '+91 9' || lpad((8000000000 + k * 7919317)::text, 9, '0');
    r := public.vendor_create_client(jsonb_build_object(
      'name', c.name, 'owner_name', c.owner, 'phone', v_phone,
      'email', lower(regexp_replace(split_part(c.owner, ' ', 1), '[^A-Za-z]', '', 'g')) || '@' ||
               lower(regexp_replace(c.name, '[^A-Za-z]', '', 'g')) || '.in',
      'city', c.city, 'address', 'Main road, ' || c.city, 'plan_id', c.plan,
      'starts_on', v_start::text, 'max_devices', c.devices,
      'payment', jsonb_build_object('received', true, 'method', 'upi', 'reference', 'UTR' || (4000 + k * 137))));
    rid := (r->>'restaurant_id')::uuid;
    select id into lid from public.licenses where restaurant_id = rid;

    -- Spice Garden: renewed once after its first year lapsed (before its terminals are linked)
    if c.name = 'Spice Garden' then
      perform public.vendor_renew(rid, 'yearly', 1, 'bank', 'NEFT 88231', null, false);
    end if;

    -- terminals. An expired license refuses new terminals, so lift the expiry just while linking them.
    select expires_at into v_exp from public.licenses where id = lid;
    update public.licenses set expires_at = now() + interval '1 day' where id = lid and expires_at is not null;
    for i in 1..c.devices loop
      perform public.license_activate(r->>'license_key', 'HW-' || (r->>'code') || '-' || i,
                                      case i when 1 then 'Front counter' when 2 then 'Kitchen' else 'Terminal ' || i end, '0.1.0');
    end loop;
    update public.licenses set expires_at = v_exp where id = lid;
    update public.licenses set last_check_in_at = now() - make_interval(days => c.quiet, hours => floor(random() * 5)::int, mins => floor(random() * 50)::int)
      where id = lid;

    -- daily summaries since the license began (at most 90 days), stopping when the PC went quiet
    for d in reverse least(89, c.started)..c.quiet loop
      base := c.daily * (case extract(dow from public.today_ist() - d) when 0 then 1.35 when 6 then 1.3 when 5 then 1.15 else 0.92 end)
                      * (0.82 + random() * 0.36)
                      * (0.9 + 0.2 * (1 - d / 90.0));          -- gentle growth toward today
      sales := round(base * 100) - (round(base * 100)::bigint % 100);
      bills := greatest(1, round(base / (180 + random() * 140))::int);
      upi := round(sales * (0.55 + random() * 0.08)); card := round(sales * (0.12 + random() * 0.05)); cash := sales - upi - card;
      insert into public.daily_summary (restaurant_id, date, sales_paise, bills, cancelled, cash_paise, upi_paise, card_paise,
                                        tax_paise, top_item_name, top_item_qty, synced_at)
      values (rid, public.today_ist() - d, sales, bills, floor(random() * 3)::int, cash, upi, card, round(sales * 5 / 105.0),
              c.items[1 + floor(random() * array_length(c.items, 1))::int], 8 + floor(random() * 40)::int,
              (public.today_ist() - d + 1)::timestamptz);
    end loop;

    -- Hotel Annapurna: suspended for non-payment
    if c.name = 'Hotel Annapurna' then
      perform public.vendor_suspend(rid, 'Payment overdue for 15 days');
    end if;
  end loop;
end
$seed$;

-- Give the audit log believable times (it is append-only for the app; the seed may adjust it once).
alter table public.license_events disable trigger license_events_append_only;
update public.license_events e set created_at = case e.event
    when 'created' then l.starts_at
    when 'activated' then l.starts_at + interval '3 hours'
    when 'device_bound' then l.starts_at + interval '5 hours'
    else e.created_at end
  from public.licenses l where l.restaurant_id = e.restaurant_id and e.event in ('created', 'activated', 'device_bound');
update public.license_events set created_at = now() - interval '18 hours' where event = 'suspended';
update public.license_events set created_at = now() - interval '4 days' where event = 'renewed';
alter table public.license_events enable trigger license_events_append_only;
update public.payments p set created_at = l.starts_at from public.licenses l where l.id = p.license_id and p.created_at > l.starts_at and p.period_from = l.starts_at;
update public.restaurants r set created_at = l.starts_at from public.licenses l where l.restaurant_id = r.id;
select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);
`;
