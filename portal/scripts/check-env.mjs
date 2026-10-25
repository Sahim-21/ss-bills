// Stops a production build that would silently ship the browser demo or a dangerous key.
// Runs before `next build`. On Cloudflare Pages (CF_PAGES=1) or with PORTAL_REQUIRE_LIVE=1 the Supabase values are mandatory.
// A local `npm run build` without them still works (demo build) so tests and previews keep working.
// Next reads .env.local itself; plain node does not, so mirror that for local builds.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file absent */
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const strict = process.env.CF_PAGES === "1" || process.env.PORTAL_REQUIRE_LIVE === "1";
const fail = (msg) => {
  console.error(`\nBUILD STOPPED: ${msg}\n`);
  process.exit(1);
};

if (key) {
  // A legacy Supabase key is a JWT whose payload names its role. The browser may only ever hold "anon".
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const role = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role;
      if (role && role !== "anon") fail(`NEXT_PUBLIC_SUPABASE_ANON_KEY holds a "${role}" key. Only the anon/publishable key may go in the browser app.`);
    } catch {
      /* not a readable JWT: fall through to the prefix check */
    }
  }
  if (/^sb_secret_/i.test(key)) fail("NEXT_PUBLIC_SUPABASE_ANON_KEY holds a secret key. Use the publishable (anon) key.");
}
if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  fail("NEXT_PUBLIC_SUPABASE_URL must be the project root like https://<ref>.supabase.co (no /rest/v1/ and no trailing path).");
}
if (strict && !(url && key)) {
  fail("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set for a hosted build. Without them the site would be the browser DEMO.");
}
console.log(strict ? "Hosted build: live Supabase values present and safe." : url && key ? "Build: live mode." : "Build: DEMO mode (no Supabase values).");
