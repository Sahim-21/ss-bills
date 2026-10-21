// The portal's whole data layer. Every action is a call to a database function (see
// supabase/migrations); this file only maps method names to function names and arguments.
// The same mapping is used by both backends: the real Supabase project, and the browser demo
// (which runs the same migrations in PGlite), so the demo behaves like production.
import type {
  Activity, ActivityFilter, ClientDetail, ClientFilter, ClientList, CreatedClient, Insights, LicenseList, LicenseTab,
  Me, NewClient, Overview, Plan, RenewInput, TeamMember,
} from "./types";

export type RpcFn = (name: string, args?: Record<string, unknown>) => Promise<unknown>;

export type AuthStep =
  | { next: "done" }
  | { next: "mfa" }                                              // enter the 6-digit code from the authenticator app
  | { next: "enroll"; qr: string; secret: string; factorId: string }; // first sign-in: link an authenticator app

export interface PortalAuth {
  signIn(email: string, password: string): Promise<AuthStep>;
  verifyMfa(code: string, factorId?: string): Promise<void>;
  signOut(): Promise<void>;
  /** The signed-in vendor admin, or null (not signed in, or signed in but not on the vendor team). */
  me(): Promise<Me | null>;
}

export function createApi(rpc: RpcFn, auth: PortalAuth, mode: "supabase" | "demo") {
  const call = <T>(name: string, args?: Record<string, unknown>) => rpc(name, args) as Promise<T>;
  return {
    mode,
    auth,
    overview: (days = 30) => call<Overview>("vendor_overview", { p_days: days }),
    clients: (f: ClientFilter = {}) => call<ClientList>("vendor_list_clients", { p: f }),
    client: (id: string) => call<ClientDetail>("vendor_client", { p_id: id }),
    licenses: (f: { tab?: LicenseTab; horizon_days?: number; plan?: string; search?: string } = {}) =>
      call<LicenseList>("vendor_list_licenses", { p: f }),
    insights: (from: string, to: string) => call<Insights>("vendor_sales_insights", { p_from: from, p_to: to }),
    activity: (f: ActivityFilter = {}) => call<Activity>("vendor_activity", { p: f }),
    plans: () => call<Plan[]>("vendor_plans"),
    config: () => call<{ gst_bp: number; grace_days: number; expiring_days: number; expiring_days_monthly: number; offline_days: number }>("vendor_config"),
    team: () => call<TeamMember[]>("vendor_team"),

    createClient: (c: NewClient) => call<CreatedClient>("vendor_create_client", { p: c }),
    updateClient: (id: string, patch: Record<string, unknown>) => call<{ ok: true }>("vendor_update_client", { p_id: id, p: patch }),
    renew: (r: RenewInput) =>
      call<{ ok: true; expires_at: string | null; total_paise: number; subtotal_paise: number; gst_paise: number }>("vendor_renew", {
        p_restaurant: r.restaurant, p_plan: r.plan, p_periods: r.periods, p_method: r.method, p_reference: r.reference ?? "",
        p_amount_paise: r.amount_paise ?? null, p_reactivate: r.reactivate ?? false,
      }),
    suspend: (id: string, reason: string) => call<{ ok: true }>("vendor_suspend", { p_restaurant: id, p_reason: reason }),
    regenerateKey: (id: string, reason: string) => call<{ ok: true; license_key: string }>("vendor_regenerate_key", { p_restaurant: id, p_reason: reason }),
    reactivate: (id: string, note = "") => call<{ ok: true }>("vendor_reactivate", { p_restaurant: id, p_note: note }),
    resetDevice: (deviceId: string, reason: string) => call<{ ok: true }>("vendor_reset_device", { p_device: deviceId, p_reason: reason }),
    updatePlan: (p: Partial<Plan> & { id: string }) => call<{ ok: true }>("vendor_update_plan", { p }),
    addAdmin: (email: string, name: string, role: string) => call<{ ok: true }>("vendor_add_admin", { p_email: email, p_name: name, p_role: role }),
    removeAdmin: (userId: string) => call<{ ok: true }>("vendor_remove_admin", { p_user: userId }),
  };
}

export type PortalApi = ReturnType<typeof createApi>;
