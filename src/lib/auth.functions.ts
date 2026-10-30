import { createServerFn } from "@tanstack/react-start";
import { isValidUid, normalizeUid } from "@/lib/uid";

// UID-to-email lookup and password verification run inside the Supabase Edge Function.
// The service-role credential never needs to be present in the local web-server environment.
export const signInWithUid = createServerFn({ method: "POST" })
  .validator((input: { uid: string; password: string }) => {
    const uid = normalizeUid(input.uid);
    const password = String(input.password ?? "");
    if (!isValidUid(uid) || !password || password.length > 128) throw new Error("Invalid input");
    return { uid, password };
  })
  .handler(async ({ data }) => {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) {
      console.error("[UID auth] Supabase server configuration is incomplete");
      return { ok: false as const, error: "Login is temporarily unavailable. Please try again later." };
    }

    try {
      const response = await fetch(`${new URL(url).origin}/functions/v1/uid-signin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
        },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok || !result?.ok || !result.access_token || !result.refresh_token) {
        if (response.status >= 500) {
          return { ok: false as const, error: "Login is temporarily unavailable. Please try again later." };
        }
        return { ok: false as const, error: result?.error || "Incorrect UID or password." };
      }
      return {
        ok: true as const,
        access_token: String(result.access_token),
        refresh_token: String(result.refresh_token),
      };
    } catch {
      return { ok: false as const, error: "Login is temporarily unavailable. Please try again later." };
    }
  });
