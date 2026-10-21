import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BOSS_ID, SEED } from "../src/lib/demo/seed";
import { freshDb, rpc, type Who } from "./harness";

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: PGlite;
const boss: Who = { role: "authenticated", uid: DEMO_BOSS_ID };

beforeAll(async () => {
  db = await freshDb();
  await db.exec(SEED);
}, 120_000);
afterAll(async () => {
  await db.close();
});

describe("the browser demo's seed data", () => {
  it("builds a believable fleet in every state", async () => {
    const list = await rpc<any>(db, boss, "public.vendor_list_clients('{\"limit\":100}'::jsonb)");
    expect(list.total).toBe(14);
    expect(list.counts.suspended).toBe(1);
    expect(list.counts.expiring).toBeGreaterThanOrEqual(3); // renewals due, in grace, expired
    expect(list.counts.active).toBeGreaterThanOrEqual(6);
    expect(list.counts.offline).toBeGreaterThanOrEqual(1);
    const annapurna = list.rows.find((r: any) => r.name === "Hotel Annapurna");
    expect(annapurna.state).toBe("suspended");
    expect(list.rows.every((r: any) => r.devices_used === r.max_devices)).toBe(true);
    expect(list.rows.find((r: any) => r.plan_id === "lifetime").expires_at).toBeNull();
  });

  it("has sales history, so charts and growth have something to show", async () => {
    const o = await rpc<any>(db, boss, "public.vendor_overview(30)");
    expect(o.gmv.total_paise).toBeGreaterThan(10_000_000_00); // over ₹1 crore
    expect(o.gmv.prev_total_paise).toBeGreaterThan(0);
    expect(o.top_clients).toHaveLength(5);
    expect(o.attention.length).toBeGreaterThan(3);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const ins = await rpc<any>(db, boss, "public.vendor_sales_insights($1::date, $2::date)", [new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10), today]);
    expect(ins.clients.length).toBeGreaterThan(10);
    expect(ins.clients.some((c: any) => c.is_new)).toBe(true); // the freshly onboarded restaurant
    expect(ins.clients.every((c: any) => c.top_item)).toBe(true);
    const m = ins.totals;
    expect(m.cash_paise + m.upi_paise + m.card_paise).toBe(m.sales_paise); // payment split adds up exactly
  });

  it("has a varied activity log with people and restaurants named", async () => {
    const a = await rpc<any>(db, boss, "public.vendor_activity('{\"limit\":100}'::jsonb)");
    expect(Object.keys(a.counts)).toEqual(expect.arrayContaining(["created", "activated", "device_bound", "renewed", "suspended"]));
    expect(a.rows.every((r: any) => r.actor_name)).toBe(true);
    expect(a.rows.find((r: any) => r.event === "suspended")).toMatchObject({ actor_name: "Rajesh Verma", restaurant_name: "Hotel Annapurna" });
  });

  it("gives every client a payment and the lifecycle a sensible order", async () => {
    const [{ n }] = (await db.query<{ n: number }>("select count(*)::int n from public.payments")).rows;
    expect(n).toBeGreaterThanOrEqual(14);
    const { rows: [sg] } = await db.query<{ id: string }>("select id from public.restaurants where name = 'Spice Garden'");
    const d = await rpc<any>(db, boss, "public.vendor_client($1)", [sg.id]);
    expect(d.payments.length).toBe(2); // first year + the renewal
    expect(d.devices).toHaveLength(3);
    expect(d.summaries.length).toBeGreaterThan(20);
    expect(d.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(["created", "renewed", "activated"]));
  });
});
