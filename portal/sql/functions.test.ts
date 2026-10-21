// The Edge Function logic (supabase/functions/_shared) run against the real migrations in PGlite:
// validation, rate limits, signed answers, and that errors from the database never leak to the app.
import type { PGlite } from "@electric-sql/pglite";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, handleActivate, handleSync, parseJsonBody, type Deps, type Reply } from "../../supabase/functions/_shared/handler";
import { makeSigner } from "../../supabase/functions/_shared/sign";
import { addUser, freshDb, rpc, type Who } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: PGlite;
let deps: Deps;
let publicKey: crypto.KeyObject;
let key: string;
const boss: { who?: Who } = {};
const service: Who = { role: "service_role" };

const verifySig = (payload: string, sig: string) => crypto.verify(null, Buffer.from(payload), publicKey, Buffer.from(sig, "base64"));

beforeAll(async () => {
  db = await freshDb();
  const pair = crypto.generateKeyPairSync("ed25519");
  publicKey = pair.publicKey;
  const sign = await makeSigner(pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"));
  deps = {
    sign,
    rpc: async (name, args) => {
      // same call shape as supabase-js: named arguments, run as the service role
      const names = Object.keys(args);
      const sql = `public.${name}(${names.map((n, i) => `${n} => $${i + 1}${typeof args[n] === "object" ? "::jsonb" : ""}`).join(", ")})`;
      try {
        const data = await rpc<unknown>(db, service, sql, names.map((n) => (typeof args[n] === "object" ? JSON.stringify(args[n]) : args[n])));
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
  const id = await addUser(db, "boss@ssbills.in", "super_admin", "Boss");
  boss.who = { role: "authenticated", uid: id };
  const c = await rpc<any>(db, boss.who, "public.vendor_create_client($1::jsonb)", [
    JSON.stringify({ name: "Spice Garden", owner_name: "Manish", phone: "98105 77123", email: "o@sg.in", city: "Hyderabad", plan_id: "yearly" }),
  ]);
  key = c.license_key;
}, 60_000); // PGlite starts slowly when several test files boot it at once
afterAll(() => db.close());

const act = (over: Record<string, unknown> = {}, ip = "1.1.1.1") =>
  handleActivate({ key, machineId: "PC-A", deviceName: "Counter", appVersion: "0.1.0", ...over }, ip, deps);
const sync = (over: Record<string, unknown> = {}, ip = "2.2.2.2") =>
  handleSync({ key, machineId: "PC-A", appVersion: "0.1.0", summaries: [], ...over }, ip, deps);

describe("activate", () => {
  it("binds the PC and returns a signed status that names the key and PC", async () => {
    const r = await act();
    expect(r.status).toBe(200);
    const payload = r.body.payload as string;
    expect(verifySig(payload, r.body.sig as string)).toBe(true);
    const s = JSON.parse(payload);
    expect(s).toMatchObject({ v: 1, key, machine: "PC-A", state: "active", restaurant_name: "Spice Garden", plan_id: "yearly" });
  });

  it("a tampered payload fails verification", async () => {
    const r = await act();
    const forged = (r.body.payload as string).replace('"active"', '"expired"');
    expect(verifySig(forged, r.body.sig as string)).toBe(false);
  });

  it("accepts a key typed in lower case with spaces around it", async () => {
    expect((await act({ key: `  ${key.toLowerCase()} ` }, "1.1.1.2")).status).toBe(200);
  });

  it("an unknown key is a clean 404, not a server error", async () => {
    const r = await act({ key: "0000-0000-0000-0000" }, "1.1.1.3");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, code: "invalid_key" });
  });

  it("rejects malformed requests before touching the database", async () => {
    for (const bad of [null, [], "x", {}, { key }, { key, machineId: "" }, { key: 5, machineId: "m" }, { key, machineId: "m".repeat(201) }, { key, machineId: "m", deviceName: {} }, { key: "K".repeat(41), machineId: "m" }]) {
      const r = await handleActivate(bad, "9.9.9.9", deps);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("bad_request");
    }
  });

  it("returns the terminal-limit and suspension refusals with the right status", async () => {
    const c = await rpc<any>(db, boss.who!, "public.vendor_create_client($1::jsonb)", [
      JSON.stringify({ name: "One Seat", owner_name: "A", phone: "1", email: "a@b.in", city: "Pune", plan_id: "monthly" }),
    ]);
    expect((await act({ key: c.license_key, machineId: "M1" }, "3.3.3.1")).status).toBe(200);
    const full = await act({ key: c.license_key, machineId: "M2" }, "3.3.3.1");
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("device_limit");
    await rpc(db, boss.who!, "public.vendor_suspend($1, 'unpaid')", [c.restaurant_id]);
    const sus = await act({ key: c.license_key, machineId: "M1" }, "3.3.3.1");
    expect(sus.status).toBe(403);
    expect(sus.body.code).toBe("suspended");
  });

  it("never leaks a database error message", async () => {
    const broken: Deps = { ...deps, rpc: async (name, args) => (name === "rate_limit_hit" ? deps.rpc(name, args) : { data: null, error: { message: 'relation "secret_table" does not exist' } }) };
    const r = await handleActivate({ key, machineId: "PC-A" }, "4.4.4.4", broken);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("secret_table");
  });

  it("rate-limits one address after 20 tries in a window", async () => {
    let last = 0;
    for (let i = 0; i < 22; i++) last = (await act({ key: "1111-1111-1111-1111" }, "5.5.5.5")).status;
    expect(last).toBe(429);
    expect((await act({}, "5.5.5.6")).status).toBe(200); // another address is unaffected
  });
});

describe("sync", () => {
  const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

  it("stores summaries and returns a fresh signed status", async () => {
    await act({}, "6.6.6.6");
    const r = await sync({ summaries: [{ date: today(), salesPaise: 123400, bills: 7, cancelled: 0, cashPaise: 100000, upiPaise: 23400, cardPaise: 0, taxPaise: 5876, topItemName: "Naan", topItemQty: 9 }] });
    expect(r.status).toBe(200);
    expect(r.body.accepted).toBe(1);
    expect(verifySig(r.body.payload as string, r.body.sig as string)).toBe(true);
    const rows = (await db.query<any>("select sales_paise from public.daily_summary")).rows;
    expect(Number(rows[0].sales_paise)).toBe(123400);
  });

  it("a PC that was never activated is refused", async () => {
    const r = await sync({ machineId: "UNKNOWN-PC" });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("device_not_bound");
  });

  it("a suspended license still answers ok with the state, signed, so the app can lock", async () => {
    const c = await rpc<any>(db, boss.who!, "public.vendor_create_client($1::jsonb)", [
      JSON.stringify({ name: "Late Payer", owner_name: "B", phone: "2", email: "b@c.in", city: "Delhi", plan_id: "yearly" }),
    ]);
    await act({ key: c.license_key, machineId: "LP-1" }, "7.7.7.7");
    await rpc(db, boss.who!, "public.vendor_suspend($1, 'unpaid')", [c.restaurant_id]);
    const r = await sync({ key: c.license_key, machineId: "LP-1" }, "7.7.7.8");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body.payload as string)).toMatchObject({ state: "suspended", suspended_reason: "unpaid" });
  });

  it("rejects bad summaries as a whole and a bad shape up front", async () => {
    const r = await sync({ summaries: [{ date: today(), salesPaise: 1.5 }] }, "8.8.8.8");
    expect(r.status).toBe(400);
    expect((await sync({ summaries: "nope" }, "8.8.8.9")).status).toBe(400);
    expect((await sync({ summaries: new Array(401).fill({}) }, "8.8.8.9")).status).toBe(400);
  });

  it("rate-limits one PC after 60 check-ins an hour", async () => {
    let last = 0;
    for (let i = 0; i < 62; i++) last = (await sync({ machineId: "PC-A" }, `10.0.${i}.1`)).status;
    expect(last).toBe(429);
  });
});

