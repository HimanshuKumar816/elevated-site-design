import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isEligibleForMatching } from "./matching.ts";

const allowedOrigins = new Set([
  "https://campusfind-uir0.onrender.com",
  "https://campusfind-fs6c.onrender.com",
  "http://localhost:5173",
  "http://localhost:8080",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

async function hashRateLimitKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Item = { id: string; user_id: string; type: "Lost" | "Found"; name: string; category: string; location: string; note: string; item_date?: string; brand?: string; color?: string; model?: string; image_path?: string | null; report_status: string; moderation_flag: string };

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
    Math.round(similarity(a.name, b.name) * 42) +
    (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase() ? 7 : 0) +
    (a.color && b.color && a.color.toLowerCase() === b.color.toLowerCase() ? 8 : 0) +
    (a.model && b.model && a.model.toLowerCase() === b.model.toLowerCase() ? 8 : 0) +
    (a.item_date && b.item_date && Math.abs(Date.parse(a.item_date) - Date.parse(b.item_date)) <= 86400000 ? 6 : 0) +
    (similarity(a.location, b.location) >= 0.2 ? 12 : 0) +
    (similarity(a.note, b.note) >= 0.2 ? 5 : 0),
  );
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders(origin) });

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return Response.json({ error: "Sign in required" }, { status: 401, headers: corsHeaders(origin) });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return Response.json({ error: "Server configuration incomplete" }, { status: 500, headers: corsHeaders(origin) });

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return Response.json({ error: "Invalid session" }, { status: 401, headers: corsHeaders(origin) });

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userRateLimitKey = await hashRateLimitKey(`notify-item-matches:user:${authData.user.id}`);
  const { data: userRateAllowed, error: userRateError } = await admin.rpc("consume_edge_rate_limit", {
    p_key_hash: userRateLimitKey,
    p_window_seconds: 60,
    p_max_requests: 10,
  });
  if (userRateError) {
    console.error("[item matches] User rate-limit check failed", { code: userRateError.code });
    return Response.json({ error: "Matching service is temporarily unavailable." }, { status: 503, headers: corsHeaders(origin) });
  }
  if (userRateAllowed !== true) {
    return Response.json({ error: "Too many match requests. Please wait a minute and try again." }, { status: 429, headers: corsHeaders(origin) });
  }

  let itemId = "";
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 2_048) {
      return Response.json({ error: "Request is too large." }, { status: 413, headers: corsHeaders(origin) });
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 2_048) {
      return Response.json({ error: "Request is too large." }, { status: 413, headers: corsHeaders(origin) });
    }
    const body = JSON.parse(rawBody) as { item_id?: unknown };
    itemId = typeof body.item_id === "string" ? body.item_id : "";
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: corsHeaders(origin) });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
    return Response.json({ error: "A valid report ID is required." }, { status: 400, headers: corsHeaders(origin) });
  }

  const { data: item, error: itemError } = await admin.from("items").select("id,user_id,type,name,category,location,note,item_date,brand,color,model,image_path,report_status,moderation_flag").eq("id", itemId).single();
  if (itemError || !item || item.user_id !== authData.user.id) return Response.json({ error: "Report not found" }, { status: 404, headers: corsHeaders(origin) });
  if (!isEligibleForMatching(item)) {
    return Response.json({ ok: true, matches: 0, skipped: true, reason: "report_not_eligible" }, { headers: corsHeaders(origin) });
  }

  const { data: candidates, error: candidateError } = await admin.from("items")
    .select("id,user_id,type,name,category,location,note,item_date,brand,color,model,image_path,report_status,moderation_flag")
    .neq("user_id", item.user_id)
    .eq("type", item.type === "Lost" ? "Found" : "Lost")
    .in("report_status", ["new", "under_review", "matched"])
    .eq("moderation_flag", "none")
    .order("created_at", { ascending: false })
    .limit(150);
  if (candidateError) {
    console.error("[item matches] Candidate lookup failed", { code: candidateError.code });
    return Response.json({ error: "Matching service is temporarily unavailable." }, { status: 503, headers: corsHeaders(origin) });
  }

  const itemRateLimitKey = await hashRateLimitKey(`notify-item-matches:item:${item.id}`);
  const { data: itemRateAllowed, error: itemRateError } = await admin.rpc("consume_edge_rate_limit", {
    p_key_hash: itemRateLimitKey,
    p_window_seconds: 300,
    p_max_requests: 1,
  });
  if (itemRateError) {
    console.error("[item matches] Item rate-limit check failed", { code: itemRateError.code });
    return Response.json({ error: "Matching service is temporarily unavailable." }, { status: 503, headers: corsHeaders(origin) });
  }
  if (itemRateAllowed !== true) {
    return Response.json({ error: "This report was checked recently. Please try again later." }, { status: 429, headers: corsHeaders(origin) });
  }

  const candidateItems = (candidates ?? []) as Item[];
  let matches = candidateItems.map((candidate) => ({ item: candidate, score: matchScore(item as Item, candidate) })).filter((entry) => entry.score >= 45).sort((a, b) => b.score - a.score).slice(0, 5);
  let matchingMethod = "text-similarity";
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (openAiKey && candidateItems.length > 0) {
    try {
      const visualCandidates = candidateItems.slice(0, 12);
      const aiContent: Array<Record<string, unknown>> = [{
        type: "text",
        text: JSON.stringify({
          report: { type: item.type, name: item.name, category: item.category, location: item.location, item_date: item.item_date, brand: item.brand, color: item.color, model: item.model, note: item.note },
          candidates: visualCandidates.map((candidate) => ({ id: candidate.id, type: candidate.type, name: candidate.name, category: candidate.category, location: candidate.location, item_date: candidate.item_date, brand: candidate.brand, color: candidate.color, model: candidate.model, note: candidate.note })),
          instruction: "Images, when supplied after this text, appear first for the new report and then in candidate order. Use image evidence as well as descriptions. Missing images are not evidence against a match.",
        }),
      }];
      if (item.image_path) {
        const { data: currentImage } = await admin.storage.from("item-images").createSignedUrl(item.image_path, 300);
        if (currentImage?.signedUrl) aiContent.push({ type: "text", text: "Photo of the newly reported item:" }, { type: "image_url", image_url: { url: currentImage.signedUrl } });
      }
      for (const candidate of visualCandidates) {
        if (!candidate.image_path) continue;
        const { data: candidateImage } = await admin.storage.from("item-images").createSignedUrl(candidate.image_path, 300);
        if (candidateImage?.signedUrl) aiContent.push({ type: "text", text: `Photo for candidate ${candidate.id}:` }, { type: "image_url", image_url: { url: candidateImage.signedUrl } });
      }
      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You match lost and found reports. Score whether each opposite-type report refers to the same real-world item. Compare item identity, category, location, date context if present, and descriptions. Never treat a category alone as proof. Return JSON only: {\"matches\":[{\"id\":\"candidate id\",\"score\":0-100,\"reason\":\"short reason\"}]}. Include only plausible matches with score >= 45. Do not infer private identifying details." },
            { role: "user", content: aiContent },
          ],
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (aiResponse.ok) {
        const aiBody = await aiResponse.json();
        const parsed = JSON.parse(aiBody.choices?.[0]?.message?.content ?? "{}");
        const allowedIds = new Set(candidateItems.map((candidate) => candidate.id));
        const aiMatches = (Array.isArray(parsed.matches) ? parsed.matches : [])
          .filter((entry: { id?: string; score?: number }) => typeof entry.id === "string" && allowedIds.has(entry.id) && Number(entry.score) >= 45)
          .map((entry: { id: string; score: number }) => ({ item: candidateItems.find((candidate) => candidate.id === entry.id)!, score: Math.max(0, Math.min(100, Math.round(Number(entry.score)))) }))
          .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
          .slice(0, 5);
        if (aiMatches.length > 0) {
          matches = aiMatches;
          matchingMethod = "ai";
        }
      }
    } catch {
      // Keep the service available with transparent text-similarity fallback.
    }
  }
  if (matches.length === 0) return Response.json({ ok: true, sms_sent: 0, matches: 0, matching_method: matchingMethod }, { headers: corsHeaders(origin) });

  // Persist each candidate pair once so administrators can review, confirm, or dismiss it.
  // An upsert refreshes the score/reason but omits review_status, preserving prior admin decisions.
  for (const match of matches) {
    const lostItem = item.type === "Lost" ? item as Item : match.item;
    const foundItem = item.type === "Found" ? item as Item : match.item;
    const reasonParts: string[] = [];
    if (lostItem.category === foundItem.category) reasonParts.push(`same category: ${lostItem.category}`);
    if (similarity(lostItem.name, foundItem.name) >= 0.2) reasonParts.push("similar item names");
    if (similarity(lostItem.location, foundItem.location) >= 0.2) reasonParts.push("similar campus locations");
    if (similarity(lostItem.note, foundItem.note) >= 0.2) reasonParts.push("overlapping descriptions");
    if (lostItem.brand && foundItem.brand && lostItem.brand.toLowerCase() === foundItem.brand.toLowerCase()) reasonParts.push("same brand");
    if (lostItem.color && foundItem.color && lostItem.color.toLowerCase() === foundItem.color.toLowerCase()) reasonParts.push("same colour");
    if (lostItem.model && foundItem.model && lostItem.model.toLowerCase() === foundItem.model.toLowerCase()) reasonParts.push("same model");
    const matchReason = matchingMethod === "ai"
      ? "AI-assisted comparison of the available report descriptions and photos."
      : reasonParts.length > 0
        ? `Text matching found ${reasonParts.join(", ")}.`
        : "Text similarity suggests this pair should be checked manually.";

    const { error: matchSaveError } = await admin.from("item_matches").upsert({
      lost_item_id: lostItem.id,
      found_item_id: foundItem.id,
      score: match.score,
      matching_method: matchingMethod,
      match_reason: matchReason,
    }, { onConflict: "lost_item_id,found_item_id" });
    if (matchSaveError) {
      console.error("[item matches] Could not persist a candidate pair", { code: matchSaveError.code });
    }
  }

  // Add in-app alerts for matches not already created by the database trigger.
  for (const match of matches) {
    for (const recipient of [
      { user_id: match.item.user_id, item_id: match.item.id, matched_item_id: item.id, body: `A new ${String(item.type).toLowerCase()} report may match your ${String(match.item.type).toLowerCase()} report: ${item.name}. Open CampusFind to compare details.` },
      { user_id: item.user_id, item_id: item.id, matched_item_id: match.item.id, body: `Your ${String(item.type).toLowerCase()} report may match an existing ${String(match.item.type).toLowerCase()} report: ${match.item.name}. Open CampusFind to compare details.` },
    ]) {
      const { data: existing } = await admin.from("notifications").select("id").eq("user_id", recipient.user_id).eq("item_id", recipient.item_id).eq("matched_item_id", recipient.matched_item_id).limit(1);
      if (!existing?.length) await admin.from("notifications").insert({ user_id: recipient.user_id, item_id: recipient.item_id, matched_item_id: recipient.matched_item_id, title: "Possible item match", body: recipient.body });
    }
  }

  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!twilioSid || !twilioToken || !twilioFrom) {
    return Response.json({ ok: true, sms_sent: 0, matches: matches.length, sms_configured: false }, { headers: corsHeaders(origin) });
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
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) sent += 1;
  }
  return Response.json({ ok: true, sms_sent: sent, matches: matches.length, sms_configured: true, matching_method: matchingMethod }, { headers: corsHeaders(origin) });
});
