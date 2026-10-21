"use client";

// App state. A brand-new desktop database first runs the setup wizard. Otherwise it is loaded from the local SQLite database at startup and every
// change is saved through the Electron IPC bridge (see usePersistence). In a plain browser
// (`npm run dev`) there is no bridge, so it runs on in-memory mock data instead.
// Screens only use `usePos()` and its actions, so they work the same either way.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SetupWizard } from "@/components/setup-wizard";
import type { SsbillsApi } from "./desktop";
import { calcBill, financialYear, formatBillNo, type TaxSettings } from "./billing";
import {
  CATEGORIES,
  DEFAULT_PROFILE,
  DEFAULT_TAX,
  MENU_ITEMS,
  STAFF,
  TABLES,
  seedDailySummaries,
  seedOpenBills,
  seedPaidBills,
  toISODate,
} from "./mock-data";
import type {
  Category,
  DailySummary,
  DiningTable,
  MenuItem,
  OpenBill,
  OrderType,
  PaidBill,
  PaymentMethod,
  PrinterSettings,
  RestaurantProfile,
  Staff,
} from "./types";

type State = {
  userId: string | null;
  staff: Staff[];
  categories: Category[];
  menu: MenuItem[];
  tables: DiningTable[];
  tax: TaxSettings;
  profile: RestaurantProfile;
  /** The bill on the billing screen */
  current: OpenBill;
  /** Held (open) bills, excluding `current` */
  held: OpenBill[];
  paid: PaidBill[];
  nextSeq: number;
  history: DailySummary[];
  printers: PrinterSettings;
  lastPaidId: string | null;
};

type Action =
  | { type: "login"; userId: string }
  | { type: "logout" }
  | { type: "addItem"; item: MenuItem }
  | { type: "setQty"; itemId: string; qty: number }
  | { type: "setOrderType"; orderType: OrderType }
  | { type: "setTable"; tableId: string | null }
  | { type: "hold" }
  | { type: "openBill"; id: string }
  | { type: "openTable"; tableId: string }
  | { type: "newBill"; orderType?: OrderType }
  | { type: "clearCurrent" }
  | { type: "sendKot" }
  | { type: "pay"; method: PaymentMethod; at: string }
  | { type: "billPaid"; bill: PaidBill }
  | { type: "cancelPaid"; id: string; reason: string; at: string }
  | { type: "billCancelled"; bill: PaidBill }
  | { type: "upsertItem"; item: MenuItem }
  | { type: "toggleAvailable"; itemId: string }
  | { type: "deleteItem"; itemId: string }
  | { type: "addCategory"; name: string }
  | { type: "upsertCategory"; category: Category }
  | { type: "upsertTable"; table: DiningTable }
  | { type: "setTax"; tax: TaxSettings }
  | { type: "setProfile"; profile: RestaurantProfile }
  | { type: "setPrinters"; printers: PrinterSettings }
  | { type: "upsertStaff"; staff: Staff };

let idCounter = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

function emptyBill(userId: string | null, orderType: OrderType = "dine_in"): OpenBill {
  return { id: newId("ob"), orderType, tableId: null, lines: [], createdAt: new Date().toISOString(), createdBy: userId ?? "" };
}

