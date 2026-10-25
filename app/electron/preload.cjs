// Bridge between the UI and the database in the main process.
// The UI can only call the named repository methods allowed by main.cjs; it never touches
// Node, the file system, or SQL directly.
const { contextBridge, ipcRenderer } = require("electron");

const clean = (e) =>
  // Electron wraps errors as "Error invoking remote method 'db': Error: <message>"
  new Error(String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[a-z]+': (Error: )?/, ""));

contextBridge.exposeInMainWorld("ssbills", {
  isDesktop: true,
  /** print("printHtml", { html, widthMm, deviceName }) etc. See electron/print.cjs. */
  print: (name, arg) =>
    ipcRenderer.invoke("print", name, arg).catch((e) => {
      throw clean(e);
    }),
  /** app("info") -> { version, update: { state, version, message } }. See electron/updates.cjs. */
  app: (name) =>
    ipcRenderer.invoke("app", name).catch((e) => {
      throw clean(e);
    }),
  /** menu("findCloudCopy" | "restoreCloudCopy" | "cloudStatus" | "cloudSaveNow" | "exportCsv" | "importCsvPreview" | "importCsvApply", arg). See electron/menu-service.cjs. */
  menu: (name, arg) =>
    ipcRenderer.invoke("menu", name, arg).catch((e) => {
      throw clean(e);
    }),
  /** license("status" | "activate" | "syncNow", arg). See electron/license.cjs. */
  license: (name, arg) =>
    ipcRenderer.invoke("license", name, arg).catch((e) => {
      throw clean(e);
    }),
  /** backup("status" | "now" | "setAuto" | "chooseFolder" | "restore" | "restoreFromFile", arg). See electron/backup.cjs. */
  backup: (name, arg) =>
    ipcRenderer.invoke("backup", name, arg).catch((e) => {
      throw clean(e);
    }),
  /** call("payBill", payload) -> result. Rejects with the database's error message. */
  call: (name, arg) =>
    ipcRenderer.invoke("db", name, arg).catch((e) => {
      throw clean(e);
    }),
});
