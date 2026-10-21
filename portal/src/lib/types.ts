// Shapes returned by the database functions in supabase/migrations (all money in paise).

export type Role = "super_admin" | "support";
export type Me = { user_id: string; name: string; role: Role };

/** Derived from status and expiry. See license_state() in the core migration. */
export type LicenseState = "active" | "expiring" | "grace" | "expired" | "suspended";

export type Plan = {
  id: string;
  name: string;
  kind: "monthly" | "yearly" | "lifetime";
  duration_days: number | null;
  price_paise: number;
  max_devices: number;
  active: boolean;
};

export type EventType =
  | "created" | "updated" | "renewed" | "suspended" | "reactivated" | "device_bound" | "device_reset"
  | "activated" | "plan_updated" | "admin_added" | "admin_removed" | "key_regenerated";

export type EventRow = {
  id: number;
  event: EventType;
  reason: string;
  actor_name: string;
  actor_id?: string | null;
  restaurant_id: string | null;
  restaurant_name?: string | null;
  restaurant_code?: string | null;
  restaurant_city?: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Overview = {
  counts: { total: number; active: number; expiring: number; suspended: number; offline: number; enrolled_this_month: number };
  gmv: {
    total_paise: number;
    prev_total_paise: number;
    days: number;
    series: { date: string; sales_paise: number; bills: number; outlets: number }[];
  };
  top_clients: { id: string; name: string; city: string; sales_paise: number; bills: number }[];
  attention: {
    id: string; code: string; name: string; city: string; plan_id: string; plan_name: string; state: LicenseState;
    expires_at: string | null; days_left: number | null; last_check_in_at: string | null;
    suspended_reason: string | null; offline: boolean;
  }[];
  recent: EventRow[];
};

export type ClientFilter = {
  status?: "all" | "active" | "expiring" | "suspended" | "offline";
  plan?: string;
  city?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ClientRow = {
  id: string; code: string; name: string; city: string; owner_name: string; phone: string; email: string;
  license_key: string; plan_id: string; plan_name: string; expires_at: string | null;
  last_check_in_at: string | null; max_devices: number; status: "active" | "suspended"; state: LicenseState;
  offline: boolean; today_sales_paise: number; today_bills: number; devices_used: number;
};

export type ClientList = {
  total: number;
  counts: { all: number; active: number; expiring: number; suspended: number; offline: number };
  rows: ClientRow[];
  cities: { city: string; n: number }[];
};

export type DailyRow = {
  date: string; sales_paise: number; bills: number; cancelled: number; cash_paise: number; upi_paise: number;
  card_paise: number; tax_paise: number; top_item_name: string | null; top_item_qty: number | null; synced_at: string;
};

export type Device = {
  id: string; machine_id: string; device_name: string; app_version: string | null;
  first_seen_at: string; last_seen_at: string; active: boolean;
};

export type Payment = {
  id: string; plan_id: string; periods: number; subtotal_paise: number; gst_paise: number; total_paise: number;
  method: string; reference: string; period_from: string; period_to: string | null; created_at: string;
};

export type ClientDetail = {
  restaurant: {
    id: string; code: string; name: string; owner_name: string; phone: string; email: string; city: string;
    address: string; gstin: string | null; notes: string; created_at: string;
  };
  license: {
    license_key: string; plan_id: string; plan_name: string; plan_price_paise: number; status: "active" | "suspended";
    state: LicenseState; starts_at: string; expires_at: string | null; max_devices: number;
    suspended_reason: string | null; suspended_at: string | null; last_check_in_at: string | null;
    app_version: string | null; offline: boolean;
  };
  devices: Device[];
  summaries: DailyRow[];
  totals: { sales_paise: number; bills: number; cancelled: number; cash_paise: number; upi_paise: number; card_paise: number; tax_paise: number };
  events: EventRow[];
  payments: Payment[];
};

export type LicenseTab = "expiring" | "expired" | "suspended" | "all";

export type LicenseList = {
  strip: { due_this_month: number; pipeline_paise: number; in_grace: number; suspended: number };
  counts: { expiring: number; expired: number; suspended: number; all: number };
  rows: {
    restaurant_id: string; code: string; name: string; city: string; owner_name: string; phone: string;
    license_key: string; plan_id: string; plan_name: string; price_paise: number; kind: Plan["kind"];
    expires_at: string | null; max_devices: number; suspended_reason: string | null; state: LicenseState;
    days_left: number | null; devices_used: number;
  }[];
};

export type Insights = {
  from: string; to: string; days: number;
  totals: { sales_paise: number; bills: number; cash_paise: number; upi_paise: number; card_paise: number };
  prev: { sales_paise: number; bills: number };
  series: { date: string; sales_paise: number; bills: number }[];
  prev_series: { date: string; sales_paise: number }[];
  clients: {
    id: string; name: string; city: string; devices: number; sales_paise: number; prev_sales_paise: number; bills: number;
    avg_ticket_paise: number; growth_pct: number | null; is_new: boolean; top_item: string | null;
  }[];
  cities: { city: string; sales_paise: number }[];
};

export type ActivityFilter = { event?: string; actor?: string; from?: string; to?: string; search?: string; limit?: number; offset?: number };
export type Activity = {
  total: number;
  counts: Partial<Record<EventType, number>>;
  rows: EventRow[];
  actors: { user_id: string; name: string; role: Role }[];
};

export type TeamMember = { user_id: string; name: string; role: Role; email: string | null; created_at: string };

export type NewClient = {
  name: string; owner_name: string; phone: string; email: string; city: string; address?: string; gstin?: string;
  notes?: string; plan_id: string; starts_on?: string; max_devices?: number;
  payment?: { received: boolean; method?: string; reference?: string; amount_paise?: number };
};
export type CreatedClient = {
  restaurant_id: string; code: string; license_key: string; plan: string; starts_at: string; expires_at: string | null; max_devices: number;
};

export type RenewInput = {
  restaurant: string; plan: string; periods: number; method: string; reference?: string; amount_paise?: number | null; reactivate?: boolean;
};

export const PAYMENT_METHODS = [
  { id: "upi", label: "UPI" },
  { id: "bank", label: "Bank transfer" },
  { id: "cash", label: "Cash" },
  { id: "cheque", label: "Cheque" },
  { id: "card", label: "Card" },
  { id: "other", label: "Other" },
  { id: "waived", label: "Waived (no charge)" },
] as const;
