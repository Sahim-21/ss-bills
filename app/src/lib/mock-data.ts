// Sample data for the UI-only build. Replaced by SQLite (TRD §3) in a later phase.
import { calcBill, financialYear, formatBillNo, type TaxSettings } from "./billing";
import type {
  BillLine,
  Category,
  DailySummary,
  DiningTable,
  MenuItem,
  OpenBill,
  PaidBill,
  PaymentMethod,
  RestaurantProfile,
  Staff,
} from "./types";

export const DEFAULT_TAX: TaxSettings = {
  gstRateBp: 500,
  pricesIncludeTax: false,
  serviceChargeEnabled: false,
  serviceChargeBp: 500,
};

export const DEFAULT_PROFILE: RestaurantProfile = {
  name: "Spice Garden",
  tagline: "Authentic Indian Cuisine & Tandoor",
  address: "12th Main, Indiranagar, Bengaluru - 560038",
  phone: "+91 80 4123 9876",
  gstin: "29AAAAA0000A1Z5",
  fssai: "11221334000543",
  hsnSac: "996331",
  receiptHeader: "SPICE GARDEN\nAuthentic Indian Cuisine & Tandoor\n12th Main, Indiranagar, Bengaluru - 560038\nTel: +91 80 4123 9876",
  receiptFooter: "Thank you for dining with us!\nVisit again",
  showLogo: true,
  paperWidthMm: 80,
};

export const STAFF: Staff[] = [
  { id: "s1", name: "Ananya Sharma", role: "admin", pin: "1234", phone: "+91 98450 12345", active: true },
  { id: "s2", name: "Ramesh Kumar", role: "cashier", pin: "1111", phone: "+91 99001 88231", active: true },
  { id: "s3", name: "Vikram Patel", role: "cashier", pin: "2222", phone: "+91 97412 44320", active: true },
  { id: "s4", name: "Pooja Hegde", role: "cashier", pin: "3333", phone: "+91 96110 55198", active: false },
];

export const CATEGORIES: Category[] = [
  { id: "c1", name: "Starters", sortOrder: 1, active: true },
  { id: "c2", name: "Main Course", sortOrder: 2, active: true },
  { id: "c3", name: "Breads", sortOrder: 3, active: true },
  { id: "c4", name: "Rice & Biryani", sortOrder: 4, active: true },
  { id: "c5", name: "South Indian", sortOrder: 5, active: true },
  { id: "c6", name: "Beverages", sortOrder: 6, active: true },
  { id: "c7", name: "Desserts", sortOrder: 7, active: true },
];

const item = (
  id: string,
  categoryId: string,
  name: string,
  shortCode: string,
  rupees: number,
  veg = true,
  available = true,
): MenuItem => ({ id, categoryId, name, shortCode, pricePaise: rupees * 100, veg, available, deleted: false });

export const MENU_ITEMS: MenuItem[] = [
  item("m1", "c1", "Paneer Tikka", "PTK", 240),
  item("m2", "c1", "Chicken Tikka", "CTK", 290, false),
  item("m3", "c1", "Veg Manchurian", "VMN", 180),
  item("m4", "c1", "Chilli Chicken", "CHC", 260, false),
  item("m5", "c1", "Hara Bhara Kebab", "HBK", 200),
  item("m6", "c2", "Paneer Butter Masala", "PBM", 260),
  item("m7", "c2", "Dal Makhani", "DLM", 210),
  item("m8", "c2", "Butter Chicken", "BTC", 320, false),
  item("m9", "c2", "Mutton Rogan Josh", "MRJ", 390, false),
  item("m10", "c2", "Kadhai Paneer", "KDP", 240),
  item("m11", "c2", "Fish Curry Meals", "FCM", 340, false, false),
  item("m12", "c3", "Butter Naan", "BTN", 50),
  item("m13", "c3", "Garlic Naan", "GLN", 70),
  item("m14", "c3", "Tandoori Roti", "TRT", 35),
  item("m15", "c3", "Lachha Paratha", "LCP", 60),
  item("m16", "c4", "Veg Biryani", "VGB", 220),
  item("m17", "c4", "Chicken Biryani", "CKB", 280, false),
  item("m18", "c4", "Jeera Rice", "JRR", 150),
  item("m19", "c4", "Mutton Biryani", "MTB", 360, false),
  item("m20", "c5", "Masala Dosa", "MDS", 120),
  item("m21", "c5", "Idli Vada", "IDV", 90),
  item("m22", "c5", "Onion Uttapam", "OUT", 130),
  item("m23", "c6", "Filter Coffee", "FLC", 40),
  item("m24", "c6", "Fresh Lime Soda", "FLS", 90),
  item("m25", "c6", "Mango Lassi", "MGL", 110, true, false),
  item("m26", "c6", "Masala Chai", "MCH", 30),
  item("m27", "c7", "Gulab Jamun (2 pcs)", "GBJ", 80),
  item("m28", "c7", "Rasmalai", "RSM", 95),
  item("m29", "c7", "Kulfi", "KLF", 70),
];

export const TABLES: DiningTable[] = Array.from({ length: 16 }, (_, i) => ({
  id: `t${i + 1}`,
  label: `T${i + 1}`,
  seats: [2, 4, 4, 4, 6, 2, 2, 6, 4, 4, 4, 8, 2, 2, 4, 6][i],
  active: true,
}));

function line(itemId: string, qty: number, kotQty = qty): BillLine {
  const m = MENU_ITEMS.find((x) => x.id === itemId)!;
  return { itemId, name: m.name, unitPricePaise: m.pricePaise, veg: m.veg, qty, kotQty };
}

