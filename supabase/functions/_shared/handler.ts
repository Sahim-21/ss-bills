// Request logic for the restaurant-facing Edge Functions. No Deno or Supabase imports here, so the
// same code runs in the Edge Function and in the tests (portal/sql/functions.test.ts).
//
// Both functions are thin: validate the request, rate-limit it, call the database function
// (license_activate / license_checkin, which hold all the rules), and sign the answer so the app can
// tell it really came from SS Bills (docs/TRD.md §7.3).

export type RpcResult = { data: unknown; error: { message: string } | null };
export interface Deps {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** Ed25519 signature (base64) of the exact payload string. */
  sign(payload: string): Promise<string>;
}
export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const STATUS_BY_CODE: Record<string, number> = {
  invalid_key: 404,
  suspended: 403,
  expired: 403,
  device_limit: 409,
  device_not_bound: 403,
  bad_request: 400,
};

const fail = (status: number, code: string, message: string): Reply => ({ status, body: { ok: false, code, message } });

/** Largest request body accepted (bytes of text). Real requests are a few hundred bytes plus up to 400 daily summaries. */
export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Turns the raw request text into a JSON value, or an error reply. Kept here (not in the Deno wrapper) so it is tested.
 * A body that is not JSON gets its own message: the usual cause is a shell removing the quotes from the JSON before
 * it is sent (Windows PowerShell does this to `curl.exe -d '{"a":1}'`).
 */
export function parseJsonBody(raw: string): { ok: true; body: unknown } | { ok: false; reply: Reply } {
  if (raw.length > MAX_BODY_BYTES) return { ok: false, reply: fail(413, "bad_request", "Request too large") };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, reply: fail(400, "bad_request", "The request body is not valid JSON") };
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Text field: must be a string no longer than `max` (and not empty unless `optional`). */
function text(v: unknown, max: number, optional = false): string | null {
  if (v === undefined || v === null) return optional ? "" : null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length > max || (!optional && t.length === 0)) return null;
  return t;
}

async function limited(deps: Deps, key: string, max: number, windowSeconds: number): Promise<boolean | "error"> {
  const r = await deps.rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
  if (r.error) return "error";
  return r.data === true; // true = still within the limit
}

const tooMany = () => fail(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again");
const serverError = () => fail(500, "server_error", "Something went wrong on our side. Please try again later");

/** The signed statement the app stores. It names the key and PC so it cannot be replayed to another PC. */
async function signed(result: Record<string, unknown>, key: string, machine: string, deps: Deps, extra: Record<string, unknown>): Promise<Reply> {
  const status = {
    v: 1,
    key,
    machine,
    plan: result.plan,
    plan_id: result.plan_id,
    restaurant_name: result.restaurant_name,
    restaurant_code: result.restaurant_code,
    state: result.state,
    expires_at: result.expires_at ?? null,
    max_devices: result.max_devices,
    devices_used: result.devices_used,
    grace_days: result.grace_days,
    suspended_reason: result.suspended_reason ?? null,
    server_time: result.server_time,
  };
  const payload = JSON.stringify(status);
  return { status: 200, body: { ok: true, ...extra, payload, sig: await deps.sign(payload) } };
}

export async function handleActivate(body: unknown, ip: string, deps: Deps): Promise<Reply> {
  if (!isObject(body)) return fail(400, "bad_request", "Invalid request");
  const key = text(body.key, 40)?.toUpperCase() ?? null;
  const machine = text(body.machineId, 200);
  const deviceName = text(body.deviceName, 100, true);
  const appVersion = text(body.appVersion, 40, true);
  if (!key || !machine || deviceName === null || appVersion === null) return fail(400, "bad_request", "Invalid request");

  const ok = await limited(deps, `activate:ip:${ip}`, 20, 600);
  if (ok === "error") return serverError();
  if (!ok) return tooMany();

  const r = await deps.rpc("license_activate", { p_key: key, p_machine: machine, p_device_name: deviceName, p_app_version: appVersion });
  if (r.error || !isObject(r.data)) return serverError();
  if (r.data.ok !== true) {
    return fail(STATUS_BY_CODE[String(r.data.code)] ?? 400, String(r.data.code ?? "bad_request"), String(r.data.message ?? "Activation failed"));
  }
  return signed(r.data, key, machine, deps, {});
}

export async function handleSync(body: unknown, ip: string, deps: Deps): Promise<Reply> {
  if (!isObject(body)) return fail(400, "bad_request", "Invalid request");
  const key = text(body.key, 40)?.toUpperCase() ?? null;
  const machine = text(body.machineId, 200);
  const appVersion = text(body.appVersion, 40, true);
  const summaries = body.summaries === undefined ? [] : body.summaries;
  if (!key || !machine || appVersion === null || !Array.isArray(summaries)) return fail(400, "bad_request", "Invalid request");
  if (summaries.length > 400) return fail(400, "bad_request", "Too many summaries in one upload");

  const byIp = await limited(deps, `sync:ip:${ip}`, 300, 3600);
  if (byIp === "error") return serverError();
  if (!byIp) return tooMany();
  const byKey = await limited(deps, `sync:key:${key}:${machine}`, 60, 3600);
  if (byKey === "error") return serverError();
  if (!byKey) return tooMany();

  const r = await deps.rpc("license_checkin", { p_key: key, p_machine: machine, p_app_version: appVersion, p_summaries: summaries });
  if (r.error || !isObject(r.data)) return serverError();
  if (r.data.ok !== true) {
    return fail(STATUS_BY_CODE[String(r.data.code)] ?? 400, String(r.data.code ?? "bad_request"), String(r.data.message ?? "Sync failed"));
  }
  return signed(r.data, key, machine, deps, { accepted: r.data.accepted });
}
