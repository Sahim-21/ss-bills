// Receipt and kitchen-ticket layout as plain HTML. This one generator feeds BOTH the on-screen
// preview and the printer (through the Windows printer driver, see electron/print.cjs), so what
// you see is exactly what prints. Black on white only, with no shadows or greys, so it prints
// cleanly on a thermal printer. Every piece of user text is HTML-escaped.
import { bpToPercentLabel } from "./billing";
import { formatAmount, formatINR } from "./money";
import type { BillLine, OrderType, PaymentMethod, RestaurantProfile } from "./types";
import { ORDER_TYPE_LABEL, PAYMENT_LABEL } from "./types";

export type PaperWidth = 58 | 80;

export type ReceiptData = {
  billNo: string;
  at: string;
  orderType: OrderType;
  tableLabel?: string;
  cashier: string;
  lines: BillLine[];
  subtotalPaise: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paymentMethod: PaymentMethod;
  gstRateBp: number;
  serviceChargeBp: number;
  cancelled?: boolean;
};

export type KotData = {
  orderType: OrderType;
  tableLabel?: string;
  at: string;
  cashier: string;
  /** Only the items that have not been sent to the kitchen yet. No prices. */
  lines: { name: string; qty: number; veg: boolean }[];
};

/** Printable width of the paper in millimetres (the sheet is 80mm / 58mm, the printer leaves margins). */
export const CONTENT_MM: Record<PaperWidth, number> = { 80: 72, 58: 48 };

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Layout CSS shared by the preview and the print document. */
export const RECEIPT_CSS = `
.r{box-sizing:border-box;font-family:Consolas,"Cascadia Mono","Courier New",monospace;color:#000;background:#fff;font-size:11.5px;line-height:1.4;padding:3mm 0}
.r.w80{width:72mm}
.r.w58{width:48mm;font-size:10.5px}
.r .c{text-align:center}
.r .b{font-weight:700}
.r .row{display:flex;justify-content:space-between;gap:6px}
.r .row>span:first-child{flex:1;min-width:0}
.r .hr{border-top:1px dashed #000;margin:5px 0}
.r .hr2{border-top:3px double #000;margin:5px 0}
.r .total{font-size:1.5em;font-weight:700}
.r .logo{display:inline-block;width:9mm;height:9mm;line-height:9mm;background:#000;color:#fff;font-family:Arial,sans-serif;font-weight:800;font-size:12px;margin-bottom:3px}
.r .stamp{border:2px dashed #000;text-align:center;font-weight:700;letter-spacing:.2em;padding:2px 0;margin-bottom:6px}
.r .name{display:flex;align-items:flex-start;gap:4px;font-weight:700}
.r .qty{padding-left:13px}
.r .mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:9px;height:9px;border:1px solid #000;margin-top:3px}
.r .mark.veg::after{content:"";width:4px;height:4px;border-radius:50%;background:#000}
.r .mark.nonveg::after{content:"";border-left:2.5px solid transparent;border-right:2.5px solid transparent;border-bottom:4.5px solid #000}
.r .small{font-size:.86em}
.r .kot-title{font-size:1.7em;font-weight:700;letter-spacing:.08em}
.r .kot-item{display:flex;gap:8px;align-items:flex-start;font-size:1.35em;font-weight:700;margin:4px 0}
.r .kot-qty{min-width:2.2em}
`;

const signed = (paise: number) => `${paise < 0 ? "-" : paise > 0 ? "+" : ""}${formatINR(Math.abs(paise))}`;

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function mark(veg: boolean): string {
  return `<span class="mark ${veg ? "veg" : "nonveg"}"></span>`;
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "SS"
  );
}

