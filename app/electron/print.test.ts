import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createPrinter, PX_PER_MM, FEED_MM } = require("./print.cjs");

type PrintCb = (ok: boolean, reason?: string) => void;

/** A stand-in for Electron's BrowserWindow that records what the printer code does. */
function fake(opts: { printers?: { name: string }[]; heightPx?: number; printResult?: [boolean, string?] } = {}) {
  const log: { printOptions?: Record<string, unknown>; pdfOptions?: Record<string, unknown>; destroyed: boolean; url?: string; winOpts?: Record<string, unknown> } = { destroyed: false };
  const wc = {
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    executeJavaScript: vi.fn(async () => opts.heightPx ?? 400),
    getPrintersAsync: vi.fn(async () => opts.printers ?? [{ name: "XP-80C", isDefault: true }]),
    print: vi.fn((o: Record<string, unknown>, cb: PrintCb) => {
      log.printOptions = o;
      const [ok, reason] = opts.printResult ?? [true];
      cb(ok, reason);
    }),
    printToPDF: vi.fn(async (o: Record<string, unknown>) => {
      log.pdfOptions = o;
      return Buffer.from("%PDF-fake");
    }),
  };
  class FakeWindow {
    webContents = wc;
    constructor(o: Record<string, unknown>) {
      log.winOpts = o;
    }
    async loadURL(u: string) {
      log.url = u;
    }
    isDestroyed() {
      return log.destroyed;
    }
    destroy() {
      log.destroyed = true;
    }
  }
  return { printer: createPrinter({ BrowserWindow: FakeWindow }), wc, log };
}

const html = "<!doctype html><p>hello ₹</p>";

describe("printHtml", () => {
  it("prints silently to the named printer, sized to the content", async () => {
    const { printer, log } = fake({ heightPx: 756 });
    const r = await printer.printHtml({ html, widthMm: 80, deviceName: "XP-80C" });
    expect(r).toEqual({ printer: "XP-80C" });
    expect(log.printOptions).toMatchObject({
      silent: true,
      deviceName: "XP-80C",
      printBackground: true,
      margins: { marginType: "none" },
      copies: 1,
    });
    const size = log.printOptions!.pageSize as { width: number; height: number };
    expect(size.width).toBe(80000);
    expect(size.height).toBe(Math.round((756 / PX_PER_MM + FEED_MM) * 1000)); // content + feed
  });

  it("loads the document as an escaped data URL", async () => {
    const { printer, log } = fake();
    await printer.printHtml({ html, widthMm: 58, deviceName: "XP-80C" });
    expect(log.url!.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(log.url!.split(",")[1])).toBe(html);
  });

  it("uses a sandboxed hidden window and always closes it", async () => {
    const { printer, log } = fake();
    await printer.printHtml({ html, widthMm: 80, deviceName: "XP-80C" });
    expect(log.winOpts).toMatchObject({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    expect(log.destroyed).toBe(true);
  });

  it("fails clearly when the printer is not there, and prints nothing", async () => {
    const { printer, wc, log } = fake({ printers: [{ name: "Other" }] });
    await expect(printer.printHtml({ html, widthMm: 80, deviceName: "XP-80C" })).rejects.toThrow(/"XP-80C" was not found.*Settings/);
    expect(wc.print).not.toHaveBeenCalled();
    expect(log.destroyed).toBe(true);
  });

  it("passes the printer's own error message on", async () => {
    const { printer, log } = fake({ printResult: [false, "Printer is out of paper"] });
    await expect(printer.printHtml({ html, widthMm: 80, deviceName: "XP-80C" })).rejects.toThrow(/out of paper/);
    expect(log.destroyed).toBe(true);
  });

  it("opens the system dialog when no printer is chosen, and treats Cancel as not an error", async () => {
    const ok = fake();
    expect(await ok.printer.printHtml({ html, widthMm: 80 })).toEqual({ printer: null });
    expect(ok.log.printOptions).toMatchObject({ silent: false });
    expect(ok.log.printOptions).not.toHaveProperty("deviceName");

    const cancelled = fake({ printResult: [false, "cancelled"] });
    expect(await cancelled.printer.printHtml({ html, widthMm: 80 })).toEqual({ cancelled: true });
  });

  it("rejects bad input before opening a window", async () => {
    const { printer, log } = fake();
    await expect(printer.printHtml({ html: "", widthMm: 80 })).rejects.toThrow(/Nothing to print/);
    await expect(printer.printHtml({ html: 5, widthMm: 80 })).rejects.toThrow(/Nothing to print/);
    await expect(printer.printHtml({ html: "x".repeat(2_000_000), widthMm: 80 })).rejects.toThrow(/Nothing to print/);
    await expect(printer.printHtml({ html, widthMm: 100 })).rejects.toThrow(/58mm or 80mm/);
    expect(log.winOpts).toBeUndefined();
  });
});

describe("htmlToPdf", () => {
  it("makes a page as wide as the paper and as long as the content", async () => {
    const { printer, log } = fake({ heightPx: 960 });
    const pdf = await printer.htmlToPdf({ html, widthMm: 80 });
    expect(pdf.toString()).toBe("%PDF-fake");
    const size = log.pdfOptions!.pageSize as { width: number; height: number };
    expect(size.width).toBeCloseTo(80 / 25.4, 5);
    expect(size.height).toBeCloseTo(960 / 96 + FEED_MM / 25.4, 5);
    expect(log.pdfOptions).toMatchObject({ printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    expect(log.destroyed).toBe(true);
  });
});

describe("listPrinters", () => {
  it("returns the printers Windows knows about", async () => {
    const { printer, wc } = fake({ printers: [{ name: "XP-80C", displayName: "Xprinter XP-80C", isDefault: true } as never, { name: "PDF" }] });
    const list = await printer.listPrinters(wc);
    expect(list).toEqual([
      { name: "XP-80C", displayName: "Xprinter XP-80C", isDefault: true, status: 0 },
      { name: "PDF", displayName: "PDF", isDefault: false, status: 0 },
    ]);
  });
});
