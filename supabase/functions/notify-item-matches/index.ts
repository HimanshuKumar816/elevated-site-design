import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isEligibleForMatching } from "./matching.ts";

const OPENAI_MODEL = "gpt-4o-mini";
const MAX_CANDIDATES = 500;
const AI_CANDIDATES = 12;
const MIN_AI_SCORE = 55;

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

function json(data: unknown, status: number, origin: string | null) {
  return Response.json(data, { status, headers: corsHeaders(origin) });
}

async function hashRateLimitKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Item = {
  id: string;
  user_id: string;
  type: "Lost" | "Found";
  name: string;
  category: string;
  location: string;
  note: string;
  item_date?: string;
  item_time?: string;
  brand?: string;
  color?: string;
  model?: string;
  image_path?: string | null;
  report_status: string;
  moderation_flag: string;
  created_at: string;
};

type RankedCandidate = { item: Item; score: number };
type MatchResult = { item: Item; score: number; reason: string };

function tokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase().normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1),
  );
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  const union = new Set([...left, ...right]).size;
  if (!union) return 0;
  return [...left].filter((word) => right.has(word)).length / union;
}

function preliminaryScore(a: Item, b: Item): number {
  if (a.type === b.type) return 0;
  const dateDelta = a.item_date && b.item_date
    ? Math.abs(Date.parse(a.item_date) - Date.parse(b.item_date)) / 86_400_000
    : Number.POSITIVE_INFINITY;
  return Math.min(100,
    (a.category === b.category ? 15 : 0) +
    Math.round(similarity(a.name, b.name) * 25) +
    (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase() ? 15 : 0) +
    (a.color && b.color && a.color.toLowerCase() === b.color.toLowerCase() ? 10 : 0) +
    (a.model && b.model && a.model.toLowerCase() === b.model.toLowerCase() ? 15 : 0) +
    (dateDelta <= 1 ? 10 : dateDelta <= 3 ? 6 : dateDelta <= 7 ? 3 : 0) +
    (similarity(a.location, b.location) >= 0.2 ? 10 : 0) +
    (similarity(a.note, b.note) >= 0.2 ? 10 : 0),
  );
}

function fallbackReason(a: Item, b: Item): string {
  const reasons: string[] = [];
  if (a.category === b.category) reasons.push(`same category: ${a.category}`);
  if (similarity(a.name, b.name) >= 0.2) reasons.push("similar item names");
  if (similarity(a.location, b.location) >= 0.2) reasons.push("similar campus locations");
  if (similarity(a.note, b.note) >= 0.2) reasons.push("overlapping descriptions");
  if (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase()) reasons.push("same brand");
  if (a.color && b.color && a.color.toLowerCase() === b.color.toLowerCase()) reasons.push("same colour");
  if (a.model && b.model && a.model.toLowerCase() === b.model.toLowerCase()) reasons.push("same model");
  return reasons.length
    ? `Text fallback found ${reasons.join(", ")}.`
    : "Text similarity suggests this pair should be checked manually.";
}

async function consumeLimit(admin: ReturnType<typeof createClient>, key: string, windowSeconds: number, maxRequests: number) {
  const keyHash = await hashRateLimitKey(key);
  return admin.rpc("consume_edge_rate_limit", {
    p_key_hash: keyHash,
    p_window_seconds: windowSeconds,
    p_max_requests: maxRequests,
  });
}