describe("rate_limit_hit", () => {
  it("is only callable by the service role", async () => {
    await expect(rpc(db, { role: "anon" }, "public.rate_limit_hit('k', 5, 60)")).rejects.toThrow(/permission denied/i);
    await expect(rpc(db, { role: "authenticated" }, "public.rate_limit_hit('k', 5, 60)")).rejects.toThrow(/permission denied/i);
  });

  it("the table cannot be read by anon or authenticated", async () => {
    await expect(rpc(db, { role: "anon" }, "(select count(*) from public.rate_limits)")).rejects.toThrow(/permission denied/i);
  });

  it("starts a new window once the old one has expired", async () => {
    expect(await rpc(db, service, "public.rate_limit_hit('w', 1, 60)")).toBe(true);
    expect(await rpc(db, service, "public.rate_limit_hit('w', 1, 60)")).toBe(false);
    await db.query("update public.rate_limits set window_start = now() - interval '2 minutes' where key = 'w'");
    expect(await rpc(db, service, "public.rate_limit_hit('w', 1, 60)")).toBe(true);
  });
});

/** What the Edge Function does with the raw request text: parse it, then hand it to the handler. */
async function viaWire(handler: typeof handleActivate, raw: string, ip: string): Promise<Reply> {
  const parsed = parseJsonBody(raw);
  return parsed.ok ? handler(parsed.body, ip, deps) : parsed.reply;
}

