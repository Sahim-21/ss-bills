import { createClient } from "@supabase/supabase-js";
import { createApi, type AuthStep, type PortalAuth, type RpcFn } from "./api";
import type { Me } from "./types";

/**
 * Real backend. Sign-in is email + password, then a 6-digit code from an authenticator app (TOTP).
 * The first time, the person links their app by scanning a QR code. The database refuses every vendor
 * function unless the session passed that second step (see mfa_ok in the core migration).
 */
export function createSupabaseApi(url: string, anonKey: string) {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });

  const rpc: RpcFn = async (name, args) => {
    const { data, error } = await sb.rpc(name, args ?? {});
    if (error) throw new Error(error.message);
    return data;
  };

  /** What still stands between this password login and a fully signed-in session. */
  async function nextStep(): Promise<AuthStep> {
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw new Error(error.message);
    if (aal.currentLevel === "aal2") return { next: "done" };
    if (aal.nextLevel === "aal2") return { next: "mfa" }; // a verified authenticator app is already linked

    // Nothing linked yet: remove any half-finished attempt, then start a fresh enrollment.
    const { data: factors } = await sb.auth.mfa.listFactors();
    for (const f of factors?.all ?? []) {
      if (f.factor_type === "totp" && f.status === "unverified") await sb.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error: enrollError } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "SS Bills Console" });
    if (enrollError || !data) throw new Error(enrollError?.message ?? "Could not start two-factor setup");
    return { next: "enroll", qr: data.totp.qr_code, secret: data.totp.secret, factorId: data.id };
  }

  const auth: PortalAuth = {
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password" : error.message);
      return nextStep();
    },

    async verifyMfa(code, factorId) {
      let id = factorId;
      if (!id) {
        const { data } = await sb.auth.mfa.listFactors();
        id = data?.totp?.[0]?.id;
      }
      if (!id) throw new Error("No authenticator app is linked to this account");
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code: code.replace(/\s/g, "") });
      if (error) throw new Error(/invalid/i.test(error.message) ? "That code is not right. Try the newest one" : error.message);
    },

    async signOut() {
      await sb.auth.signOut();
    },

    async me() {
      const { data } = await sb.auth.getSession();
      if (!data.session) return null;
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== "aal2") return null; // password only: not signed in yet
      const { data: me, error } = await sb.rpc("vendor_me");
      if (error) return null;
      return (me as Me | null) ?? null;
    },
  };

  return createApi(rpc, auth, "supabase");
}
