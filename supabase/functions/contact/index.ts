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
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(body: Record<string, unknown>, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function isOriginAllowed(origin: string | null): boolean {
  return !origin || allowedOrigins.has(origin);
}

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const prior = attempts.get(ip);
  if (!prior || now - prior.start > 10 * 60_000) {
    attempts.set(ip, { count: 1, start: now });
  } else {
    prior.count += 1;
    if (prior.count > 5) return true;
  }

  if (attempts.size > 5000) {
    for (const [key, value] of attempts) {
      if (now - value.start > 10 * 60_000) attempts.delete(key);
      if (attempts.size <= 4000) break;
    }
  }
  return false;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return json({ ok: false, error: "Origin not allowed." }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405, origin);

  const apiKey = req.headers.get("apikey");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // A publishable/anon key is public configuration, not authentication. The function's
  // trust boundary is input validation, origin policy, rate limiting and service-role-only DB writes.
  if (!url || !serviceKey || !apiKey) {
    return json({ ok: false, error: "Contact service is temporarily unavailable." }, 503, origin);
  }

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 12_000) {
    return json({ ok: false, error: "Message is too large." }, 413, origin);
  }

  let body: Record<string, unknown>;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > 12_000) {
      return json({ ok: false, error: "Message is too large." }, 413, origin);
    }
    body = JSON.parse(rawBody) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected JSON object");
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400, origin);
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();
  const website = String(body.website ?? "").trim();

  // Honeypot: silently accept automated spam without storing it.
  if (website) return json({ ok: true }, 202, origin);

  if (
    name.length < 2 || name.length > 100 ||
    email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    subject.length < 3 || subject.length > 160 ||
    message.length < 10 || message.length > 5000
  ) {
    return json({ ok: false, error: "Check the fields and try again." }, 400, origin);
  }

  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = req.headers.get("cf-connecting-ip") ?? forwarded ?? "unknown";
  if (tooManyAttempts(ip)) {
    return json({ ok: false, error: "Too many submissions. Please try again later." }, 429, origin);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.from("contact_messages").insert({
    name,
    email,
    subject,
    message,
  });
  if (error) {
    console.error("[Contact] Message insert failed", { code: error.code });
    return json({ ok: false, error: "We couldn't save your message. Please try again later." }, 500, origin);
  }

  return json({ ok: true }, 201, origin);
});