describe("request parsing (from the raw request text)", () => {
  const act = (raw: string, ip = "20.0.0.1") => viaWire(handleActivate, raw, ip);
  const syn = (raw: string, ip = "21.0.0.1") => viaWire(handleSync, raw, ip);

  it("valid JSON with an unknown key reaches the lookup and says invalid_key (not bad_request)", async () => {
    const r = await act('{"key":"0000-0000-0000-0000","machineId":"test"}');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, code: "invalid_key" });
    const s = await syn('{"key":"0000-0000-0000-0000","machineId":"test"}');
    expect(s.status).toBe(404);
    expect(s.body).toMatchObject({ ok: false, code: "invalid_key" });
  });

  it("malformed JSON gets a clear 400 that says the body is not JSON", async () => {
    // the shape Windows PowerShell 5.1 delivers for: curl.exe -d '{"key":"0000-0000-0000-0000","machineId":"test"}'
    const mangled = "{key:0000-0000-0000-0000,machineId:test}";
    for (const raw of [mangled, "", "not json", "{", '{"key": "x",}', "{'key':'x'}", "undefined"]) {
      const a = await act(raw);
      expect(a.status).toBe(400);
      expect(a.body).toEqual({ ok: false, code: "bad_request", message: "The request body is not valid JSON" });
      expect((await syn(raw)).body).toMatchObject({ code: "bad_request", message: "The request body is not valid JSON" });
    }
  });

  it("valid JSON that is not an object is rejected as an invalid request", async () => {
    for (const raw of ["null", "[]", "5", '"text"', "true", '[{"key":"x"}]']) {
      expect(await act(raw)).toMatchObject({ status: 400, body: { code: "bad_request", message: "Invalid request" } });
      expect(await syn(raw)).toMatchObject({ status: 400, body: { code: "bad_request", message: "Invalid request" } });
    }
  });

  it("missing required fields are a 400, for both functions", async () => {
    for (const raw of ["{}", '{"key":"AAAA-AAAA-AAAA-AAAA"}', '{"machineId":"x"}', '{"key":"","machineId":"x"}', '{"key":"A","machineId":"  "}']) {
      expect((await act(raw)).status).toBe(400);
      expect((await syn(raw)).status).toBe(400);
    }
  });

  it("deviceName and appVersion are optional; when given they must be short text", async () => {
    const withKey = (extra: string) => `{"key":"${key}","machineId":"OPT-PC"${extra}}`;
    expect((await act(withKey(""), "22.0.0.1")).status).toBe(200); // neither field
    expect((await act(withKey(',"deviceName":"Counter 2"'), "22.0.0.2")).status).toBe(200);
    expect((await act(withKey(',"appVersion":"0.1.0"'), "22.0.0.3")).status).toBe(200);
    expect((await act(withKey(',"deviceName":"Counter","appVersion":"0.1.0"'), "22.0.0.4")).status).toBe(200);
    expect((await act(withKey(',"deviceName":null,"appVersion":null'), "22.0.0.5")).status).toBe(200);
    expect((await act(withKey(',"deviceName":5'), "22.0.0.6")).status).toBe(400);
    expect((await act(withKey(`,"appVersion":"${"v".repeat(41)}"`), "22.0.0.7")).status).toBe(400);
    expect((await act(withKey(`,"deviceName":"${"d".repeat(101)}"`), "22.0.0.8")).status).toBe(400);
  });

  it("sync: summaries are optional, must be an array, and a good request returns a signed answer", async () => {
    await act(`{"key":"${key}","machineId":"SYNC-PC","deviceName":"S"}`, "23.0.0.1");
    const ok = await syn(`{"key":"${key}","machineId":"SYNC-PC"}`, "23.0.0.2"); // no summaries, no appVersion
    expect(ok.status).toBe(200);
    expect(verifySig(ok.body.payload as string, ok.body.sig as string)).toBe(true);
    expect(JSON.parse(ok.body.payload as string)).toMatchObject({ key, machine: "SYNC-PC", state: "active" });
    expect((await syn(`{"key":"${key}","machineId":"SYNC-PC","summaries":{}}`, "23.0.0.3")).status).toBe(400);
    expect((await syn(`{"key":"${key}","machineId":"SYNC-PC","summaries":"x"}`, "23.0.0.4")).status).toBe(400);
    expect((await syn(`{"key":"${key}","machineId":"SYNC-PC","appVersion":7}`, "23.0.0.5")).status).toBe(400);
  });

  it("a request body over the size limit is refused before parsing", async () => {
    const big = `{"key":"${key}","machineId":"x","pad":"${"x".repeat(MAX_BODY_BYTES)}"}`;
    expect(await act(big)).toMatchObject({ status: 413, body: { code: "bad_request" } });
    expect(await syn(big)).toMatchObject({ status: 413 });
  });

  it("every refusal is a JSON object with ok:false and a string code and message", async () => {
    const replies = await Promise.all(["", "{}", "[]", '{"key":"0000-0000-0000-0000","machineId":"m"}'].map((raw) => act(raw, "24.0.0.1")));
    for (const r of replies) {
      expect(r.body.ok).toBe(false);
      expect(typeof r.body.code).toBe("string");
      expect(typeof r.body.message).toBe("string");
    }
  });
});
