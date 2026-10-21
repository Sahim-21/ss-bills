import { describe, expect, it } from "vitest";
import { CONTENT_MM, esc, kotHtml, printDocument, receiptHtml, type KotData, type ReceiptData } from "./receipt-html";
import { DEFAULT_PROFILE } from "./mock-data";

const line = (name: string, qty: number, price: number, veg = true) => ({ itemId: name, name, unitPricePaise: price, veg, qty, kotQty: 0 });

const data: ReceiptData = {
  billNo: "SSB/2026-27/000123",
  at: "2026-10-21T14:15:00.000Z",
  orderType: "dine_in",
  tableLabel: "T4",
  cashier: "Ramesh Kumar",
  lines: [line("Paneer Butter Masala", 2, 26000), line("Chicken Biryani", 1, 28000, false)],
  subtotalPaise: 80000,
  serviceChargePaise: 0,
  cgstPaise: 1000,
  sgstPaise: 1000,
  roundOffPaise: 0,
  totalPaise: 82000,
  paymentMethod: "upi",
  gstRateBp: 500,
  serviceChargeBp: 500,
};

describe("esc", () => {
  it("escapes everything that could become markup", () => {
    expect(esc(`<img src=x onerror="alert('1')"> & more`)).toBe("&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt; &amp; more");
    expect(esc(undefined)).toBe("");
  });
});

describe("receiptHtml", () => {
  const html = receiptHtml(data, DEFAULT_PROFILE, 80);

  it("contains the bill details and amounts", () => {
    expect(html).toContain("SSB/2026-27/000123");
    expect(html).toContain("Paneer Butter Masala");
    expect(html).toContain("2 x 260.00");
    expect(html).toContain("520.00");
    expect(html).toContain("CGST @ 2.5%");
    expect(html).toContain("₹820.00");
    expect(html).toContain("Table T4");
    expect(html).toContain("Paid by");
    expect(html).toContain(DEFAULT_PROFILE.gstin);
  });

  it("marks veg and non-veg items", () => {
    expect(html).toContain('class="mark veg"');
    expect(html).toContain('class="mark nonveg"');
  });

  it("never lets user-entered text become markup", () => {
    const evil = receiptHtml(
      { ...data, lines: [line('<script>alert(1)</script>', 1, 100)], cashier: '"><b>x</b>' },
      { ...DEFAULT_PROFILE, receiptHeader: "<svg onload=alert(1)>", receiptFooter: "<iframe src=//evil>", name: "<b>X</b>" },
      80,
    );
    expect(evil).not.toMatch(/<script|<svg|<iframe|<b>x<\/b>|<b>X<\/b>/i);
    expect(evil).toContain("&lt;script&gt;");
  });

  it("shows the service charge line only when there is one", () => {
    expect(html).not.toContain("Service charge");
    expect(receiptHtml({ ...data, serviceChargePaise: 4000 }, DEFAULT_PROFILE, 80)).toContain("Service charge @ 5%");
  });

  it("stamps duplicates and cancelled bills", () => {
    expect(html).not.toContain("DUPLICATE");
    expect(receiptHtml(data, DEFAULT_PROFILE, 80, { duplicate: true })).toContain("DUPLICATE");
    expect(receiptHtml({ ...data, cancelled: true }, DEFAULT_PROFILE, 80)).toContain("CANCELLED");
  });

  it("formats the round-off sign", () => {
    expect(receiptHtml({ ...data, roundOffPaise: 50 }, DEFAULT_PROFILE, 80)).toContain("+₹0.50");
    expect(receiptHtml({ ...data, roundOffPaise: -50 }, DEFAULT_PROFILE, 80)).toContain("-₹0.50");
  });

  it("omits the logo when turned off", () => {
    expect(receiptHtml(data, { ...DEFAULT_PROFILE, showLogo: false }, 80)).not.toContain('class="logo"');
    expect(html).toContain('class="logo"');
  });

  it("sizes for 58mm and 80mm paper", () => {
    expect(receiptHtml(data, DEFAULT_PROFILE, 58)).toContain('class="r w58"');
    expect(html).toContain('class="r w80"');
    expect(CONTENT_MM).toEqual({ 80: 72, 58: 48 });
  });
});

describe("kotHtml", () => {
  const kot: KotData = {
    orderType: "dine_in",
    tableLabel: "T4",
    at: "2026-10-21T14:15:00.000Z",
    cashier: "Ramesh Kumar",
    lines: [{ name: "Paneer Tikka", qty: 2, veg: true }, { name: "Chicken <Tikka>", qty: 1, veg: false }],
  };
  const html = kotHtml(kot, 80);

  it("lists the items with quantities and no prices", () => {
    expect(html).toContain("KITCHEN ORDER");
    expect(html).toContain("Table T4");
    expect(html).toContain("2 x");
    expect(html).toContain("Paneer Tikka");
    expect(html).toContain("3 items");
    expect(html).not.toMatch(/₹|\d+\.\d{2}/);
  });

  it("escapes item names", () => {
    expect(html).toContain("Chicken &lt;Tikka&gt;");
  });

  it("uses a singular label for one item", () => {
    expect(kotHtml({ ...kot, lines: [kot.lines[0]].map((l) => ({ ...l, qty: 1 })) }, 58)).toContain("1 item ");
  });
});

describe("printDocument", () => {
  it("sets the page size and blocks scripts and network", () => {
    const doc = printDocument("<p>x</p>", 58);
    expect(doc).toContain("size:58mm auto");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("<p>x</p>");
    expect(doc).not.toContain("<script");
  });
});
