import type { Item } from "@/lib/items";

const words = (value: string) =>
  new Set(value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 1));

export function scoreItemMatch(a: Pick<Item, "name" | "category" | "location" | "note" | "type">, b: Pick<Item, "name" | "category" | "location" | "note" | "type">) {
  if (a.type === b.type) return 0;
  let score = a.category === b.category ? 28 : 0;
  const nameA = words(a.name);
  const nameB = words(b.name);
  const overlap = [...nameA].filter((word) => nameB.has(word)).length;
  const union = new Set([...nameA, ...nameB]).size;
  score += union ? Math.round((overlap / union) * 42) : 0;
  if (a.name.toLowerCase().trim() === b.name.toLowerCase().trim()) score += 18;
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

export function findItemMatches<T extends Pick<Item, "name" | "category" | "location" | "note" | "type">>(item: T, candidates: T[]) {
  return candidates
    .map((candidate) => ({ item: candidate, score: scoreItemMatch(item, candidate) }))
    .filter((match) => match.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