/** Put the current bill back on the held list if it has items, so nothing is lost. */
function parkCurrent(s: State): OpenBill[] {
  return s.current.lines.length > 0 ? [s.current, ...s.held] : s.held;
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "login":
      return { ...s, userId: a.userId, current: { ...s.current, createdBy: a.userId } };
    case "logout":
      return { ...s, userId: null };
    case "addItem": {
      if (!a.item.available) return s;
      const existing = s.current.lines.find((l) => l.itemId === a.item.id);
      const lines = existing
        ? s.current.lines.map((l) => (l.itemId === a.item.id ? { ...l, qty: l.qty + 1 } : l))
        : [
            ...s.current.lines,
            { itemId: a.item.id, name: a.item.name, unitPricePaise: a.item.pricePaise, veg: a.item.veg, qty: 1, kotQty: 0 },
          ];
      return { ...s, current: { ...s.current, lines } };
    }
    case "setQty": {
      const lines =
        a.qty <= 0
          ? s.current.lines.filter((l) => l.itemId !== a.itemId)
          : s.current.lines.map((l) => (l.itemId === a.itemId ? { ...l, qty: a.qty, kotQty: Math.min(l.kotQty, a.qty) } : l));
      return { ...s, current: { ...s.current, lines } };
    }
    case "setOrderType":
      return {
        ...s,
        current: { ...s.current, orderType: a.orderType, tableId: a.orderType === "dine_in" ? s.current.tableId : null },
      };
    case "setTable": {
      // A table can only have one open bill: if it already has one, merge nothing, just switch to it.
      const other = s.held.find((b) => b.tableId === a.tableId && a.tableId !== null);
      if (other) return reducer(s, { type: "openBill", id: other.id });
      return { ...s, current: { ...s.current, tableId: a.tableId, orderType: a.tableId ? "dine_in" : s.current.orderType } };
    }
    case "hold":
      if (s.current.lines.length === 0) return s;
      return { ...s, held: [s.current, ...s.held], current: emptyBill(s.userId) };
    case "openBill": {
      const target = s.held.find((b) => b.id === a.id);
      if (!target) return s;
      const rest = s.held.filter((b) => b.id !== a.id);
      return { ...s, current: target, held: s.current.lines.length > 0 ? [s.current, ...rest] : rest };
    }
    case "openTable": {
      const existing = s.held.find((b) => b.tableId === a.tableId);
      if (existing) return reducer(s, { type: "openBill", id: existing.id });
      if (s.current.tableId === a.tableId) return s;
      return { ...s, held: parkCurrent(s), current: { ...emptyBill(s.userId), tableId: a.tableId } };
    }
    case "newBill":
      return { ...s, held: parkCurrent(s), current: emptyBill(s.userId, a.orderType) };
    case "clearCurrent":
      return { ...s, current: { ...s.current, lines: [] } };
    case "sendKot":
      return { ...s, current: { ...s.current, lines: s.current.lines.map((l) => ({ ...l, kotQty: l.qty })) } };
    case "pay": {
      if (s.current.lines.length === 0) return s;
      const t = calcBill(s.current.lines, s.tax);
      const seq = s.nextSeq;
      const bill: PaidBill = {
        id: newId("pb"),
        billNo: formatBillNo(financialYear(new Date(a.at)), seq),
        orderType: s.current.orderType,
        tableId: s.current.tableId,
        lines: s.current.lines,
        status: "paid",
        subtotalPaise: t.subtotal,
        serviceChargePaise: t.serviceCharge,
        cgstPaise: t.cgst,
        sgstPaise: t.sgst,
        roundOffPaise: t.roundOff,
        totalPaise: t.total,
        paymentMethod: a.method,
        createdBy: s.userId ?? "",
        paidAt: a.at,
      };
      return { ...s, paid: [bill, ...s.paid], nextSeq: seq + 1, current: emptyBill(s.userId), lastPaidId: bill.id };
    }
    case "cancelPaid":
      return {
        ...s,
        paid: s.paid.map((b) =>
          b.id === a.id && b.status === "paid"
            ? { ...b, status: "cancelled", cancelReason: a.reason, cancelledAt: a.at, cancelledBy: s.userId ?? "" }
            : b,
        ),
      };
    case "billPaid": {
      // The database assigned the bill number; take the bill exactly as it was saved.
      const seq = Number(a.bill.billNo.split("/")[2]);
      return {
        ...s,
        paid: [a.bill, ...s.paid.filter((b) => b.id !== a.bill.id)],
        nextSeq: Math.max(s.nextSeq, seq + 1),
        current: emptyBill(s.userId),
        lastPaidId: a.bill.id,
      };
    }
    case "billCancelled":
      return { ...s, paid: s.paid.map((b) => (b.id === a.bill.id ? a.bill : b)) };
    case "upsertItem": {
      const exists = s.menu.some((m) => m.id === a.item.id);
      return { ...s, menu: exists ? s.menu.map((m) => (m.id === a.item.id ? a.item : m)) : [...s.menu, a.item] };
    }
    case "toggleAvailable":
      return { ...s, menu: s.menu.map((m) => (m.id === a.itemId ? { ...m, available: !m.available } : m)) };
    case "deleteItem":
      // Soft delete: past bills keep their snapshot, the item just leaves the menu.
      return { ...s, menu: s.menu.map((m) => (m.id === a.itemId ? { ...m, deleted: true, available: false } : m)) };
    case "addCategory":
      return {
        ...s,
        categories: [...s.categories, { id: newId("c"), name: a.name, sortOrder: s.categories.length + 1, active: true }],
      };
    case "upsertCategory": {
      const exists = s.categories.some((c) => c.id === a.category.id);
      return {
        ...s,
        categories: exists ? s.categories.map((c) => (c.id === a.category.id ? a.category : c)) : [...s.categories, a.category],
      };
    }
    case "upsertTable": {
      const exists = s.tables.some((t) => t.id === a.table.id);
      return { ...s, tables: exists ? s.tables.map((t) => (t.id === a.table.id ? a.table : t)) : [...s.tables, a.table] };
    }
    case "setTax":
      return { ...s, tax: a.tax };
    case "setProfile":
      return { ...s, profile: a.profile };
    case "setPrinters":
      return { ...s, printers: a.printers };
    case "upsertStaff": {
      const exists = s.staff.some((x) => x.id === a.staff.id);
      return { ...s, staff: exists ? s.staff.map((x) => (x.id === a.staff.id ? a.staff : x)) : [...s.staff, a.staff] };
    }
  }
}

