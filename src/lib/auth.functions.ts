import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { isValidUid, normalizeUid } from "@/lib/uid";

// Signs a student in with their university UID + password.
// The UID -> email lookup happens only on the server, so emails are never exposed.
export const signInWithUid = createServerFn({ method: "POST" })
  .inputValidator((input: { uid: string; password: string }) => {
    const uid = normalizeUid(input.uid);
    const password = String(input.password ?? "");
    if (!isValidUid(uid) || !password || password.length > 128) throw new Error("Invalid input");
    return { uid, password };
  })
  .handler(async ({ data }) => {
    const fail = { ok: false as const, error: "Incorrect UID or password." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile, error: profileLookupError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("uid", data.uid)
      .maybeSingle();

    if (profileLookupError) {
      // Keep diagnostics useful without logging the UID, email, or credentials.
      console.error("[UID auth] Profile lookup failed", { code: profileLookupError.code });
      return { ok: false as const, error: "Login is temporarily unavailable. Please try again later." };
    }
    if (!profile) return fail;

    const { data: u, error: userLookupError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    if (userLookupError) {
      console.error("[UID auth] Auth user lookup failed", { status: userLookupError.status });
      return { ok: false as const, error: "Login is temporarily unavailable. Please try again later." };
    }
    const email = u.user?.email;
    if (!email) return fail;

    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const client = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: s, error } = await client.auth.signInWithPassword({ email, password: data.password });
    if (error || !s.session) {
      if (error?.message.toLowerCase().includes("confirm")) return { ok: false as const, error: "Please confirm your email first — check your CU inbox." };
      return fail;
    }
    return { ok: true as const, access_token: s.session.access_token, refresh_token: s.session.refresh_token };
  });
