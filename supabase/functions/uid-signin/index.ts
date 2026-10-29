import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://campusfind-uir0.onrender.com",
  "https://campusfind-fs6c.onrender.com",
  "http://localhost:5173",
  "http://localhost:8080",
]);
const attempts = new Map<string, { count: number; start: number }>();

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

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const prior = attempts.get(ip);
  if (!prior || now - prior.start > 60_000) attempts.set(ip, { count: 1, start: now });
  else {
    prior.count += 1;
    if (prior.count > 12) return true;
  }

  // Keep this best-effort in-memory bucket bounded across warm function instances.
  if (attempts.size > 5000) {
    for (const [key, value] of attempts) {
      if (now - value.start > 60_000) attempts.delete(key);
      if (attempts.size <= 4000) break;
    }
  }
  return false;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json({ ok: false, error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "Request method not allowed." }, 405, origin);

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (tooManyAttempts(ip)) return json({ ok: false, error: "Too many attempts. Please wait a minute and try again." }, 429, origin);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const acceptableKeys = [Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEY")].filter(Boolean);
  if (!url || !serviceKey || !anonKey || !req.headers.get("apikey") || !acceptableKeys.includes(req.headers.get("apikey"))) {
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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // This function is for the separate admin portal only. A known student's UID
  // must never turn this into an alternate password-login endpoint for student accounts.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("uid", uid)
    .eq("role", "admin")
    .maybeSingle();

  if (profileError) {
    console.error("[UID auth] Admin profile lookup failed", { code: profileError.code });
    return json({ ok: false, error: "Login is temporarily unavailable. Please try again later." }, 500, origin);
  }

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let email = "invalid-campusfind-login@cuchd.in";
  if (profile) {
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError) {
      console.error("[UID auth] Admin auth-user lookup failed", { status: userError.status });
      return json({ ok: false, error: "Login is temporarily unavailable. Please try again later." }, 500, origin);
    }
    if (userData.user?.email) email = userData.user.email;
  }

  const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) return json({ ok: false, error: "Incorrect UID or password." }, 401, origin);

  return json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  }, 200, origin);
});