async function testOpenAiConnection(apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      max_tokens: 30,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: 'Return only JSON: {"ready":true}.' },
        { role: "user", content: "Check whether the matching model is reachable." },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { reachable: false, error_code: `openai_http_${response.status}` };
  const body = await response.json();
  const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "{}");
  return { reachable: parsed.ready === true, error_code: parsed.ready === true ? null : "unexpected_model_response" };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Sign in required" }, 401, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 500, origin);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid session" }, 401, origin);

  let body: { action?: string; item_id?: unknown };
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 2_048) return json({ error: "Request is too large." }, 413, origin);
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid request" }, 400, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const userId = authData.user.id;
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const aiConfigured = Boolean(openAiKey);

  if (body.action === "health") {
    const { data: profile, error: profileError } = await admin
      .from("profiles").select("role").eq("id", userId).maybeSingle();
    if (profileError || profile?.role !== "admin") return json({ error: "Administrator access is required." }, 403, origin);

    const { data: rateAllowed, error: rateError } = await consumeLimit(admin, `notify-item-matches:health:${userId}`, 60, 5);
    if (rateError) return json({ error: "AI health check is temporarily unavailable." }, 503, origin);
    if (rateAllowed !== true) return json({ error: "Please wait before testing the AI engine again." }, 429, origin);

    if (!openAiKey) {
      return json({ ok: true, ai_configured: false, ai_reachable: false, model: OPENAI_MODEL }, 200, origin);
    }
    try {
      const result = await testOpenAiConnection(openAiKey);
      return json({
        ok: true,
        ai_configured: true,
        ai_reachable: result.reachable,
        model: OPENAI_MODEL,
        error_code: result.error_code,
      }, 200, origin);
    } catch {
      return json({ ok: true, ai_configured: true, ai_reachable: false, model: OPENAI_MODEL, error_code: "connection_test_failed" }, 200, origin);
    }
  }

  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) {
    return json({ error: "A valid report ID is required." }, 400, origin);
  }

  const { data: userRateAllowed, error: userRateError } = await consumeLimit(admin, `notify-item-matches:user:${userId}`, 60, 10);
  if (userRateError) {
    console.error("[item matches] User rate-limit check failed", { code: userRateError.code });
    return json({ error: "Matching service is temporarily unavailable." }, 503, origin);
  }
  if (userRateAllowed !== true) return json({ error: "Too many match requests. Please wait a minute and try again." }, 429, origin);

  const { data: item, error: itemError } = await admin.from("items")
    .select("id,user_id,type,name,category,location,note,item_date,item_time,brand,color,model,image_path,report_status,moderation_flag,created_at")
    .eq("id", itemId)
    .single();
  if (itemError || !item || item.user_id !== userId) return json({ error: "Report not found" }, 404, origin);
  if (!isEligibleForMatching(item)) {
    return json({ ok: true, matches: [], match_count: 0, skipped: true, reason: "report_not_eligible", ai_configured: aiConfigured, ai_used: false }, 200, origin);
  }

  const { data: itemRateAllowed, error: itemRateError } = await consumeLimit(admin, `notify-item-matches:item:${item.id}`, 300, 1);
  if (itemRateError) {
    console.error("[item matches] Item rate-limit check failed", { code: itemRateError.code });
    return json({ error: "Matching service is temporarily unavailable." }, 503, origin);
  }
  if (itemRateAllowed !== true) return json({ error: "This report was checked recently. Please try again later." }, 429, origin);

  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const { data: candidates, error: candidateError } = await admin.from("items")
    .select("id,user_id,type,name,category,location,note,item_date,item_time,brand,color,model,image_path,report_status,moderation_flag,created_at")
    .neq("user_id", item.user_id)
    .eq("type", item.type === "Lost" ? "Found" : "Lost")
    .in("report_status", ["new", "under_review", "matched"])
    .eq("moderation_flag", "none")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(MAX_CANDIDATES);
  if (candidateError) {
    console.error("[item matches] Candidate lookup failed", { code: candidateError.code });
    return json({ error: "Matching service is temporarily unavailable." }, 503, origin);
  }

  const candidateItems = (candidates ?? []) as Item[];
  const rankedCandidates: RankedCandidate[] = candidateItems
    .map((candidate) => ({ item: candidate, score: preliminaryScore(item as Item, candidate) }))
    .sort((a, b) => b.score - a.score || b.item.created_at.localeCompare(a.item.created_at));

  if (rankedCandidates.length === 0) {
    console.info("[item matches] No active opposite-type reports", { itemId: item.id, type: item.type });
    return json({
      ok: true,
      matches: [],
      match_count: 0,
      candidate_count: 0,
      evaluated_count: 0,
      matching_method: "no-candidates",
      ai_configured: aiConfigured,
      ai_used: false,
    }, 200, origin);
  }

  // Rank first, then ask AI to compare the best candidates rather than simply
  // examining the newest twelve reports.
  const selected = rankedCandidates.slice(0, AI_CANDIDATES);
  let results: MatchResult[] = [];
  let matchingMethod = "text-similarity";
  let aiUsed = false;
  let aiErrorCode: string | null = null;

  if (openAiKey) {
    try {
      const aiContent: Array<Record<string, unknown>> = [{
        type: "text",
        text: JSON.stringify({
          report: {
            id: item.id, type: item.type, name: item.name, category: item.category,
            location: item.location, item_date: item.item_date, item_time: item.item_time,
            brand: item.brand, color: item.color, model: item.model, note: item.note,
          },
          candidates: selected.map(({ item: candidate }) => ({
            id: candidate.id, type: candidate.type, name: candidate.name, category: candidate.category,
            location: candidate.location, item_date: candidate.item_date, item_time: candidate.item_time,
            brand: candidate.brand, color: candidate.color, model: candidate.model, note: candidate.note,
          })),
          instruction: "The new report image, if present, is labelled first. Candidate images are labelled with their candidate IDs. Use photo evidence and report details together. Missing images are not evidence against a match.",
        }),
      }];

      if (item.image_path) {
        const { data: image } = await admin.storage.from("item-images").createSignedUrl(item.image_path, 300);
        if (image?.signedUrl) aiContent.push(
          { type: "text", text: "Photo of the newly reported item:" },
          { type: "image_url", image_url: { url: image.signedUrl } },
        );
      }

      for (const { item: candidate } of selected) {
        if (!candidate.image_path) continue;
        const { data: image } = await admin.storage.from("item-images").createSignedUrl(candidate.image_path, 300);
        if (image?.signedUrl) aiContent.push(
          { type: "text", text: `Photo for candidate ${candidate.id}:` },
          { type: "image_url", image_url: { url: image.signedUrl } },
        );
      }

      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: 'You compare one Lost/Found report with opposite-type candidate reports to determine whether they refer to the same physical item. Consider item identity, distinctive description details, brand, model, colour, date/time context, campus location, and photos. Category similarity alone is never enough. Do not infer serial numbers, passwords, or private ownership proof. Return JSON only: {"matches":[{"id":"candidate UUID","score":0-100,"reason":"short evidence-based explanation"}]}. Include only plausible same-item candidates with score >= 55. Return an empty array when no credible match exists.',
            },
            { role: "user", content: aiContent },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!aiResponse.ok) {
        aiErrorCode = `openai_http_${aiResponse.status}`;
        console.warn("[item matches] AI request failed; using text fallback", { status: aiResponse.status });
      } else {
        const aiBody = await aiResponse.json();
        const parsed = JSON.parse(aiBody.choices?.[0]?.message?.content ?? "{}");
        const selectedById = new Map(selected.map(({ item: candidate }) => [candidate.id, candidate]));
        const aiMatches = (Array.isArray(parsed.matches) ? parsed.matches : [])
          .filter((entry: { id?: string; score?: number; reason?: string }) =>
            typeof entry.id === "string"
            && selectedById.has(entry.id)
            && Number.isFinite(Number(entry.score))
            && Number(entry.score) >= MIN_AI_SCORE
          )
          .map((entry: { id: string; score: number; reason?: string }) => ({
            item: selectedById.get(entry.id)!,
            score: Math.max(0, Math.min(100, Math.round(Number(entry.score)))),
            reason: typeof entry.reason === "string" && entry.reason.trim()
              ? entry.reason.trim().slice(0, 500)
              : "AI compared the item details and available photographs.",
          }))
          .sort((a: MatchResult, b: MatchResult) => b.score - a.score)
          .slice(0, 5);
        aiUsed = true;
        matchingMethod = "ai";
        results = aiMatches;
      }
    } catch (error) {
      aiErrorCode = error instanceof Error && error.name === "TimeoutError" ? "openai_timeout" : "openai_request_failed";
      console.warn("[item matches] AI request failed; using text fallback", { reason: aiErrorCode });
    }
  } else {
    aiErrorCode = "openai_key_not_configured";
  }

  if (!aiUsed) {
    results = rankedCandidates
      .filter(({ score }) => score >= 45)
      .slice(0, 5)
      .map(({ item: candidate, score }) => ({
        item: candidate,
        score,
        reason: fallbackReason(item as Item, candidate).slice(0, 500),
      }));
    matchingMethod = "text-similarity";
  }

  let savedCount = 0;
  for (const match of results) {
    const lostItem = item.type === "Lost" ? item as Item : match.item;
    const foundItem = item.type === "Found" ? item as Item : match.item;
    const { error: saveError } = await admin.from("item_matches").upsert({
      lost_item_id: lostItem.id,
      found_item_id: foundItem.id,
      score: match.score,
      matching_method: matchingMethod,
      match_reason: match.reason.slice(0, 500),
    }, { onConflict: "lost_item_id,found_item_id" });
    if (saveError) {
      console.error("[item matches] Candidate pair could not be saved", { code: saveError.code });
    } else {
      savedCount += 1;
    }
  }

  console.info("[item matches] Matching complete", {
    itemId: item.id,
    candidateCount: candidateItems.length,
    evaluatedCount: selected.length,
    matchCount: results.length,
    savedCount,
    matchingMethod,
    aiConfigured,
    aiUsed,
    aiErrorCode,
  });

  return json({
    ok: true,
    matches: results.map((match) => ({
      item_id: match.item.id,
      score: match.score,
      reason: match.reason,
    })),
    match_count: results.length,
    saved_count: savedCount,
    candidate_count: candidateItems.length,
    evaluated_count: selected.length,
    matching_method: matchingMethod,
    ai_configured: aiConfigured,
    ai_used: aiUsed,
    ai_error_code: aiErrorCode,
  }, 200, origin);
});
