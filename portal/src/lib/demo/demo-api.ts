// Browser demo: the real database code (supabase/migrations) running inside the page via PGlite, with
// demo data. Used when no Supabase project is configured, so the portal can be explored, shown and
// developed against the exact same rules as production. Data is kept in the browser (IndexedDB).
import type { PGlite } from "@electric-sql/pglite";
import { createApi, type PortalAuth, type RpcFn } from "../api";
import type { Me } from "../types";
import { MIGRATIONS } from "./migrations.generated";
import { DEMO_CODE, DEMO_EMAIL, SEED, STUBS } from "./seed";

export { DEMO_CODE, DEMO_EMAIL };

/** Small key-value store for the signed-in demo user (sessionStorage in the browser). */
export interface SessionStore {
  get(): string | null;
  set(uid: string | null): void;
}

const browserSession: SessionStore = {
  get: () => {
    try {
      return sessionStorage.getItem("ssbills-demo-uid");
    } catch {
      return null;
    }
  },
  set: (uid) => {
    try {
      if (uid) sessionStorage.setItem("ssbills-demo-uid", uid);
      else sessionStorage.removeItem("ssbills-demo-uid");
    } catch {
      /* private mode: the demo user simply has to sign in again after a reload */
    }
  },
};

/** Changes whenever the migrations or seed change, so an old browser copy is never reused. */
function fingerprint(): string {
  let h = 5381;
  for (const s of [...MIGRATIONS, SEED]) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function initDemoDb(db: PGlite) {
  await db.transaction(async (tx) => {
    await tx.exec(STUBS);
    for (const m of MIGRATIONS) await tx.exec(m);
    await tx.exec(SEED);
  });
}

async function isInitialised(db: PGlite) {
  const r = await db.query<{ t: string | null }>("select to_regclass('public.restaurants')::text as t");
  return r.rows[0].t !== null;
}

/** Wipe everything and rebuild the demo data. */
export async function resetDemoDb(db: PGlite) {
  await db.exec(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema public;
    drop owned by anon, authenticated, service_role;
    drop role anon, authenticated, service_role;
  `);
  await initDemoDb(db);
}

const NAME = /^[a-z_]+$/;
const ARG = /^p(_[a-z_]+)?$/;

export function buildDemoApi(db: PGlite, session: SessionStore = browserSession) {
  // PGlite is one connection, so requests take turns. Each runs as the signed-in demo user, like a Supabase request.
  let chain: Promise<unknown> = Promise.resolve();
  const turn = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  const rpc: RpcFn = (name, args = {}) =>
    turn(async () => {
      if (!NAME.test(name)) throw new Error("Bad function name");
      const keys = Object.keys(args);
      if (!keys.every((k) => ARG.test(k))) throw new Error("Bad argument name");
      const values: unknown[] = [];
      const parts = keys.map((k, i) => {
        const v = args[k];
        const isObject = v !== null && typeof v === "object";
        values.push(isObject ? JSON.stringify(v) : (v ?? null));
        return `${k} => $${i + 1}${isObject ? "::jsonb" : ""}`;
      });
      const uid = session.get();
      const claims = JSON.stringify({ sub: uid ?? "", aal: "aal2" });
      await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [uid ?? "", claims]);
      await db.exec(uid ? "set role authenticated" : "set role anon");
      try {
        const r = await db.query<{ r: unknown }>(`select public.${name}(${parts.join(", ")}) as r`, values);
        return r.rows[0]?.r ?? null;
      } finally {
        await db.exec("reset role");
      }
    });

  let pending: string | null = null; // password accepted, waiting for the code

  const auth: PortalAuth = {
    async signIn(email, password) {
      const r = await turn(() => db.query<{ id: string }>("select id from auth.users where lower(email) = lower($1)", [email.trim()]));
      if (!r.rows[0] || !password) throw new Error("Wrong email or password");
      pending = r.rows[0].id;
      return { next: "mfa" };
    },
    async verifyMfa(code) {
      if (!pending) throw new Error("Sign in again");
      if (code.replace(/\s/g, "") !== DEMO_CODE) throw new Error("That code is not right. In the demo it is " + DEMO_CODE);
      session.set(pending);
      pending = null;
    },
    async signOut() {
      pending = null;
      session.set(null);
    },
    async me() {
      if (!session.get()) return null;
      return (await rpc("vendor_me")) as Me | null;
    },
  };

  return { api: createApi(rpc, auth, "demo"), reset: () => turn(() => resetDemoDb(db)) };
}

/** Open (or create) the demo database in the browser and return the API. */
export async function createDemoApi() {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(`idb://ssbills-console-demo-${fingerprint()}`);
  await db.waitReady;
  if (!(await isInitialised(db))) await initDemoDb(db);
  return buildDemoApi(db);
}
