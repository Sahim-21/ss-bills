// Printing through the Windows printer driver (D-023). Works with any printer that has a driver,
// which covers nearly all thermal receipt printers, and needs no printer-specific code.
//
// A receipt or kitchen ticket arrives as a complete HTML document (src/lib/receipt-html.ts). It is
// loaded into a hidden, locked-down window, measured so the paper length matches the content, and
// then either sent silently to a named printer, sent to the system print dialog, or saved as PDF.

const PX_PER_MM = 96 / 25.4;
const PAPER_MM = [58, 80];
const MAX_HTML = 1_000_000; // a receipt is a few KB; refuse anything absurd
const FEED_MM = 6; // blank paper after the content so the ticket can be torn off cleanly

/**
 * `BrowserWindow` is injected so tests can run without Electron. In the app it is Electron's.
 */
function createPrinter({ BrowserWindow }) {
  function check(html, widthMm) {
    if (typeof html !== "string" || html.length === 0 || html.length > MAX_HTML) throw new Error("Nothing to print");
    if (!PAPER_MM.includes(widthMm)) throw new Error("Paper width must be 58mm or 80mm");
  }

  /** Load `html` in a hidden window, measure it, run `fn`, then always close the window. */
  async function withDocument(html, widthMm, fn) {
    const win = new BrowserWindow({
      show: false,
      useContentSize: true,
      width: Math.ceil(widthMm * PX_PER_MM),
      height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    });
    try {
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: "deny" }));
      wc.on("will-navigate", (e) => e.preventDefault());
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      // Measure the content itself. documentElement.scrollHeight would return the (taller) window height.
      const heightPx = await wc.executeJavaScript("Math.ceil(document.body.getBoundingClientRect().height)");
      return await fn(wc, Number(heightPx) || 0);
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  const mapPrinter = (p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: !!p.isDefault,
    status: p.status ?? 0,
  });

  return {
    mapPrinter,

    /** Printers Windows knows about. `wc` is any webContents (Electron needs one to ask). */
    async listPrinters(wc) {
      return (await wc.getPrintersAsync()).map(mapPrinter);
    },

    /**
     * Print a document. With `deviceName` it prints silently to that printer (and fails with a clear
     * message if it is missing). Without one it opens the system print dialog.
     * Resolves { printer } on success or { cancelled: true } if the user closed the dialog.
     */
    async printHtml({ html, widthMm, deviceName }) {
      check(html, widthMm);
      return withDocument(html, widthMm, async (wc, heightPx) => {
        const silent = typeof deviceName === "string" && deviceName.length > 0;
        if (silent) {
          const known = (await wc.getPrintersAsync()).some((p) => p.name === deviceName);
          if (!known) {
            throw new Error(
              `Printer "${deviceName}" was not found. Check it is plugged in and turned on, or choose another printer in Settings → Printing.`,
            );
          }
        }
        const options = {
          silent,
          printBackground: true,
          margins: { marginType: "none" },
          pageSize: {
            width: Math.round(widthMm * 1000),
            height: Math.round((heightPx / PX_PER_MM + FEED_MM) * 1000),
          },
          copies: 1,
          ...(silent ? { deviceName } : {}),
        };
        return new Promise((resolve, reject) => {
          wc.print(options, (success, reason) => {
            if (success) resolve({ printer: silent ? deviceName : null });
            else if (!silent && /cancel/i.test(reason || "")) resolve({ cancelled: true });
            else reject(new Error(reason ? `The printer reported: ${reason}` : "Printing failed"));
          });
        });
      });
    },

    /** Render a document to a PDF whose page is exactly as wide as the paper and as long as the content. */
    async htmlToPdf({ html, widthMm }) {
      check(html, widthMm);
      return withDocument(html, widthMm, (wc, heightPx) =>
        wc.printToPDF({
          printBackground: true,
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
          pageSize: { width: widthMm / 25.4, height: heightPx / 96 + FEED_MM / 25.4 },
        }),
      );
    },
  };
}

module.exports = { createPrinter, PX_PER_MM, FEED_MM };
