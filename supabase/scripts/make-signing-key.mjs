// Creates the Ed25519 key pair that signs license answers (docs/TRD.md §7.3).
//   node supabase/scripts/make-signing-key.mjs
// - the PRIVATE key goes to supabase/.secrets/license-signing.key (git-ignored). Give it to Supabase once:
//     supabase secrets set LICENSE_SIGNING_KEY="$(cat supabase/.secrets/license-signing.key)"
//   (or paste it as a secret named LICENSE_SIGNING_KEY in Dashboard > Edge Functions > Secrets).
// - the PUBLIC key is written into app/electron/license-config.json, which ships inside the app.
// Refuses to overwrite an existing key: replacing it would make every installed app reject the server.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const keyFile = path.resolve(here, "../.secrets/license-signing.key");
const configFile = path.resolve(here, "../../app/electron/license-config.json");

if (fs.existsSync(keyFile)) {
  console.error(`A signing key already exists at ${keyFile}. Delete it yourself only if you really want to replace it\n(every installed app would then have to be updated).`);
  process.exit(1);
}
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
fs.mkdirSync(path.dirname(keyFile), { recursive: true });
fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") + "\n", { mode: 0o600 });

const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
config.publicKey = publicKey.export({ type: "spki", format: "der" }).toString("base64");
fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n");
console.log(`Private key saved to ${keyFile} (keep it secret, never commit it).\nPublic key written to ${configFile}.`);
