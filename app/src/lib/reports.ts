// Report aggregation over bills and daily summaries. Pure functions.
import { toISODate } from "./mock-data";
import type { DailySummary, MenuItem, PaidBill, PaymentMethod } from "./types";

export function summarizeBills(date: Date, bills: PaidBill[]): DailySummary {
  const paid = bills.filter((b) => b.status === "paid");
  const by = (m: PaymentMethod) => paid.filter((b) => b.paymentMethod === m).reduce((s, b) => s + b.totalPaise, 0);
  return {
    date: toISODate(date),
    salesPaise: paid.reduce((s, b) => s + b.totalPaise, 0),
    bills: paid.length,
    cancelled: bills.length - paid.length,
    cashPaise: by("cash"),
    upiPaise: by("upi"),
    cardPaise: by("card"),
    taxPaise: paid.reduce((s, b) => s + b.cgstPaise + b.sgstPaise, 0),
  };
}

export function totalsOf(days: DailySummary[]) {
  const sum = (k: keyof Omit<DailySummary, "date">) => days.reduce((s, d) => s + d[k], 0);
  const sales = sum("salesPaise");
  const bills = sum("bills");
  return {
    sales,
    bills,
    cancelled: sum("cancelled"),
    cash: sum("cashPaise"),
    upi: sum("upiPaise"),
    card: sum("cardPaise"),
    tax: sum("taxPaise"),
    avg: bills ? Math.round(sales / bills) : 0,
  };
}

export function salesByHour(bills: PaidBill[], fromHour = 11, toHour = 23) {
  const buckets = new Map<number, { value: number; count: number }>();
  for (let h = fromHour; h <= toHour; h++) buckets.set(h, { value: 0, count: 0 });
  for (const b of bills) {
    if (b.status !== "paid") continue;
    const h = new Date(b.paidAt).getHours();
    const bucket = buckets.get(h);
    if (bucket) {
      bucket.value += b.totalPaise;
      bucket.count += 1;
    }
  }
  return [...buckets.entries()].map(([h, v]) => ({
    label: h === 0 ? "12A" : h === 12 ? "12P" : h > 12 ? `${h - 12}P` : `${h}A`,
    value: v.value,
    sub: `${v.count} bills`,
  }));
}

export function bestSellers(bills: PaidBill[], menu: MenuItem[], limit = 5) {
  const agg = new Map<string, { label: string; qty: number; value: number; veg: boolean }>();
  for (const b of bills) {
    if (b.status !== "paid") continue;
    for (const l of b.lines) {
      const cur = agg.get(l.itemId) ?? { label: l.name, qty: 0, value: 0, veg: l.veg };
      cur.qty += l.qty;
      cur.value += l.qty * l.unitPricePaise;
      agg.set(l.itemId, cur);
    }
  }
  const rows = [...agg.values()].sort((a, b) => b.qty - a.qty || b.value - a.value);
  return rows.slice(0, limit).map((r) => ({ ...r, veg: menu.find((m) => m.name === r.label)?.veg ?? r.veg }));
}
