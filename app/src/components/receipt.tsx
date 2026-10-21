"use client";

import { useMemo } from "react";
import { usePos } from "@/lib/pos-store";
import { RECEIPT_CSS, receiptHtml, type PaperWidth, type ReceiptData } from "@/lib/receipt-html";
import type { PaidBill, RestaurantProfile } from "@/lib/types";

export type { ReceiptData } from "@/lib/receipt-html";

/**
 * On-screen preview of the receipt. It shows the very same HTML that is sent to the printer
 * (src/lib/receipt-html.ts), so the preview is what you get on paper.
 */
export function Receipt({
  data,
  profile,
  width = 80,
  duplicate,
}: {
  data: ReceiptData;
  profile: RestaurantProfile;
  width?: PaperWidth;
  duplicate?: boolean;
}) {
  const html = useMemo(() => receiptHtml(data, profile, width, { duplicate }), [data, profile, width, duplicate]);
  return (
    // `zoom` enlarges the real-size (mm) receipt so it is readable on screen.
    <div className="receipt-edge relative mx-auto w-fit bg-white px-[4mm] pb-8 pt-3 shadow-level2" style={{ zoom: 1.45 }}>
      <style>{RECEIPT_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

/** Build receipt data for a paid bill using current profile/tax labels. */
export function useReceiptData(bill: PaidBill | undefined): ReceiptData | null {
  const { state } = usePos();
  return useMemo(() => {
    if (!bill) return null;
    return {
      billNo: bill.billNo,
      at: bill.paidAt,
      orderType: bill.orderType,
      tableLabel: state.tables.find((t) => t.id === bill.tableId)?.label,
      cashier: state.staff.find((s) => s.id === bill.createdBy)?.name ?? "",
      lines: bill.lines,
      subtotalPaise: bill.subtotalPaise,
      serviceChargePaise: bill.serviceChargePaise,
      cgstPaise: bill.cgstPaise,
      sgstPaise: bill.sgstPaise,
      roundOffPaise: bill.roundOffPaise,
      totalPaise: bill.totalPaise,
      paymentMethod: bill.paymentMethod,
      gstRateBp: state.tax.gstRateBp,
      serviceChargeBp: state.tax.serviceChargeBp,
      cancelled: bill.status === "cancelled",
    };
  }, [bill, state.tables, state.staff, state.tax]);
}
