import type { Item } from "@/lib/items";

const synonyms: Record<string, string> = {
  purse: "wallet",
  billfold: "wallet",
  cell: "phone",
  cellphone: "phone",
  mobile: "phone",
  smartphone: "phone",
  earphones: "earbuds",
  headphones: "earbuds",
  rucksack: "backpack",
  bag: "backpack",
  flask: "bottle",
};

const words = (value: string | null | undefined) =>
  new Set(
    (value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1)
      .map((word) => synonyms[word] ?? word),
  );

type MatchFields = Pick<Item, "name" | "category" | "location" | "note" | "type" | "item_date" | "item_time"> &
  Partial<Pick<Item, "brand" | "color" | "model">>;

function overlapCount(left: Set<string>, right: Set<string>) {
  return [...left].filter((word) => right.has(word)).length;
}

function minutesBetween(left: string, right: string) {
  const [leftHours, leftMinutes] = left.split(":").map(Number);
  const [rightHours, rightMinutes] = right.split(":").map(Number);
  if (![leftHours, leftMinutes, rightHours, rightMinutes].every(Number.isFinite)) return Infinity;
  return Math.abs((leftHours * 60 + leftMinutes) - (rightHours * 60 + rightMinutes));
}

export function scoreItemMatch(a: MatchFields, b: MatchFields) {
  if (a.type === b.type) return 0;

  const nameA = words(a.name);
  const nameB = words(b.name);
  const nameOverlap = overlapCount(nameA, nameB);
  const nameUnion = new Set([...nameA, ...nameB]).size;

  let score = a.category === b.category ? 28 : 0;
  score += nameUnion ? Math.round((nameOverlap / nameUnion) * 42) : 0;
  if (nameA.size > 0 && nameOverlap === nameA.size && nameOverlap === nameB.size) score += 18;

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

  if (a.item_time && b.item_time && Number.isFinite(dateA) && Number.isFinite(dateB) &&
      Math.abs(dateA - dateB) <= 86_400_000 && minutesBetween(a.item_time, b.item_time) <= 120) {
    score += 3;
  }

  const placeOverlap = overlapCount(words(a.location), words(b.location));
  score += placeOverlap ? Math.min(12, placeOverlap * 6) : 0;

  const noteOverlap = overlapCount(words(a.note), words(b.note));
  score += noteOverlap ? Math.min(12, noteOverlap * 3) : 0;

  return Math.min(100, score);
}

/** Explains only public report fields; never uses private claim evidence. */
export function explainItemMatch(a: MatchFields, b: MatchFields): string[] {
  const reasons: string[] = [];
  if (a.category === b.category) reasons.push(\`same category (\${a.category})\`);

  const nameOverlap = overlapCount(words(a.name), words(b.name));
  if (nameOverlap > 0) reasons.push("similar item names");

  for (const key of ["brand", "color", "model"] as const) {
    const left = (a[key] ?? "").trim().toLowerCase();
    const right = (b[key] ?? "").trim().toLowerCase();
    if (left && right && left === right) {
      reasons.push(key === "color" ? "same colour" : \`same \${key}\`);
    }
  }

  const dateA = Date.parse(a.item_date);
  const dateB = Date.parse(b.item_date);
  if (Number.isFinite(dateA) && Number.isFinite(dateB) &&
      Math.abs(dateA - dateB) / 86_400_000 <= 1) {
    reasons.push("reported within one day");
  }

  if (overlapCount(words(a.location), words(b.location)) > 0) reasons.push("similar campus locations");
  if (overlapCount(words(a.note), words(b.note)) > 0) reasons.push("overlapping public descriptions");

  return reasons.slice(0, 5);
}

export function findItemMatches<T extends MatchFields>(item: T, candidates: T[]) {
  return candidates
    .map((candidate) => ({ item: candidate, score: scoreItemMatch(item, candidate) }))
    .filter((match) => match.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
