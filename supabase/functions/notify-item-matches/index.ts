import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Item = { id: string; user_id: string; type: "Lost" | "Found"; name: string; category: string; location: string; note: string; image_path?: string | null };

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
  const { data: item, error: itemError } = await admin.from("items").select("id,user_id,type,name,category,location,note,image_path").eq("id", itemId).single();
  if (itemError || !item || item.user_id !== authData.user.id) return Response.json({ error: "Report not found" }, { status: 404, headers: corsHeaders });

  const { data: candidates } = await admin.from("items").select("id,user_id,type,name,category,location,note,image_path").neq("user_id", item.user_id).eq("type", item.type === "Lost" ? "Found" : "Lost").limit(150);
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
          report: { type: item.type, name: item.name, category: item.category, location: item.location, note: item.note },
          candidates: visualCandidates.map((candidate) => ({ id: candidate.id, type: candidate.type, name: candidate.name, category: candidate.category, location: candidate.location, note: candidate.note })),
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
  if (matches.length === 0) return Response.json({ ok: true, sms_sent: 0, matches: 0, matching_method: matchingMethod }, { headers: corsHeaders });

  // Add in-app alerts for AI matches not already created by the database's similarity trigger.
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
  return Response.json({ ok: true, sms_sent: sent, matches: matches.length, sms_configured: true, matching_method: matchingMethod }, { headers: corsHeaders });
});
