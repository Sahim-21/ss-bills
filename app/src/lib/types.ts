// Shapes mirror the local SQLite schema in docs/TRD.md §3 (money in paise).

export type Role = "admin" | "cashier";
export type OrderType = "dine_in" | "takeaway" | "delivery";
export type PaymentMethod = "cash" | "upi" | "card";

export type Staff = {
  id: string;
  name: string;
  role: Role;
  /** Mock only. Real app stores a bcrypt/argon2 hash (TRD §6). */
  pin: string;
  phone: string;
  active: boolean;
};

export type Category = { id: string; name: string; sortOrder: number; active: boolean };

export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  shortCode: string;
  pricePaise: number;
  veg: boolean;
  available: boolean;
  deleted: boolean;
};

export type DiningTable = { id: string; label: string; seats: number; active: boolean };

export type BillLine = {
  itemId: string;
  /** Snapshot at time of sale, so later menu edits never change old bills */
  name: string;
  unitPricePaise: number;
  veg: boolean;
  qty: number;
  /** Quantity already sent to the kitchen on a KOT */
  kotQty: number;
};

/** A bill being built or held (status "open"). Gets a number only when paid. */
export type OpenBill = {
  id: string;
  orderType: OrderType;
  tableId: string | null;
  lines: BillLine[];
  createdAt: string;
  createdBy: string;
};

export type PaidBill = {
  id: string;
  billNo: string;
  orderType: OrderType;
  tableId: string | null;
  lines: BillLine[];
  status: "paid" | "cancelled";
  subtotalPaise: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  createdBy: string;
  paidAt: string;
  cancelledBy?: string;
  cancelledAt?: string;
  cancelReason?: string;
};

export type RestaurantProfile = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  gstin: string;
  fssai: string;
  hsnSac: string;
  receiptHeader: string;
  receiptFooter: string;
  showLogo: boolean;
  paperWidthMm: 58 | 80;
};

/** Windows printer names. null = "ask every time" for receipts, and "same as the receipt printer" for the kitchen. */
export type PrinterSettings = { receipt: string | null; kot: string | null };

export type DailySummary = {
  date: string; // YYYY-MM-DD
  salesPaise: number;
  bills: number;
  cancelled: number;
  cashPaise: number;
  upiPaise: number;
  cardPaise: number;
  taxPaise: number;
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
};

export const PAYMENT_ICON: Record<PaymentMethod, string> = {
  cash: "payments",
  upi: "qr_code_2",
  card: "credit_card",
};
