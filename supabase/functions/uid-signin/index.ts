import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://campusfind-uir0.onrender.com",
  "https://campusfind-fs6c.onrender.com",
  "http://localhost:5173",
  "http://localhost:8080",
]);
async function hashRateLimitKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  });
  if (origin && allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(body: Record<string, unknown>, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}


Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json({ ok: false, error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Request method not allowed." }, 405, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const acceptableKeys = [Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEY")].filter(Boolean);
  if (!url || !serviceKey || !anonKey || !req.headers.get("apikey") || !acceptableKeys.includes(req.headers.get("apikey"))) {
    return json({ ok: false, error: "Authentication service is temporarily unavailable. Please try again later." }, 503, origin);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    const keyHash = await hashRateLimitKey("uid-signin:" + ip);
    const { data: allowed, error: rateLimitError } = await admin.rpc("consume_edge_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: 60,
      p_max_requests: 12,
    });
    if (rateLimitError) {
      console.error("[UID auth] Rate-limit check failed", { code: rateLimitError.code });
      return json({ ok: false, error: "Authentication service is temporarily unavailable. Please try again later." }, 503, origin);
    }
    if (allowed !== true) {
      return json({ ok: false, error: "Too many attempts. Please wait a minute and try again." }, 429, origin);
    }
  } catch {
    return json({ ok: false, error: "Authentication service is temporarily unavailable. Please try again later." }, 503, origin);
  }

  let uid = "";
  let password = "";
  try {
    const body = await req.json();
    uid = String(body?.uid ?? "").trim().toUpperCase();
    password = String(body?.password ?? "");
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400, origin);
  }

  if (!/^[A-Z0-9]{5,20}$/.test(uid) || password.length === 0 || password.length > 128) {
    return json({ ok: false, error: "Incorrect UID or password." }, 401, origin);
  }

  // Resolve the submitted UID server-side to its Supabase Auth identity.
  // Credentials are still verified by Supabase Auth; the underlying phone/email
  // is never exposed to the browser.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("uid", uid)
    .maybeSingle();

  if (profileError) {
    console.error("[UID auth] Admin profile lookup failed", { code: profileError.code });
    return json({ ok: false, error: "Login is temporarily unavailable. Please try again later." }, 500, origin);
  }

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let identifier: { email: string } | { phone: string } | null = null;
  if (profile) {
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError) {
      console.error("[UID auth] Auth-user lookup failed", { status: userError.status });
      return json({ ok: false, error: "Login is temporarily unavailable. Please try again later." }, 500, origin);
    }
    if (userData.user?.email) {
      identifier = { email: userData.user.email };
    } else if (userData.user?.phone) {
      identifier = { phone: userData.user.phone };
    }
  }

  if (!identifier) return json({ ok: false, error: "Incorrect UID or password." }, 401, origin);

  const { data, error } = await publicClient.auth.signInWithPassword({ ...identifier, password });
  if (error || !data.session) return json({ ok: false, error: "Incorrect UID or password." }, 401, origin);

  return json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }, 200, origin);
});
