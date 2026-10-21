// SS Bills desktop shell (TRD §2, D-013).
// Dev:  loads the Next.js dev server (npm run electron:dev).
// Prod: serves the static export in ../out through a private app:// protocol, so the
//       app works fully offline with no local web server.
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openDatabase, createRepo } = require("./db/index.cjs");
const { createPrinter } = require("./print.cjs");

const DEV = process.argv.includes("--dev");
const DEV_URL = "http://localhost:3000";
const OUT_DIR = path.join(__dirname, "..", "out");

// The UI may call only these repository methods (see electron/db/index.cjs).
const DB_METHODS = new Set([
  "loadState", "seedDemo", "completeSetup", "upsertTable", "setPrinters", "saveOpenBill", "deleteOpenBill", "upsertMenuItem", "upsertCategory",
  "upsertStaff", "setTax", "setProfile", "payBill", "cancelBill", "verifyPin",
]);

const printer = createPrinter({ BrowserWindow });

let db = null;
let repo = null;

/** SSBILLS_DB overrides the location (used for testing); default is the per-user app data folder. */
function dbFile() {
  return process.env.SSBILLS_DB || path.join(app.getPath("userData"), "ssbills.db");
}

function isOurPage(frame) {
  const url = frame?.url ?? "";
  return DEV ? url.startsWith(DEV_URL) : url.startsWith("app://ssbills/");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** Map app://ssbills/<path> to a file inside out/, refusing anything outside it. */
function resolveFile(requestUrl) {
  let pathname = decodeURIComponent(new URL(requestUrl).pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  else if (!path.extname(pathname)) pathname += "/index.html";
  let file = path.normalize(path.join(OUT_DIR, pathname));
  if (!file.startsWith(OUT_DIR)) return null;
  if (!fs.existsSync(file)) file = segmentPrefetchFile(file) ?? file;
  return file;
}

/**
 * Next.js requests per-segment prefetch data as `__next.<seg>.<seg>.__PAGE__.txt`,
 * but the static export writes it as `__next.<seg>/<seg>/__PAGE__.txt`.
 */
function segmentPrefetchFile(file) {
  const base = path.basename(file);
  const m = /^__next\.(.+)\.txt$/.exec(base);
  if (!m) return null;
  const [first, ...rest] = m[1].split(".");
  if (rest.length === 0) return null;
  const mapped = path.join(path.dirname(file), `__next.${first}`, ...rest.slice(0, -1), `${rest[rest.length - 1]}.txt`);
  return mapped.startsWith(OUT_DIR) && fs.existsSync(mapped) ? mapped : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#faf9f6",
    title: "SS Bills",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Never open new windows inside the app; send external links to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(DEV ? DEV_URL : "app://ssbills/");
}

app.whenReady().then(() => {
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = openDatabase(file);
  repo = createRepo(db);

  ipcMain.handle("db", (event, name, arg) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    if (!DB_METHODS.has(name)) throw new Error(`Unknown database call: ${name}`);
    return repo[name](arg);
  });

  // Printing: listPrinters, printHtml (silent when a printer is named), savePdf (asks where to save).
  ipcMain.handle("print", async (event, name, arg) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    switch (name) {
      case "listPrinters":
        return printer.listPrinters(event.sender);
      case "printHtml":
        return printer.printHtml({ html: arg?.html, widthMm: arg?.widthMm, deviceName: arg?.deviceName || undefined });
      case "savePdf": {
        // The renderer never chooses the file path: the user does, in the system Save dialog.
        const pdf = await printer.htmlToPdf({ html: arg?.html, widthMm: arg?.widthMm });
        const safe = String(arg?.fileName || "receipt").replace(/[^\w.-]+/g, "-").slice(0, 80);
        const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
          defaultPath: path.join(app.getPath("documents"), `${safe}.pdf`),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (canceled || !filePath) return { cancelled: true };
        const target = filePath.toLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;
        fs.writeFileSync(target, pdf);
        return { filePath: target };
      }
      default:
        throw new Error(`Unknown print call: ${name}`);
    }
  });

  protocol.handle("app", (request) => {
    const file = resolveFile(request.url);
    if (!file || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  if (db) db.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
