// SS Bills desktop shell (TRD §2, D-013).
// Dev:  loads the Next.js dev server (npm run electron:dev).
// Prod: serves the static export in ../out through a private app:// protocol, so the
//       app works fully offline with no local web server.
const { app, BrowserWindow, dialog, ipcMain, protocol, net, session, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openDatabase, createRepo } = require("./db/index.cjs");
const { createPrinter } = require("./print.cjs");
const { createLicenseService } = require("./license.cjs");
const { createBackupService } = require("./backup.cjs");
const { createMachineId } = require("./machine-id.cjs");
const { createUpdates } = require("./updates.cjs");
const { MIGRATIONS } = require("./db/schema.cjs");
const licenseConfig = require("./license-config.json");

const DEV = process.argv.includes("--dev");
const DEV_URL = "http://localhost:3000";
const OUT_DIR = path.join(__dirname, "..", "out");

// The UI may call only these repository methods (see electron/db/index.cjs).
const DB_METHODS = new Set([
  "loadState", "seedDemo", "completeSetup", "upsertTable", "setPrinters", "saveOpenBill", "deleteOpenBill", "upsertMenuItem", "upsertCategory",
  "upsertStaff", "setTax", "setProfile", "payBill", "cancelBill", "verifyPin",
]);

// Calls that create or change a bill are refused while the licence is locked (TRD §7.4).
// History, reports, backup and settings stay available.
const BILLING_CALLS = new Set(["saveOpenBill", "payBill"]);

const printer = createPrinter({ BrowserWindow });

let db = null;
let repo = null;
let license = null;
let backups = null;
let updates = null;
let stopBackground = () => {};

/** SSBILLS_DB overrides the location (used for testing); default is the per-user app data folder. */
function dbFile() {
  return process.env.SSBILLS_DB || path.join(app.getPath("userData"), "ssbills.db");
}

/** Default backup folder: Documents\SS Bills Backups (or next to a test database). The user can pick another one. */
function defaultBackupDir() {
  if (process.env.SSBILLS_BACKUP_DIR) return process.env.SSBILLS_BACKUP_DIR;
  if (process.env.SSBILLS_DB) return path.join(path.dirname(process.env.SSBILLS_DB), "backups");
  return path.join(app.getPath("documents"), "SS Bills Backups");
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

  // The window can only ever show our own pages: no navigating away, no pop-ups (handled above).
  win.webContents.on("will-navigate", (event, url) => {
    if (!(DEV ? url.startsWith(DEV_URL) : url.startsWith("app://ssbills/"))) event.preventDefault();
  });

  win.loadURL(DEV ? DEV_URL : "app://ssbills/");
}

