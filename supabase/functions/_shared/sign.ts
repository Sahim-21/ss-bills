// Ed25519 signing with Web Crypto (available in Deno and Node). The private key is a Supabase secret
// named LICENSE_SIGNING_KEY: base64 of the PKCS#8 private key. The matching public key is built into the
// restaurant app (app/electron/license-config.json). Generate the pair with `node supabase/scripts/make-signing-key.mjs`.

const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

export async function makeSigner(privateKeyB64: string): Promise<(payload: string) => Promise<string>> {
  const key = await crypto.subtle.importKey("pkcs8", b64decode(privateKeyB64), { name: "Ed25519" }, false, ["sign"]);
  return async (payload) => b64encode(await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload)));
}