function mockInitialState(): State {
  const now = new Date();
  const { bills, nextSeq } = seedPaidBills(now, DEFAULT_TAX);
  return {
    userId: null,
    staff: STAFF,
    categories: CATEGORIES,
    menu: MENU_ITEMS,
    tables: TABLES,
    tax: DEFAULT_TAX,
    profile: DEFAULT_PROFILE,
    current: emptyBill(null),
    held: seedOpenBills(now),
    paid: bills,
    nextSeq,
    history: seedDailySummaries(now, 30),
    printers: { receipt: null, kot: null },
    lastPaidId: null,
  };
}

/** How many days of bills the desktop app keeps in memory (older bills stay in the database). */
const LOAD_DAYS = 62;

type LoadedState = {
  empty: boolean;
  staff: Staff[];
  categories: Category[];
  menu: MenuItem[];
  tables: DiningTable[];
  tax: TaxSettings;
  profile: RestaurantProfile;
  openBills: OpenBill[];
  paidBills: PaidBill[];
  nextSeq: number;
  history: DailySummary[];
  printers: PrinterSettings;
};

/** Sample restaurant for trying the app out. Offered on the setup screen. */
function demoSeedPayload(now: Date) {
  const { bills } = seedPaidBills(now, DEFAULT_TAX);
  return {
    profile: DEFAULT_PROFILE,
    tax: DEFAULT_TAX,
    staff: STAFF,
    categories: CATEGORIES,
    menu: MENU_ITEMS,
    tables: TABLES,
    openBills: seedOpenBills(now),
    paidBills: bills.map((b) => ({ ...b, paidDate: toISODate(new Date(b.paidAt)) })),
    history: seedDailySummaries(now, 30),
  };
}

/** Returns null when the database is brand new and the setup wizard should run. */
async function loadFromDatabase(api: SsbillsApi): Promise<State | null> {
  const now = new Date();
  const since = new Date(now.getTime() - LOAD_DAYS * 86_400_000);
  const ctx = { today: toISODate(now), fy: financialYear(now), sinceDate: toISODate(since) };
  const r = await api.call<LoadedState | { empty: true }>("loadState", ctx);
  if (r.empty) return null;
  const d = r as LoadedState;
  return {
    userId: null,
    staff: d.staff,
    categories: d.categories,
    menu: d.menu,
    tables: d.tables,
    tax: d.tax,
    profile: d.profile,
    current: emptyBill(null),
    held: d.openBills,
    paid: d.paidBills,
    nextSeq: d.nextSeq,
    history: d.history,
    printers: d.printers,
    lastPaidId: null,
  };
}