function minutesAgo(now: Date, mins: number): string {
  return new Date(now.getTime() - mins * 60_000).toISOString();
}

export function seedOpenBills(now: Date): OpenBill[] {
  return [
    { id: "ob1", orderType: "dine_in", tableId: "t1", lines: [line("m6", 1), line("m12", 2)], createdAt: minutesAgo(now, 24), createdBy: "s2" },
    { id: "ob2", orderType: "dine_in", tableId: "t5", lines: [line("m8", 2), line("m13", 4), line("m17", 2), line("m24", 3)], createdAt: minutesAgo(now, 65), createdBy: "s2" },
    { id: "ob3", orderType: "dine_in", tableId: "t9", lines: [line("m2", 1), line("m7", 1), line("m14", 4, 0)], createdAt: minutesAgo(now, 15), createdBy: "s3" },
    { id: "ob4", orderType: "dine_in", tableId: "t12", lines: [line("m9", 2), line("m19", 2), line("m15", 6), line("m27", 4)], createdAt: minutesAgo(now, 70), createdBy: "s2" },
    { id: "ob5", orderType: "takeaway", tableId: null, lines: [line("m6", 2), line("m12", 4)], createdAt: minutesAgo(now, 14), createdBy: "s2" },
    { id: "ob6", orderType: "delivery", tableId: null, lines: [line("m7", 2), line("m18", 2), line("m14", 6)], createdAt: minutesAgo(now, 22), createdBy: "s3" },
  ];
}

/** Small deterministic PRNG so mock history is stable across reloads. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const PAY_WEIGHTS: [PaymentMethod, number][] = [
  ["upi", 0.56],
  ["cash", 0.3],
  ["card", 0.14],
];

function pickPayment(r: number): PaymentMethod {
  let acc = 0;
  for (const [m, w] of PAY_WEIGHTS) {
    acc += w;
    if (r < acc) return m;
  }
  return "cash";
}

/** Today's paid bills, spread from opening (11:00, or midnight if earlier) up to now. */
export function seedPaidBills(now: Date, tax: TaxSettings): { bills: PaidBill[]; nextSeq: number } {
  const rand = rng(20261021);
  const fy = financialYear(now);
  const open = new Date(now);
  open.setHours(now.getHours() >= 12 ? 11 : 0, 0, 0, 0);
  const spanMin = Math.max(1, Math.floor((now.getTime() - open.getTime()) / 60_000));
  // About 4 bills an hour, so the dashboard looks like "today so far" at any time of day.
  const count = Math.max(6, Math.min(48, Math.round(spanMin / 15)));
  const available = MENU_ITEMS.filter((m) => m.available);
  const bills: PaidBill[] = [];
  let seq = 108;

  const times = Array.from({ length: count }, () => Math.floor(rand() * spanMin)).sort((a, b) => a - b);
  for (let i = 0; i < count; i++) {
    const n = 1 + Math.floor(rand() * 4);
    const lines: BillLine[] = [];
    for (let k = 0; k < n; k++) {
      const m = available[Math.floor(rand() * available.length)];
      if (lines.some((l) => l.itemId === m.id)) continue;
      lines.push(line(m.id, 1 + Math.floor(rand() * 3)));
    }
    const t = calcBill(lines, tax);
    const orderRoll = rand();
    const orderType = orderRoll < 0.62 ? "dine_in" : orderRoll < 0.86 ? "takeaway" : "delivery";
    const paidAt = new Date(open.getTime() + times[i] * 60_000).toISOString();
    seq += 1;
    const cancelled = i === 9 || i === 23;
    bills.push({
      id: `pb${seq}`,
      billNo: formatBillNo(fy, seq),
      orderType,
      tableId: orderType === "dine_in" ? `t${1 + Math.floor(rand() * 16)}` : null,
      lines,
      status: cancelled ? "cancelled" : "paid",
      subtotalPaise: t.subtotal,
      serviceChargePaise: t.serviceCharge,
      cgstPaise: t.cgst,
      sgstPaise: t.sgst,
      roundOffPaise: t.roundOff,
      totalPaise: t.total,
      paymentMethod: pickPayment(rand()),
      createdBy: rand() < 0.7 ? "s2" : "s3",
      paidAt,
      ...(cancelled
        ? {
            cancelledBy: "s1",
            cancelledAt: paidAt,
            cancelReason: i === 9 ? "Wrong items punched" : "Duplicate bill",
          }
        : {}),
    });
  }
  return { bills: bills.reverse(), nextSeq: seq + 1 };
}

/** Daily summaries for the last `days` days (excluding today), newest last. */
export function seedDailySummaries(now: Date, days: number): DailySummary[] {
  const rand = rng(777);
  const out: DailySummary[] = [];
  for (let d = days; d >= 1; d--) {
    const date = new Date(now);
    date.setDate(now.getDate() - d);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const bills = Math.round((weekend ? 170 : 125) + rand() * 45);
    const avg = 62000 + Math.round(rand() * 22000);
    const sales = bills * avg;
    const upi = Math.round(sales * (0.52 + rand() * 0.08));
    const card = Math.round(sales * (0.12 + rand() * 0.04));
    out.push({
      date: toISODate(date),
      salesPaise: sales,
      bills,
      cancelled: Math.floor(rand() * 4),
      upiPaise: upi,
      cardPaise: card,
      cashPaise: sales - upi - card,
      taxPaise: Math.round((sales * 500) / 10500),
    });
  }
  return out;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

