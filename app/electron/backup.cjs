// Backup and restore of the local database (docs/TRD.md §8).
// - A backup is a consistent snapshot made with SQLite's VACUUM INTO, so it is safe while the app is running.
// - Restore checks the file first, saves the CURRENT data as a "pre-restore" backup, then swaps the file.
// The UI never supplies a path: folders and files are chosen in system dialogs opened by main.cjs, and
// backups are referred to by file name only (checked against a strict pattern).
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const NAME_RE = /^ssbills_[0-9A-Za-z_-]{1,60}\.db$/;
const KEEP_AUTO = 30;
const DAY_MS = 86_400_000;

const pad = (n) => String(n).padStart(2, "0");
/** Local date and time as 2026-10-21_234500 (file names sort by time). */
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * @param o.getDb      () => the open DatabaseSync
 * @param o.dir        () => the backup folder
 * @param o.userVersion  the schema version this build understands (a newer backup is refused)
 */
function createBackupService(o) {
  const now = o.now ?? (() => new Date());

  function ensureDir() {
    fs.mkdirSync(o.dir(), { recursive: true });
    return o.dir();
  }

  function snapshot(kind) {
    const dir = ensureDir();
    const base = path.join(dir, `ssbills_${stamp(now())}${kind === "auto" ? "_auto" : kind === "pre-restore" ? "_pre-restore" : ""}`);
    let file = `${base}.db`;
    for (let i = 2; fs.existsSync(file); i++) file = `${base}_${i}.db`; // two backups in one second
    o.getDb().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    return path.basename(file);
  }

  /** Files in the backup folder that look like ours, newest first. */
  function list() {
    const dir = o.dir();
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => NAME_RE.test(f))
      .map((file) => {
        const st = fs.statSync(path.join(dir, file));
        return { file, at: st.mtimeMs, sizeBytes: st.size, kind: file.includes("_auto") ? "auto" : file.includes("_pre-restore") ? "pre-restore" : "manual" };
      })
      .sort((a, b) => b.at - a.at);
  }

  /** Keep the newest KEEP_AUTO automatic backups; manual and pre-restore copies are never deleted. */
  function prune() {
    for (const f of list().filter((b) => b.kind === "auto").slice(KEEP_AUTO)) fs.rmSync(path.join(o.dir(), f.file), { force: true });
  }

  function backupNow(kind = "manual") {
    const file = snapshot(kind);
    if (kind === "auto") prune();
    return file;
  }

  /** An automatic backup when the newest one is more than a day old. Returns the file name, or null. */
  function autoIfDue() {
    const last = list().find((b) => b.kind === "auto");
    if (last && now().getTime() - last.at < DAY_MS) return null;
    return backupNow("auto");
  }

  /** Is this file a usable SS Bills database that this version can read? Returns { ok } or { ok:false, error }. */
  function validate(file) {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const check = db.prepare("PRAGMA integrity_check").all();
      if (check.length !== 1 || check[0].integrity_check !== "ok") return { ok: false, error: "The file is damaged" };
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
      for (const t of ["restaurant_profile", "bills", "users", "menu_items", "bill_counters"]) {
        if (!tables.has(t)) return { ok: false, error: "This is not an SS Bills backup" };
      }
      const version = db.prepare("PRAGMA user_version").get().user_version;
      if (version > o.userVersion) return { ok: false, error: "This backup was made by a newer version of SS Bills. Update the app first" };
      return { ok: true };
    } catch {
      return { ok: false, error: "This is not an SS Bills backup" };
    } finally {
      db?.close();
    }
  }

  /**
   * Replace the live database file with `source` (already chosen by the user). The caller must close the
   * database before calling `swap` and restart the app afterwards (main.cjs does both).
   * Step 1 (`prepare`): validate and save the current data. Step 2 (`swap`): copy over the live file.
   */
  function prepareRestore(source) {
    const v = validate(source);
    if (!v.ok) throw new Error(v.error);
    return { savedAs: snapshot("pre-restore") };
  }

  function swap(source, liveFile) {
    // Copy to a temporary name first, so a failure half-way never leaves a broken live file.
    const tmp = `${liveFile}.restoring`;
    fs.copyFileSync(source, tmp);
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(liveFile + suffix, { force: true });
    fs.renameSync(tmp, liveFile);
  }

  /** Path of a listed backup by name, or null (the name must match our pattern and exist in the folder). */
  function resolveName(file) {
    if (typeof file !== "string" || !NAME_RE.test(file)) return null;
    const full = path.join(o.dir(), file);
    return fs.existsSync(full) ? full : null;
  }

  return { backupNow, autoIfDue, list, validate, prepareRestore, swap, resolveName };
}

module.exports = { createBackupService, NAME_RE };
