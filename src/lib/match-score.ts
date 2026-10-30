import type { Item } from "@/lib/items";

const words = (value: string) =>
  new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 1));

export function scoreItemMatch(
  a: Pick<Item, "name" | "category" | "location" | "note" | "type" | "item_date"> & Partial<Pick<Item, "brand" | "color" | "model">>,
  b: Pick<Item, "name" | "category" | "location" | "note" | "type" | "item_date"> & Partial<Pick<Item, "brand" | "color" | "model">>,
) {
  if (a.type === b.type) return 0;
  let score = a.category === b.category ? 28 : 0;
  const nameA = words(a.name);
  const nameB = words(b.name);
  const overlap = [...nameA].filter((word) => nameB.has(word)).length;
  const union = new Set([...nameA, ...nameB]).size;
  score += union ? Math.round((overlap / union) * 42) : 0;
  if (a.name.toLowerCase().trim() === b.name.toLowerCase().trim()) score += 18;
  for (const key of ["brand", "color", "model"] as const) {
    const left = (a[key] ?? "").trim().toLowerCase();
    const right = (b[key] ?? "").trim().toLowerCase();
    if (left && right && left === right) score += key === "brand" ? 7 : 8;
  }
  const dateA = Date.parse(a.item_date);
  const dateB = Date.parse(b.item_date);
  if (Number.isFinite(dateA) && Number.isFinite(dateB)) {
    const daysApart = Math.abs(dateA - dateB) / 86_400_000;
    if (daysApart <= 1) score += 6;
    else if (daysApart <= 3) score += 3;
  }
  const placeA = words(a.location);
  const placeB = words(b.location);
  const placeOverlap = [...placeA].filter((word) => placeB.has(word)).length;
  score += placeOverlap ? Math.min(12, placeOverlap * 6) : 0;
  const noteA = words(a.note);
  const noteB = words(b.note);
  const noteOverlap = [...noteA].filter((word) => noteB.has(word)).length;
  score += noteOverlap ? Math.min(12, noteOverlap * 3) : 0;
  return Math.min(100, score);
}

export function findItemMatches<T extends Pick<Item, "name" | "category" | "location" | "note" | "type" | "item_date"> & Partial<Pick<Item, "brand" | "color" | "model">>>(item: T, candidates: T[]) {
  return candidates
    .map((candidate) => ({ item: candidate, score: scoreItemMatch(item, candidate) }))
    .filter((match) => match.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
