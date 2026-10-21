// Automatic updates (docs/TRD.md §10). The app checks a plain web folder for a newer installer, downloads it quietly in
// the background, and installs it the NEXT time the app is closed. It never restarts the app while someone is billing.
// Every failure (no internet, folder unreachable) is swallowed and retried later: billing must never be affected.
const SIX_HOURS = 6 * 3600_000;

/**
 * @param o.updater  an electron-updater `autoUpdater` (injectable for tests)
 * @param o.feedUrl  the web folder holding latest.yml and the installers; empty = updates switched off
 * @param o.enabled  false when running from source (development): updates are only for installed apps
 */
function createUpdates(o) {
  const state = { state: o.enabled && o.feedUrl ? "idle" : "disabled", version: null, message: null, checkedAt: null };
  const { updater } = o;

  function wire() {
    updater.autoDownload = true; // fetch in the background...
    updater.autoInstallOnAppQuit = true; // ...and install only when the app is closed
    updater.autoRunAppAfterInstall = true;
    updater.allowDowngrade = false;
    updater.setFeedURL({ provider: "generic", url: o.feedUrl });
    updater.on("checking-for-update", () => Object.assign(state, { state: "checking", message: null }));
    updater.on("update-available", (info) => Object.assign(state, { state: "downloading", version: info?.version ?? null }));
    updater.on("update-not-available", () => Object.assign(state, { state: "idle", version: null }));
    updater.on("update-downloaded", (info) => Object.assign(state, { state: "ready", version: info?.version ?? state.version }));
    updater.on("error", (e) => Object.assign(state, { state: "error", message: String(e?.message ?? e).slice(0, 200) }));
  }

  async function check() {
    if (state.state === "disabled" || state.state === "ready" || state.state === "downloading") return;
    state.checkedAt = new Date().toISOString();
    try {
      await updater.checkForUpdates();
    } catch (e) {
      Object.assign(state, { state: "error", message: String(e?.message ?? e).slice(0, 200) });
    }
  }

  /** Check a minute after start, then every 6 hours. Returns a function that stops the timers. */
  function start() {
    if (state.state === "disabled") return () => {};
    wire();
    const first = setTimeout(() => void check(), 60_000);
    const every = setInterval(() => void check(), SIX_HOURS);
    first.unref?.();
    every.unref?.();
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }

  return { start, check, getStatus: () => ({ ...state }) };
}

module.exports = { createUpdates };