app.whenReady().then(() => {
  // The app needs no camera, microphone, location, notifications and so on: refuse every permission request.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const file = dbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    db = openDatabase(file);
  } catch (e) {
    // For example: the data was saved by a newer version of the app. Say so plainly instead of showing nothing.
    dialog.showErrorBox("SS Bills cannot open its data", `${e.message}

Your data has not been changed.`);
    app.exit(1);
    return;
  }
  repo = createRepo(db);

  const meta = { get: (k) => repo.getMeta(k), set: (k, v) => repo.setMeta(k, v) };
  license = createLicenseService({
    meta,
    summariesSince: (d) => repo.summariesSince(d),
    // The two overrides exist for development and tests only. An installed (packaged) app ignores them,
    // so setting an environment variable can never switch licensing off or point it at another server.
    config: { publicKey: licenseConfig.publicKey, apiUrl: (!app.isPackaged && process.env.SSBILLS_API_URL) || licenseConfig.apiUrl },
    machineId: createMachineId(meta),
    deviceName: () => require("node:os").hostname(),
    appVersion: app.getVersion(),
    enforce: app.isPackaged || process.env.SSBILLS_LICENSE !== "off",
  });
  backups = createBackupService({
    getDb: () => db,
    dir: () => meta.get("backup_dir") || defaultBackupDir(),
    userVersion: MIGRATIONS.length,
  });

  ipcMain.handle("db", (event, name, arg) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    if (!DB_METHODS.has(name)) throw new Error(`Unknown database call: ${name}`);
    if (BILLING_CALLS.has(name)) license.assertCanBill();
    return repo[name](arg);
  });

  // Updates: only for installed apps, and only when an update folder is configured (license-config.json "updateUrl").
  updates = createUpdates({
    enabled: app.isPackaged,
    feedUrl: licenseConfig.updateUrl || "",
    updater: app.isPackaged && licenseConfig.updateUrl ? require("electron-updater").autoUpdater : { on() {}, setFeedURL() {}, checkForUpdates: async () => {} },
  });
  ipcMain.handle("app", (event, name) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    if (name === "info") return { version: app.getVersion(), update: updates.getStatus() };
    throw new Error(`Unknown app call: ${name}`);
  });

  // Licence: status, activate with a key, sync now. The UI never sees the network.
  ipcMain.handle("license", async (event, name, arg) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    switch (name) {
      case "status":
        return license.getStatus();
      case "activate":
        return license.activate(arg?.key);
      case "syncNow": {
        const r = await license.syncNow();
        return { ...r, status: license.getStatus() };
      }
      default:
        throw new Error(`Unknown licence call: ${name}`);
    }
  });

  // Backup and restore. Folders and files are chosen in system dialogs; the UI only names listed backups.
  const backupStatus = () => ({
    dir: meta.get("backup_dir") || defaultBackupDir(),
    auto: meta.get("backup_auto") !== "0",
    backups: backups.list().slice(0, 50),
  });
  ipcMain.handle("backup", async (event, name, arg) => {
    if (!isOurPage(event.senderFrame)) throw new Error("Blocked: request did not come from the app");
    const win = BrowserWindow.fromWebContents(event.sender);
    switch (name) {
      case "status":
        return backupStatus();
      case "now":
        backups.backupNow("manual");
        return backupStatus();
      case "setAuto":
        meta.set("backup_auto", arg?.auto ? "1" : "0");
        return backupStatus();
      case "chooseFolder": {
        const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: "Choose a backup folder (a USB drive works too)", properties: ["openDirectory", "createDirectory"] });
        if (!canceled && filePaths[0]) meta.set("backup_dir", filePaths[0]);
        return backupStatus();
      }
      case "restore":
      case "restoreFromFile": {
        let source;
        if (name === "restore") {
          source = backups.resolveName(arg?.file);
          if (!source) throw new Error("That backup was not found");
        } else {
          const { canceled, filePaths } = await dialog.showOpenDialog(win, { title: "Choose a backup file", properties: ["openFile"], filters: [{ name: "SS Bills backup", extensions: ["db"] }] });
          if (canceled || !filePaths[0]) return { cancelled: true };
          source = filePaths[0];
        }
        const { savedAs } = backups.prepareRestore(source); // validates, and saves today's data first
        stopBackground();
        db.close();
        db = null;
        backups.swap(source, dbFile());
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 400);
        return { restarting: true, savedAs };
      }
      default:
        throw new Error(`Unknown backup call: ${name}`);
    }
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

  // Background work: licence sync, and an automatic backup once a day. Failures are logged, never shown mid-service.
  const stopLicense = license.start();
  const stopUpdates = updates.start();
  const autoBackup = () => {
    try {
      if (db && meta.get("backup_auto") !== "0") backups.autoIfDue();
    } catch (e) {
      console.error("Automatic backup failed:", e.message);
    }
  };
  setTimeout(autoBackup, 30_000).unref?.();
  const backupTimer = setInterval(autoBackup, 60 * 60_000);
  backupTimer.unref?.();
  stopBackground = () => {
    stopLicense();
    stopUpdates();
    clearInterval(backupTimer);
  };

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  stopBackground();
  if (db) db.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
