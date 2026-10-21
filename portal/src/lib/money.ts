// All money in SS Bills is integer paise (₹1 = 100 paise). Never use floats for money.

const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const plain2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹1,24,500.00 (always two decimals). */
export function formatINR(paise: number): string {
  return inr2.format(paise / 100);
}

/** ₹1,24,500 when whole rupees, otherwise ₹1,24,500.50. */
export function formatINRShort(paise: number): string {
  return paise % 100 === 0 ? inr0.format(paise / 100) : inr2.format(paise / 100);
}

/** Compact for chart axes: ₹48.3K, ₹4.1L, ₹1.2Cr. */
export function formatINRCompact(paise: number): string {
  const r = paise / 100;
  if (r >= 1e7) return `₹${trim(r / 1e7)}Cr`;
  if (r >= 1e5) return `₹${trim(r / 1e5)}L`;
  if (r >= 1e3) return `₹${trim(r / 1e3)}K`;
  return `₹${Math.round(r)}`;
}

/** 1,030.00 (no symbol), for receipts. */
export function formatAmount(paise: number): string {
  return plain2.format(paise / 100);
}

/** Signed amount for round-off lines: +₹0.50 / -₹0.50 / ₹0.00. */
export function formatSignedINR(paise: number): string {
  if (paise === 0) return formatINR(0);
  return `${paise > 0 ? "+" : "-"}${formatINR(Math.abs(paise))}`;
}

export function rupeesToPaise(rupees: string | number): number {
  const n = typeof rupees === "number" ? rupees : Number.parseFloat(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}
