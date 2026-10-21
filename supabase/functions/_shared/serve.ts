// Shared Deno wiring for the two functions: reads the request, builds the Supabase client with the
// service role (a secret that exists only inside Supabase), and turns a Reply into a Response.
import { createClient } from "npm:@supabase/supabase-js@2";
import { MAX_BODY_BYTES, parseJsonBody, type Deps, type Reply } from "./handler.ts";
import { makeSigner } from "./sign.ts";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

let deps: Deps | null = null;

async function getDeps(): Promise<Deps> {
  if (deps) return deps;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const signingKey = Deno.env.get("LICENSE_SIGNING_KEY");
  if (!url || !serviceKey || !signingKey) throw new Error("Function is not configured (missing secrets)");
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  deps = {
    rpc: async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    },
    sign: await makeSigner(signingKey),
  };
  return deps;
}

export function serve(handle: (body: unknown, ip: string, deps: Deps) => Promise<Reply>) {
  Deno.serve(async (req) => {
    if (req.method !== "POST") return json(405, { ok: false, code: "bad_request", message: "Use POST" });
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > MAX_BODY_BYTES) return json(413, { ok: false, code: "bad_request", message: "Request too large" });
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return json(400, { ok: false, code: "bad_request", message: "The request body could not be read" });
    }
    const parsed = parseJsonBody(raw);
    if (!parsed.ok) return json(parsed.reply.status, parsed.reply.body);
    const body = parsed.body;
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 64);
    try {
      const reply = await handle(body, ip, await getDeps());
      return json(reply.status, reply.body);
    } catch (e) {
      console.error(e);
      return json(500, { ok: false, code: "server_error", message: "Something went wrong on our side. Please try again later" });
    }
  });
}
