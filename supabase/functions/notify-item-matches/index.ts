import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = { id: string; user_id: string; type: "Lost" | "Found"; name: string; category: string; location: string; note: string };

function similarity(a: string, b: string) {
  const words = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 1));
  const left = words(a);
  const right = words(b);
  const union = new Set([...left, ...right]).size;
  if (!union) return 0;
  return [...left].filter((word) => right.has(word)).length / union;
}

function matchScore(a: Item, b: Item) {
  if (a.type === b.type) return 0;
  return Math.min(100,
    (a.category === b.category ? 35 : 0) +
    Math.round(similarity(a.name, b.name) * 50) +
    (similarity(a.location, b.location) >= 0.2 ? 15 : 0) +
    (similarity(a.note, b.note) >= 0.2 ? 5 : 0),
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return Response.json({ error: "Server configuration incomplete" }, { status: 500, headers: corsHeaders });

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders });

  let itemId = "";
  try {
    const body = await request.json();
    itemId = typeof body.item_id === "string" ? body.item_id : "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: corsHeaders });
  }
  if (!itemId) return Response.json({ error: "Item ID required" }, { status: 400, headers: corsHeaders });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: item, error: itemError } = await admin.from("items").select("id,user_id,type,name,category,location,note").eq("id", itemId).single();
  if (itemError || !item || item.user_id !== authData.user.id) return Response.json({ error: "Report not found" }, { status: 404, headers: corsHeaders });

  const { data: candidates } = await admin.from("items").select("id,user_id,type,name,category,location,note").neq("user_id", item.user_id).eq("type", item.type === "Lost" ? "Found" : "Lost").limit(150);
  const matches = ((candidates ?? []) as Item[]).map((candidate) => ({ item: candidate, score: matchScore(item as Item, candidate) })).filter((entry) => entry.score >= 45).sort((a, b) => b.score - a.score).slice(0, 5);
  if (matches.length === 0) return Response.json({ ok: true, sms_sent: 0, matches: 0 }, { headers: corsHeaders });

  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!twilioSid || !twilioToken || !twilioFrom) {
    return Response.json({ ok: true, sms_sent: 0, matches: matches.length, sms_configured: false }, { headers: corsHeaders });
  }

  const userIds = [...new Set([item.user_id, ...matches.map((entry) => entry.item.user_id)])];
  const { data: preferences } = await admin.from("notification_preferences").select("user_id,phone_number,sms_notifications_enabled").in("user_id", userIds);
  const enabled = new Map((preferences ?? []).filter((p) => p.sms_notifications_enabled && p.phone_number).map((p) => [p.user_id, p.phone_number as string]));
  const recipients = new Map<string, string>();
  for (const match of matches) {
    const currentPhone = enabled.get(item.user_id);
    const otherPhone = enabled.get(match.item.user_id);
    if (currentPhone) recipients.set(currentPhone, `CampusFind CU: possible match for your ${item.type.toLowerCase()} report "${item.name}". Sign in to compare details.`);
    if (otherPhone) recipients.set(otherPhone, `CampusFind CU: a new ${item.type.toLowerCase()} report may match your item "${match.item.name}". Sign in to compare details.`);
  }

  let sent = 0;
  for (const [to, body] of recipients) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: twilioFrom, To: to, Body: body }),
    });
    if (response.ok) sent += 1;
  }
  return Response.json({ ok: true, sms_sent: sent, matches: matches.length, sms_configured: true }, { headers: corsHeaders });
});
