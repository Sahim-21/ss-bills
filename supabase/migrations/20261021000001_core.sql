-- SS Bills central backend (vendor side), docs/TRD.md §7.
-- Holds licenses, restaurants, devices, payments, and DAILY SUMMARIES only. Bills never leave the
-- restaurant's PC. Money is integer paise. Timestamps are timestamptz; "today" means India time.

-- ---------------------------------------------------------------- settings
create table public.app_settings (
  key   text primary key,
  value text not null
);

insert into public.app_settings (key, value) values
  ('grace_days',    '7'),   -- after a license expires, billing keeps working this long
  ('expiring_days', '30'),  -- "expiring soon" window for yearly licenses
  ('expiring_days_monthly', '7'), -- ...and for monthly ones (30 days would flag them as expiring all their life)
  ('offline_days',  '7'),   -- a restaurant that hasn't checked in for this long shows as offline
  ('gst_bp',        '1800'), -- GST on SS Bills' own invoices (18.00%)
  ('require_mfa',   '1');    -- 1 = vendor functions need a two-factor (TOTP) session, 0 = password only

create function public.setting_int(p_key text, p_default integer)
returns integer language sql stable as $$
  select coalesce((select value::integer from public.app_settings where key = p_key), p_default)
$$;

-- True when the caller's login passed two-factor (Supabase marks that session "aal2").
create function public.mfa_ok() returns boolean language sql stable as $$
  select public.setting_int('require_mfa', 1) = 0 or coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- ---------------------------------------------------------------- plans
-- Prices are placeholders from the design (docs/DECISIONS.md O-5). Editable by a super admin.
create table public.plans (
  id            text primary key,
  name          text not null,
  kind          text not null check (kind in ('monthly', 'yearly', 'lifetime')),
  duration_days integer check (duration_days is null or duration_days > 0),
  price_paise   integer not null check (price_paise >= 0),
  max_devices   integer not null check (max_devices between 1 and 50),
  active        boolean not null default true,
  check ((kind = 'lifetime') = (duration_days is null))
);

insert into public.plans (id, name, kind, duration_days, price_paise, max_devices) values
  ('monthly',  'Monthly Standard', 'monthly',  30,   249900, 1),
  ('yearly',   'Yearly Pro',       'yearly',   365,  2499900, 3),
  ('lifetime', 'Lifetime POS',     'lifetime', null, 5999900, 5);

-- ---------------------------------------------------------------- vendor team
-- auth.users is Supabase's own table. Only people listed here can use the portal.
create table public.vendor_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null,
  role       text not null check (role in ('super_admin', 'support')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- restaurants
create sequence public.restaurant_seq start 1;

create table public.restaurants (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,          -- e.g. CL-HYD-0001
  name       text not null,
  owner_name text not null,
  phone      text not null,
  email      text not null,
  city       text not null,
  address    text not null default '',
  gstin      text,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid
);
create index idx_restaurants_city on public.restaurants (city);

-- One license per restaurant. The license allows up to max_devices PCs (terminals).
create table public.licenses (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null unique references public.restaurants (id),
  license_key      text not null unique,
  plan_id          text not null references public.plans (id),
  status           text not null default 'active' check (status in ('active', 'suspended')),
  starts_at        timestamptz not null,
  expires_at       timestamptz,               -- null = lifetime
  max_devices      integer not null check (max_devices between 1 and 50),
  suspended_reason text,
  suspended_at     timestamptz,
  last_check_in_at timestamptz,
  app_version      text,
  created_at       timestamptz not null default now()
);

create table public.license_devices (
  id            uuid primary key default gen_random_uuid(),
  license_id    uuid not null references public.licenses (id),
  machine_id    text not null,
  device_name   text not null default '',
  app_version   text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  active        boolean not null default true,  -- false after the vendor resets the binding
  unique (license_id, machine_id)
);

-- Money received for a license period, recorded by hand (no payment gateway yet, D-026).
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id),
  license_id    uuid not null references public.licenses (id),
  plan_id       text not null references public.plans (id),
  periods       integer not null check (periods >= 1),
  subtotal_paise integer not null check (subtotal_paise >= 0),
  gst_paise     integer not null check (gst_paise >= 0),
  total_paise   integer not null check (total_paise >= 0),
  method        text not null check (method in ('cash', 'upi', 'bank', 'cheque', 'card', 'other', 'waived')),
  reference     text not null default '',
  period_from   timestamptz not null,
  period_to     timestamptz,
  recorded_by   uuid,
  created_at    timestamptz not null default now()
);
create index idx_payments_restaurant on public.payments (restaurant_id, created_at desc);

-- One row per restaurant per day, uploaded by the restaurant app (never full bills).
create table public.daily_summary (
  restaurant_id uuid not null references public.restaurants (id),
  date          date not null,
  sales_paise   bigint not null default 0 check (sales_paise >= 0),
  bills         integer not null default 0 check (bills >= 0),
  cancelled     integer not null default 0 check (cancelled >= 0),
  cash_paise    bigint not null default 0 check (cash_paise >= 0),
  upi_paise     bigint not null default 0 check (upi_paise >= 0),
  card_paise    bigint not null default 0 check (card_paise >= 0),
  tax_paise     bigint not null default 0 check (tax_paise >= 0),
  top_item_name text,
  top_item_qty  integer,
  synced_at     timestamptz not null default now(),
  primary key (restaurant_id, date)
);
create index idx_daily_summary_date on public.daily_summary (date);

-- Activity / audit log. Append-only: updates and deletes are blocked by a trigger.
create table public.license_events (
  id            bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants (id),
  event         text not null check (event in (
                  'created', 'updated', 'renewed', 'suspended', 'reactivated',
                  'device_bound', 'device_reset', 'activated',
                  'plan_updated', 'admin_added', 'admin_removed')),
  reason        text not null default '',
  actor_id      uuid,
  actor_name    text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index idx_events_created on public.license_events (created_at desc);
create index idx_events_restaurant on public.license_events (restaurant_id, created_at desc);
create index idx_events_event on public.license_events (event);

create function public.block_event_changes() returns trigger language plpgsql as $$
begin
  raise exception 'The activity log is append-only' using errcode = '42501';
end $$;

create trigger license_events_append_only
  before update or delete on public.license_events
  for each row execute function public.block_event_changes();

-- ---------------------------------------------------------------- derived state
-- suspended > expired (past grace) > grace > expiring (within the window) > active.
-- The "expiring" window depends on the plan: a monthly license is only "expiring" in its last week.
create function public.license_state(p_status text, p_expires timestamptz, p_plan text default null)
returns text language sql stable as $$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_expires is null then 'active'
    when p_expires + make_interval(days => public.setting_int('grace_days', 7)) < now() then 'expired'
    when p_expires < now() then 'grace'
    when p_expires < now() + make_interval(days => case
           when (select kind from public.plans where id = p_plan) = 'monthly' then public.setting_int('expiring_days_monthly', 7)
           else public.setting_int('expiring_days', 30) end) then 'expiring'
    else 'active'
  end
$$;

-- India calendar date for "today".
create function public.today_ist() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;
