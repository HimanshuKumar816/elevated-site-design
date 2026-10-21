import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

// Signs a student in with their university UID + password.
// The UID -> email lookup happens only on the server, so emails are never exposed.
export const signInWithUid = createServerFn({ method: "POST" })
  .inputValidator((input: { uid: string; password: string }) => {
    const uid = String(input.uid ?? "").trim().toUpperCase();
    const password = String(input.password ?? "");
    if (!uid || uid.length > 32 || !password || password.length > 128) throw new Error("Invalid input");
    return { uid, password };
  })
  .handler(async ({ data }) => {
    const fail = { ok: false as const, error: "Incorrect UID or password." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin.from("profiles").select("id").eq("uid", data.uid).maybeSingle();
    if (!profile) return fail;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(profile.id);
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