type Ctx = {
  state: State;
  dispatch: (a: Action) => void;
  user: Staff | null;
  isAdmin: boolean;
  openBills: OpenBill[];
  /** Tables and categories still in use (removed ones are hidden but old bills still point at them). */
  tables: DiningTable[];
  categories: Category[];
  /** Settle the bill on the billing screen. In the desktop app the database assigns the bill number. */
  payCurrent: (method: PaymentMethod) => Promise<void>;
  /** Cancel a paid bill (Admin). Kept for audit. */
  cancelBill: (id: string, reason: string) => Promise<void>;
  verifyPin: (staffId: string, pin: string) => Promise<boolean>;
  /** Set when a change could not be saved to disk. */
  saveError: string | null;
  dismissSaveError: () => void;
  /** True when changes are saved to the local database (desktop app). */
  persistent: boolean;
};

const PosContext = createContext<Ctx | null>(null);

/** Everything that is open on the counter: the bill being built (if it has items) plus held bills. */
const openList = (s: State): OpenBill[] => (s.current.lines.length > 0 ? [s.current, ...s.held] : s.held);

/**
 * Saves each change to the database by comparing the new state with the previous one.
 * Writes run one at a time in order, so a payment never overtakes the bill edit before it.
 */
function usePersistence(
  state: State,
  api: SsbillsApi | null,
  enqueue: (job: () => Promise<unknown>) => void,
) {
  const prev = useRef(state);
  useEffect(() => {
    const p = prev.current;
    prev.current = state;
    if (!api || p === state) return;

    const changed = <T extends { id: string }>(next: T[], before: T[]) => {
      const old = new Map(before.map((x) => [x.id, x]));
      return next.filter((x) => old.get(x.id) !== x);
    };
    const jobs: [string, unknown][] = [];
    if (state.tax !== p.tax) jobs.push(["setTax", state.tax]);
    if (state.profile !== p.profile) jobs.push(["setProfile", state.profile]);
    if (state.printers !== p.printers) jobs.push(["setPrinters", state.printers]);
    if (state.categories !== p.categories) changed(state.categories, p.categories).forEach((c) => jobs.push(["upsertCategory", c]));
    if (state.tables !== p.tables) changed(state.tables, p.tables).forEach((t) => jobs.push(["upsertTable", t]));
    if (state.menu !== p.menu) changed(state.menu, p.menu).forEach((m) => jobs.push(["upsertMenuItem", m]));
    if (state.staff !== p.staff) changed(state.staff, p.staff).forEach((x) => jobs.push(["upsertStaff", x]));

    const before = openList(p);
    const now = openList(state);
    changed(now, before).forEach((b) => jobs.push(["saveOpenBill", b]));
    const nowIds = new Set(now.map((b) => b.id));
    before.filter((b) => !nowIds.has(b.id)).forEach((b) => jobs.push(["deleteOpenBill", b.id]));

    for (const [name, arg] of jobs) enqueue(() => api.call(name, arg));
  }, [state, api, enqueue]);
}

