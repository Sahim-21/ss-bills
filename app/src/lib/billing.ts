// Bill calculation rules: docs/TRD.md §4. Pure functions, unit-tested in billing.test.ts.

export type TaxSettings = {
  /** GST rate in basis points: 500 = 5.00% */
  gstRateBp: number;
  /** Menu prices already include GST (tax is extracted, not added) */
  pricesIncludeTax: boolean;
  serviceChargeEnabled: boolean;
  /** Service charge in basis points: 500 = 5.00% */
  serviceChargeBp: number;
};

export type BillLineInput = { unitPricePaise: number; qty: number };

export type BillTotals = {
  subtotal: number;
  serviceCharge: number;
  /** Taxable value the GST is computed on */
  taxable: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
  itemCount: number;
  pieceCount: number;
};

/** Integer division rounded half-up (n, d >= 0). */
export function divRound(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

export function calcBill(lines: BillLineInput[], tax: TaxSettings): BillTotals {
  const subtotal = lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
  const serviceCharge = tax.serviceChargeEnabled
    ? divRound(subtotal * tax.serviceChargeBp, 10_000)
    : 0;
  const base = subtotal + serviceCharge;

  let taxable: number;
  let gst: number;
  if (tax.pricesIncludeTax) {
    taxable = divRound(base * 10_000, 10_000 + tax.gstRateBp);
    gst = base - taxable;
  } else {
    taxable = base;
    gst = divRound(base * tax.gstRateBp, 10_000);
  }

  // Split so the halves always add up exactly to the GST amount.
  const cgst = Math.floor(gst / 2);
  const sgst = gst - cgst;

  const beforeRound = taxable + gst;
  const total = divRound(beforeRound, 100) * 100;

  return {
    subtotal,
    serviceCharge,
    taxable,
    cgst,
    sgst,
    roundOff: total - beforeRound,
    total,
    itemCount: lines.filter((l) => l.qty > 0).length,
    pieceCount: lines.reduce((s, l) => s + l.qty, 0),
  };
}

/** Indian financial year label (April–March), e.g. "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** Sequential bill number, e.g. "SSB/2026-27/000123". */
export function formatBillNo(fy: string, seq: number, prefix = "SSB"): string {
  return `${prefix}/${fy}/${String(seq).padStart(6, "0")}`;
}

export function bpToPercentLabel(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}
