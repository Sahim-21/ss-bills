import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createUpdates } = require("./updates.cjs");

/** A stand-in for electron-updater's autoUpdater. */
function fakeUpdater(onCheck?: (u: EventEmitter) => void | Promise<void>) {
  const u = Object.assign(new EventEmitter(), {
    autoDownload: false, autoInstallOnAppQuit: false, autoRunAppAfterInstall: false, allowDowngrade: true,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      await onCheck?.(u);
    }),
  });
  return u;
}

describe("updates", () => {
  it("is switched off when running from source or when no update folder is configured", () => {
    expect(createUpdates({ updater: fakeUpdater(), feedUrl: "https://x/", enabled: false }).getStatus().state).toBe("disabled");
    expect(createUpdates({ updater: fakeUpdater(), feedUrl: "", enabled: true }).getStatus().state).toBe("disabled");
    const u = fakeUpdater();
    const stop = createUpdates({ updater: u, feedUrl: "", enabled: true }).start();
    stop();
    expect(u.setFeedURL).not.toHaveBeenCalled();
  });

  it("downloads in the background and installs only when the app is closed", () => {
    const u = fakeUpdater();
    const stop = createUpdates({ updater: u, feedUrl: "https://updates.example.com/ss-bills/", enabled: true }).start();
    stop();
    expect(u.autoDownload).toBe(true);
    expect(u.autoInstallOnAppQuit).toBe(true); // never restarts the app by itself
    expect(u.allowDowngrade).toBe(false);
    expect(u.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: "https://updates.example.com/ss-bills/" });
  });

  it("follows a normal update: checking, downloading, ready", async () => {
    const u = fakeUpdater(async (e) => {
      e.emit("checking-for-update");
      e.emit("update-available", { version: "0.2.0" });
      e.emit("update-downloaded", { version: "0.2.0" });
    });
    const up = createUpdates({ updater: u, feedUrl: "https://x/", enabled: true });
    up.start()();
    await up.check();
    expect(up.getStatus()).toMatchObject({ state: "ready", version: "0.2.0" });
    await up.check(); // already ready: does not check again
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("goes back to idle when there is no update", async () => {
    const up = createUpdates({ updater: fakeUpdater((e) => void e.emit("update-not-available")), feedUrl: "https://x/", enabled: true });
    up.start()();
    await up.check();
    expect(up.getStatus()).toMatchObject({ state: "idle", version: null });
    expect(up.getStatus().checkedAt).toBeTruthy();
  });

  it("swallows failures (offline, folder missing) and tries again later", async () => {
    const u = fakeUpdater(() => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    });
    const up = createUpdates({ updater: u, feedUrl: "https://x/", enabled: true });
    up.start()();
    await expect(up.check()).resolves.toBeUndefined();
    expect(up.getStatus()).toMatchObject({ state: "error", message: expect.stringContaining("ERR_INTERNET") });
    await up.check(); // an error does not stop later checks
    expect(u.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("reports an error event from the updater without throwing", () => {
    const u = fakeUpdater();
    const up = createUpdates({ updater: u, feedUrl: "https://x/", enabled: true });
    up.start()();
    u.emit("error", new Error("signature mismatch"));
    expect(up.getStatus()).toMatchObject({ state: "error", message: "signature mismatch" });
  });
});
