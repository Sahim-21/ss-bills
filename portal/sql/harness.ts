// Runs the real Supabase migrations in an in-process Postgres (PGlite) so the database rules can be
// tested without a Supabase project. Supabase pieces the migrations rely on are stubbed:
// the roles (anon / authenticated / service_role), auth.users, and auth.uid().
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

const STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema public to anon, authenticated, service_role;
`;

/** `aal` is the login strength: "aal2" = passed two-factor (the default here), "aal1" = password only. */
export type Who = { role: "anon" | "authenticated" | "service_role"; uid?: string; aal?: "aal1" | "aal2" } | "owner";

export async function freshDb() {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  return db;
}

/** Run `fn` as a given database role/user, the way a Supabase request would. */
export async function as<T>(db: PGlite, who: Who, fn: () => Promise<T>): Promise<T> {
  if (who === "owner") return fn();
  const claims = JSON.stringify({ sub: who.uid ?? "", aal: who.aal ?? "aal2" });
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${who.uid ?? ""}', false), set_config('request.jwt.claims', '${claims}', false); set role ${who.role};`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false);");
  }
}

export async function rpc<T = unknown>(db: PGlite, who: Who, sql: string, params: unknown[] = []): Promise<T> {
  return as(db, who, async () => {
    const r = await db.query<{ r: T }>(`select ${sql} as r`, params);
    return r.rows[0].r;
  });
}

export async function addUser(db: PGlite, email: string, role?: "super_admin" | "support", name = email.split("@")[0]) {
  const u = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = u.rows[0].id;
  if (role) await db.query("insert into public.vendor_admins (user_id, name, role) values ($1, $2, $3)", [id, name, role]);
  return id;
}