function PosStore({ initial, api, children }: { initial: State; api: SsbillsApi | null; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  // Saves run strictly one after another; a failure is reported but doesn't stop later saves.
  const enqueue = useCallback((job: () => Promise<unknown>) => {
    queue.current = queue.current
      .then(job)
      .catch((e: unknown) => setSaveError(e instanceof Error ? e.message : String(e)));
  }, []);

  usePersistence(state, api, enqueue);

  const user = state.staff.find((x) => x.id === state.userId) ?? null;

  const payCurrent = async (method: PaymentMethod) => {
    const at = new Date();
    if (!api) {
      dispatch({ type: "pay", method, at: at.toISOString() });
      return;
    }
    const b = state.current;
    const totals = calcBill(b.lines, state.tax);
    await queue.current; // let any pending bill edits reach the database first
    const bill = await api.call<PaidBill>("payBill", {
      id: b.id,
      fy: financialYear(at),
      orderType: b.orderType,
      tableId: b.tableId,
      lines: b.lines,
      method,
      createdBy: state.userId ?? b.createdBy,
      createdAt: b.createdAt,
      paidAt: at.toISOString(),
      paidDate: toISODate(at),
      totals: {
        subtotal: totals.subtotal,
        serviceCharge: totals.serviceCharge,
        cgst: totals.cgst,
        sgst: totals.sgst,
        roundOff: totals.roundOff,
        total: totals.total,
      },
    });
    dispatch({ type: "billPaid", bill });
  };

  const cancelBill = async (id: string, reason: string) => {
    const at = new Date().toISOString();
    if (!api) {
      dispatch({ type: "cancelPaid", id, reason, at });
      return;
    }
    await queue.current;
    const bill = await api.call<PaidBill>("cancelBill", { id, reason, by: state.userId, at });
    dispatch({ type: "billCancelled", bill });
  };

  const verifyPin = async (staffId: string, pin: string) => {
    if (api) return api.call<boolean>("verifyPin", { id: staffId, pin });
    return state.staff.find((x) => x.id === staffId)?.pin === pin;
  };

  const value: Ctx = {
    state,
    dispatch,
    user,
    isAdmin: user?.role === "admin",
    openBills: openList(state),
    tables: state.tables.filter((t) => t.active),
    categories: state.categories.filter((c) => c.active),
    payCurrent,
    cancelBill,
    verifyPin,
    saveError,
    dismissSaveError: () => setSaveError(null),
    persistent: !!api,
  };
  return <PosContext.Provider value={value}>{children}</PosContext.Provider>;
}

type BootResult = { state: State; api: SsbillsApi | null } | { setup: SsbillsApi } | { error: string };

/** Loads the database (desktop) or mock data (browser) before the app renders, and runs first-time setup. */
function Boot({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<BootResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const api = window.ssbills ?? null;
    const load: Promise<BootResult> = api
      ? loadFromDatabase(api).then((state) => (state ? { state, api } : { setup: api }))
      : Promise.resolve({ state: mockInitialState(), api: null });
    load
      .then((r) => alive && setBoot(r))
      .catch((e: unknown) => alive && setBoot({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (!boot) return <div className="min-h-screen bg-surface" />;
  if ("error" in boot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-8">
        <div role="alert" className="max-w-lg rounded-2xl border border-error bg-error-container p-6 text-on-error-container">
          <h1 className="text-headline-md">SS Bills could not open its database</h1>
          <p className="mt-2 text-body-md">{boot.error}</p>
          <p className="mt-2 text-body-sm">Your data has not been changed. Restart the app, or contact SS Bills support.</p>
        </div>
      </div>
    );
  }
  if ("setup" in boot) {
    const api = boot.setup;
    return (
      <SetupWizard
        api={api}
        onSampleData={() => api.call("seedDemo", demoSeedPayload(new Date()))}
        onDone={() => {
          setBoot(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  return (
    <PosStore initial={boot.state} api={boot.api}>
      {children}
    </PosStore>
  );
}

/**
 * The app is fully client-side (it runs offline in Electron), and its data depends on the
 * current time and the local database, so nothing renders during the static prerender.
 */
export function PosProvider({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return <div className="min-h-screen bg-surface" />;
  return <Boot>{children}</Boot>;
}

const noopSubscribe = () => () => {};

export function usePos(): Ctx {
  const ctx = useContext(PosContext);
  if (!ctx) throw new Error("usePos must be used inside <PosProvider>");
  return ctx;
}

export function useCurrentTotals() {
  const { state } = usePos();
  const { current, tax } = state;
  return useMemo(() => calcBill(current.lines, tax), [current.lines, tax]);
}
