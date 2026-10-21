// A stable identifier for this PC, used to bind a licence to a terminal (docs/TRD.md §7.3).
// Windows: the OS machine GUID, hashed with an app-specific prefix so the raw GUID is never sent anywhere.
// Elsewhere (development) or if the lookup fails: a random id remembered in the database.
// This deters casual copying of a licence; it is not tamper-proof (see TRD §7.6).
const crypto = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

function osMachineGuid() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      return /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? null;
    }
    for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
      if (fs.existsSync(f)) return fs.readFileSync(f, "utf8").trim() || null;
    }
  } catch {
    /* fall through to the stored random id */
  }
  return null;
}

/** @param meta { get(key), set(key, value) } where the fallback id is remembered */
function createMachineId(meta) {
  let cached = null;
  return () => {
    if (cached) return cached;
    const guid = osMachineGuid();
    if (guid) {
      cached = "PC-" + crypto.createHash("sha256").update(`ssbills:${guid}`).digest("hex").slice(0, 24).toUpperCase();
    } else {
      let id = meta.get("machine_fallback");
      if (!id) {
        id = "PC-" + crypto.randomBytes(12).toString("hex").toUpperCase();
        meta.set("machine_fallback", id);
      }
      cached = id;
    }
    return cached;
  };
}

module.exports = { createMachineId };