/** The receipt body (no <html> wrapper). Used directly for the on-screen preview. */
export function receiptHtml(data: ReceiptData, profile: RestaurantProfile, width: PaperWidth, opts: { duplicate?: boolean } = {}): string {
  const half = bpToPercentLabel(data.gstRateBp / 2);
  const header = profile.receiptHeader.split("\n").filter((l) => l.trim());
  const footer = profile.receiptFooter.split("\n").filter((l) => l.trim());
  const items = data.lines
    .map(
      (l) => `<div>
  <div class="name">${mark(l.veg)}<span>${esc(l.name)}</span></div>
  <div class="row qty"><span>${l.qty} x ${formatAmount(l.unitPricePaise)}</span><span>${formatAmount(l.unitPricePaise * l.qty)}</span></div>
</div>`,
    )
    .join('<div style="height:3px"></div>');

  return `<div class="r w${width}">
${opts.duplicate || data.cancelled ? `<div class="stamp">${data.cancelled ? "CANCELLED" : "DUPLICATE"}</div>` : ""}
<div class="c">
${profile.showLogo ? `<div class="logo">${esc(initials(profile.name))}</div>` : ""}
${header.map((l, i) => `<div${i === 0 ? ' class="b" style="font-size:1.2em;letter-spacing:.04em"' : ""}>${esc(i === 0 ? l.toUpperCase() : l)}</div>`).join("\n")}
<div class="small" style="margin-top:2px">GSTIN: ${esc(profile.gstin || "-")} | FSSAI: ${esc(profile.fssai || "-")}</div>
</div>
<div class="hr"></div>
<div>Bill: <span class="b">${esc(data.billNo)}</span></div>
<div>${esc(dateTime.format(new Date(data.at)))}</div>
<div class="row"><span>${esc(ORDER_TYPE_LABEL[data.orderType])}${data.tableLabel ? ` &middot; Table ${esc(data.tableLabel)}` : ""}</span><span>Cashier: ${esc(data.cashier.split(" ")[0])}</span></div>
<div class="hr"></div>
<div class="row b"><span>ITEM</span><span>QTY x RATE &nbsp; AMOUNT</span></div>
<div style="margin-top:3px">${items}</div>
<div class="hr"></div>
<div class="row"><span>Sub Total (${data.lines.length} items)</span><span>${formatINR(data.subtotalPaise)}</span></div>
${data.serviceChargePaise > 0 ? `<div class="row"><span>Service charge @ ${esc(bpToPercentLabel(data.serviceChargeBp))}</span><span>${formatINR(data.serviceChargePaise)}</span></div>` : ""}
<div class="row"><span>CGST @ ${esc(half)}</span><span>${formatINR(data.cgstPaise)}</span></div>
<div class="row"><span>SGST @ ${esc(half)}</span><span>${formatINR(data.sgstPaise)}</span></div>
<div class="row"><span>Round off</span><span>${signed(data.roundOffPaise)}</span></div>
<div class="hr2"></div>
<div class="row total"><span>TOTAL</span><span>${formatINR(data.totalPaise)}</span></div>
<div class="hr2"></div>
<div class="row"><span>Paid by</span><span>${esc(PAYMENT_LABEL[data.paymentMethod])}</span></div>
<div class="hr"></div>
<div class="c">
${footer.map((l, i) => `<div${i === 0 ? ' class="b"' : ""}>${esc(l)}</div>`).join("\n")}
<div class="small" style="margin-top:3px">SAC ${esc(profile.hsnSac)} &middot; Powered by SS Bills</div>
</div>
</div>`;
}

/** The kitchen ticket body: big quantities, no prices. */
export function kotHtml(data: KotData, width: PaperWidth): string {
  const total = data.lines.reduce((s, l) => s + l.qty, 0);
  return `<div class="r w${width}">
<div class="c kot-title">KITCHEN ORDER</div>
<div class="hr"></div>
<div class="row b" style="font-size:1.2em"><span>${esc(ORDER_TYPE_LABEL[data.orderType])}${data.tableLabel ? ` &middot; Table ${esc(data.tableLabel)}` : ""}</span></div>
<div class="row small"><span>${esc(dateTime.format(new Date(data.at)))}</span><span>${esc(data.cashier.split(" ")[0])}</span></div>
<div class="hr"></div>
${data.lines.map((l) => `<div class="kot-item"><span class="kot-qty">${l.qty} x</span>${mark(l.veg)}<span>${esc(l.name)}</span></div>`).join("\n")}
<div class="hr"></div>
<div class="c small">${total} ${total === 1 ? "item" : "items"} &middot; new</div>
</div>`;
}

/** A complete HTML document for the print window. Locked down: no scripts, no network. */
export function printDocument(body: string, width: PaperWidth): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
@page{size:${width}mm auto;margin:0}
html,body{margin:0;padding:0;background:#fff}
body{width:${width}mm;display:flex;justify-content:center}
${RECEIPT_CSS}
</style></head><body>${body}</body></html>`;
}
