import { describe, expect, it } from "vitest";
import { calcBill, divRound, financialYear, formatBillNo, type TaxSettings } from "./billing";
import { formatINR, formatINRShort } from "./money";

const exclusive5: TaxSettings = {
  gstRateBp: 500,
  pricesIncludeTax: false,
  serviceChargeEnabled: false,
  serviceChargeBp: 500,
};

describe("divRound", () => {
  it("rounds half up", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(4, 2)).toBe(2);
    expect(divRound(149, 100)).toBe(1);
    expect(divRound(150, 100)).toBe(2);
  });
});

describe("calcBill", () => {
  it("computes exclusive GST with CGST/SGST split and round-off", () => {
    // 2×260 + 3×50 + 280 + 80 = ₹1,030
    const t = calcBill(
      [
        { unitPricePaise: 26000, qty: 2 },
        { unitPricePaise: 5000, qty: 3 },
        { unitPricePaise: 28000, qty: 1 },
        { unitPricePaise: 8000, qty: 1 },
      ],
      exclusive5,
    );
    expect(t.subtotal).toBe(103000);
    expect(t.cgst).toBe(2575);
    expect(t.sgst).toBe(2575);
    expect(t.roundOff).toBe(50); // 1,081.50 → 1,082
    expect(t.total).toBe(108200);
    expect(t.itemCount).toBe(4);
    expect(t.pieceCount).toBe(7);
  });

  it("splits odd GST paise so halves add up exactly", () => {
    const t = calcBill([{ unitPricePaise: 103020, qty: 1 }], exclusive5); // GST 5151
    expect(t.cgst + t.sgst).toBe(5151);
    expect(t.sgst - t.cgst).toBe(1);
  });

  it("extracts GST when prices include tax", () => {
    const t = calcBill([{ unitPricePaise: 105000, qty: 1 }], {
      ...exclusive5,
      pricesIncludeTax: true,
    });
    expect(t.taxable).toBe(100000);
    expect(t.cgst + t.sgst).toBe(5000);
    expect(t.total).toBe(105000);
    expect(t.roundOff).toBe(0);
  });

  it("adds service charge before GST only when enabled", () => {
    const lines = [{ unitPricePaise: 100000, qty: 1 }];
    expect(calcBill(lines, exclusive5).serviceCharge).toBe(0);
    const t = calcBill(lines, { ...exclusive5, serviceChargeEnabled: true });
    expect(t.serviceCharge).toBe(5000);
    expect(t.cgst + t.sgst).toBe(5250); // 5% of 1,050
    expect(t.total).toBe(110300); // 1,102.50 → 1,103
  });

  it("handles an empty bill", () => {
    const t = calcBill([], exclusive5);
    expect(t.total).toBe(0);
    expect(t.roundOff).toBe(0);
  });

  it("never rounds a total down by more than 49 paise or up by more than 50", () => {
    for (let p = 1; p < 2000; p += 37) {
      const t = calcBill([{ unitPricePaise: p * 100 + (p % 100), qty: 1 }], exclusive5);
      expect(t.roundOff).toBeGreaterThanOrEqual(-49);
      expect(t.roundOff).toBeLessThanOrEqual(50);
      expect(t.total % 100).toBe(0);
    }
  });
});

describe("bill numbers", () => {
  it("uses the April–March financial year", () => {
    expect(financialYear(new Date(2026, 9, 21))).toBe("2026-27");
    expect(financialYear(new Date(2027, 2, 31))).toBe("2026-27");
    expect(financialYear(new Date(2027, 3, 1))).toBe("2027-28");
    expect(financialYear(new Date(2099, 5, 1))).toBe("2099-00");
  });

  it("pads the sequence", () => {
    expect(formatBillNo("2026-27", 123)).toBe("SSB/2026-27/000123");
  });
});

describe("money formatting", () => {
  it("uses Indian grouping", () => {
    expect(formatINR(12450000)).toBe("₹1,24,500.00");
    expect(formatINRShort(108100)).toBe("₹1,081");
    expect(formatINRShort(108150)).toBe("₹1,081.50");
  });
});
