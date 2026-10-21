import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDemoApi, initDemoDb, resetDemoDb, DEMO_CODE, DEMO_EMAIL, type SessionStore } from "../src/lib/demo/demo-api";

/* The browser demo's adapter, exercised in Node with an in-memory database. */
let db: PGlite;
let uid: string | null = null;
const session: SessionStore = { get: () => uid, set: (v) => void (uid = v) };
let demo: ReturnType<typeof buildDemoApi>;

beforeAll(async () => {
  db = new PGlite();
  await initDemoDb(db);
  demo = buildDemoApi(db, session);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("demo sign-in", () => {
  it("is refused until the user has signed in", async () => {
    uid = null;
    await expect(demo.api.overview(30)).rejects.toThrow(/permission denied/i);
    expect(await demo.api.auth.me()).toBeNull();
  });

  it("asks for the password, then the authenticator code", async () => {
    await expect(demo.api.auth.signIn("nobody@x.in", "pw")).rejects.toThrow(/Wrong email or password/);
    await expect(demo.api.auth.signIn(DEMO_EMAIL, "")).rejects.toThrow(/Wrong email or password/);
    expect(await demo.api.auth.signIn(DEMO_EMAIL, "anything")).toEqual({ next: "mfa" });
    await expect(demo.api.auth.verifyMfa("000000")).rejects.toThrow(/not right/);
    expect(await demo.api.auth.me()).toBeNull(); // password alone is not enough
    await demo.api.auth.verifyMfa(` ${DEMO_CODE.slice(0, 3)} ${DEMO_CODE.slice(3)} `);
    expect(await demo.api.auth.me()).toMatchObject({ name: "Rajesh Verma", role: "super_admin" });
  });

  it("signs out", async () => {
    await demo.api.auth.signOut();
    expect(await demo.api.auth.me()).toBeNull();
    await expect(demo.api.clients()).rejects.toThrow(/permission denied/i);
  });
});

describe("demo API (same calls the portal screens make)", () => {
  beforeAll(async () => {
    await demo.api.auth.signIn(DEMO_EMAIL, "x");
    await demo.api.auth.verifyMfa(DEMO_CODE);
  });

  it("reads every screen's data", async () => {
    const o = await demo.api.overview(30);
    expect(o.counts.total).toBe(14);
    const c = await demo.api.clients({ status: "suspended" });
    expect(c.rows.map((r) => r.name)).toEqual(["Hotel Annapurna"]);
    const detail = await demo.api.client(c.rows[0].id);
    expect(detail.license.state).toBe("suspended");
    expect((await demo.api.licenses({ tab: "all" })).rows).toHaveLength(14);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect((await demo.api.insights(today, today)).days).toBe(1);
    expect((await demo.api.activity({ limit: 5 })).rows).toHaveLength(5);
    expect((await demo.api.plans()).map((p) => p.id)).toEqual(["monthly", "yearly", "lifetime"]);
    expect((await demo.api.team()).length).toBe(2);
  });

  it("passes objects, nulls and booleans through correctly, and surfaces database messages", async () => {
    const created = await demo.api.createClient({
      name: "Test Kitchen", owner_name: "T Owner", phone: "+91 90000 11111", email: "t@kitchen.in", city: "Chennai", plan_id: "monthly",
      payment: { received: true, method: "cash" },
    });
    expect(created.code).toMatch(/^CL-CHE-\d{4}$/);
    const r = await demo.api.renew({ restaurant: created.restaurant_id, plan: "monthly", periods: 2, method: "upi" });
    expect(r.total_paise).toBe(589764); // 2 x 2,499 + 18% GST
    await demo.api.suspend(created.restaurant_id, "Test");
    await expect(demo.api.renew({ restaurant: created.restaurant_id, plan: "monthly", periods: 1, method: "upi" })).rejects.toThrow(/suspended/);
    await demo.api.renew({ restaurant: created.restaurant_id, plan: "monthly", periods: 1, method: "upi", reactivate: true, amount_paise: null });
    await expect(demo.api.createClient({ name: "", owner_name: "x", phone: "x", email: "x@y.z", city: "x", plan_id: "monthly" })).rejects.toThrow(/Restaurant name is required/);
  });

  it("resets to fresh demo data", async () => {
    await demo.reset();
    uid = null;
    await demo.api.auth.signIn(DEMO_EMAIL, "x");
    await demo.api.auth.verifyMfa(DEMO_CODE);
    expect((await demo.api.overview(30)).counts.total).toBe(14); // the test client is gone
  }, 60_000);
});

describe("direct reset helper", () => {
  it("can be run twice in a row", async () => {
    await resetDemoDb(db);
    await resetDemoDb(db);
  }, 90_000);
});
