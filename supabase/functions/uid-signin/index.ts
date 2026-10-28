import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const attempts = new Map<string, { count: number; start: number }>();
function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const old = attempts.get(ip);
  if (!old || now - old.start > 60_000) {
    attempts.set(ip, { count: 1, start: now });
    return false;
  }
  old.count += 1;
  return old.count > 12;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Request method not allowed." }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (tooManyAttempts(ip)) return json({ ok: false, error: "Too many attempts. Please wait a minute and try again." }, 429);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !serviceKey || !anonKey || !req.headers.get("apikey")) {
    return json({ ok: false, error: "Authentication service is temporarily unavailable. Please try again later." }, 500);
  }

  let uid = "";
  let password = "";
  try {
    const body = await req.json();
    uid = String(body?.uid ?? "").trim().toUpperCase();
    password = String(body?.password ?? "");
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  if (!/^[A-Z0-9]{5,20}$/.test(uid)) {
    return json({ ok: false, error: "Incorrect UID or password." }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .eq("uid", uid)
    .maybeSingle();

  if (profileError) {
    console.error("[UID auth] Profile lookup failed", { code: profileError.code });
    return json({
      ok: false,
      error: "Login is temporarily unavailable. Please try again later.",
    }, 500);
  }

  if (password.length === 0 || password.length > 128) {
    return json({ ok: false, error: "Incorrect UID or password." }, 400);
  }

  const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let email = "invalid-campusfind-login@cuchd.in";

  if (profile) {
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError) {
      console.error("[UID auth] Auth user lookup failed", { status: userError.status });
      return json({ ok: false, error: "Login is temporarily unavailable. Please try again later." }, 500);
    }
    if (userData.user?.email) email = userData.user.email;
  }

  const { data, error } = await publicClient.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return json({ ok: false, error: "Incorrect UID or password." }, 401);
  }

  return json({
    ok: true,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});
