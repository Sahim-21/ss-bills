"use client";

// Printing for the screens. In the desktop app this goes through the Windows printer driver
// (electron/print.cjs). In a plain browser it falls back to the browser's print dialog.
import { useCallback } from "react";
import { usePos } from "./pos-store";
import { kotHtml, printDocument, receiptHtml, type KotData, type PaperWidth, type ReceiptData } from "./receipt-html";
import type { OpenBill, RestaurantProfile } from "./types";

export type PrintOutcome =
  | { ok: true; printer: string | null; cancelled?: boolean }
  | { ok: false; error: string };

export type PrinterInfo = { name: string; displayName: string; isDefault: boolean; status: number };

/** Browser fallback: print a document through a hidden iframe (shows the browser's print dialog). */
function printInBrowser(doc: string): Promise<PrintOutcome> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    frame.onload = () => {
      try {
        frame.contentWindow?.print();
        resolve({ ok: true, printer: null });
      } catch (e) {
        resolve({ ok: false, error: e instanceof Error ? e.message : "Could not open the print dialog" });
      }
      setTimeout(() => frame.remove(), 1000);
    };
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

/** Items still to be sent to the kitchen (quantity not yet on a ticket). */
export function buildKot(bill: OpenBill, tableLabel: string | undefined, cashier: string): KotData {
  return {
    orderType: bill.orderType,
    tableLabel,
    at: new Date().toISOString(),
    cashier,
    lines: bill.lines
      .filter((l) => l.qty > l.kotQty)
      .map((l) => ({ name: l.name, qty: l.qty - l.kotQty, veg: l.veg })),
  };
}

export function usePrinting() {
  const { state } = usePos();
  const { printers } = state;
  const profileWidth = state.profile.paperWidthMm;

  // null receipt printer = ask every time. A null kitchen printer = same as the receipt printer.
  const receiptPrinter = printers.receipt;
  const kotPrinter = printers.kot ?? printers.receipt;

  const send = useCallback(async (doc: string, widthMm: PaperWidth, deviceName: string | null): Promise<PrintOutcome> => {
    const api = window.ssbills;
    if (!api) return printInBrowser(doc);
    try {
      const r = await api.print<{ printer: string | null; cancelled?: boolean }>("printHtml", { html: doc, widthMm, deviceName });
      return { ok: true, printer: r.printer, cancelled: r.cancelled };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Printing failed" };
    }
  }, []);

  const printReceipt = useCallback(
    (data: ReceiptData, opts: { duplicate?: boolean; width?: PaperWidth; profile?: RestaurantProfile; printer?: string | null } = {}) => {
      const width = opts.width ?? profileWidth;
      const doc = printDocument(receiptHtml(data, opts.profile ?? state.profile, width, { duplicate: opts.duplicate }), width);
      return send(doc, width, opts.printer === undefined ? receiptPrinter : opts.printer);
    },
    [profileWidth, receiptPrinter, send, state.profile],
  );

  const printKot = useCallback(
    (data: KotData, opts: { printer?: string | null } = {}) => {
      const doc = printDocument(kotHtml(data, profileWidth), profileWidth);
      return send(doc, profileWidth, opts.printer === undefined ? kotPrinter : opts.printer);
    },
    [kotPrinter, profileWidth, send],
  );

  /** Save a receipt as a PDF (the user picks where in the system Save dialog). */
  const savePdf = useCallback(
    async (data: ReceiptData, fileName: string, opts: { width?: PaperWidth } = {}): Promise<PrintOutcome & { filePath?: string }> => {
      const width = opts.width ?? profileWidth;
      const doc = printDocument(receiptHtml(data, state.profile, width), width);
      const api = window.ssbills;
      if (!api) return printInBrowser(doc); // in a browser, "Save as PDF" is in the print dialog
      try {
        const r = await api.print<{ filePath?: string; cancelled?: boolean }>("savePdf", { html: doc, widthMm: width, fileName });
        return { ok: true, printer: null, cancelled: r.cancelled, filePath: r.filePath };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not save the PDF" };
      }
    },
    [profileWidth, state.profile],
  );

  const listPrinters = useCallback(async (): Promise<PrinterInfo[]> => {
    const api = window.ssbills;
    return api ? api.print<PrinterInfo[]>("listPrinters") : [];
  }, []);

  return { printReceipt, printKot, savePdf, listPrinters, receiptPrinter, kotPrinter, isDesktop: typeof window !== "undefined" && !!window.ssbills };
}

/** What the on-screen status line should say after a print attempt. */
export function describeOutcome(o: PrintOutcome & { filePath?: string }, what = "Receipt"): { tone: "ok" | "info" | "error"; text: string } {
  if (!o.ok) return { tone: "error", text: o.error };
  if (o.cancelled) return { tone: "info", text: "Cancelled. Nothing was printed." };
  if (o.filePath) return { tone: "ok", text: `Saved to ${o.filePath}` };
  return { tone: "ok", text: o.printer ? `${what} sent to ${o.printer}` : `${what} sent to the print dialog` };
}
