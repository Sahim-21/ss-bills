-- Lock everything down. The portal and the restaurant apps never touch tables directly:
--   * a logged-in vendor admin can only call the vendor_* functions (each re-checks who is calling);
--   * the restaurant apps reach license_activate / license_checkin only through Edge Functions,
--     which use the service role;
--   * anyone else (anon, non-admin users) can do nothing.

alter table public.app_settings    enable row level security;
alter table public.plans           enable row level security;
alter table public.vendor_admins   enable row level security;
alter table public.restaurants     enable row level security;
alter table public.licenses        enable row level security;
alter table public.license_devices enable row level security;
alter table public.payments        enable row level security;
alter table public.daily_summary   enable row level security;
alter table public.license_events  enable row level security;
-- No policies on purpose: with row level security on and no policy, anon and authenticated see nothing.

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Supabase grants new tables to anon/authenticated by default. Stop that for anything added later too
-- (a new table must also enable row level security, see supabase/README.md).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Functions are executable by everyone by default. Close that, then open only what is meant to be open.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function
  public.vendor_me(),
  public.vendor_overview(integer),
  public.vendor_list_clients(jsonb),
  public.vendor_client(uuid),
  public.vendor_list_licenses(jsonb),
  public.vendor_sales_insights(date, date),
  public.vendor_activity(jsonb),
  public.vendor_plans(),
  public.vendor_config(),
  public.vendor_team(),
  public.vendor_create_client(jsonb),
  public.vendor_update_client(uuid, jsonb),
  public.vendor_renew(uuid, text, integer, text, text, integer, boolean),
  public.vendor_suspend(uuid, text),
  public.vendor_reactivate(uuid, text),
  public.vendor_reset_device(uuid, text),
  public.vendor_update_plan(jsonb),
  public.vendor_add_admin(text, text, text),
  public.vendor_remove_admin(uuid)
to authenticated;

grant execute on function
  public.license_activate(text, text, text, text),
  public.license_checkin(text, text, text, jsonb)
to service_role;
