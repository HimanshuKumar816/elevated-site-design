const SYNONYMS: Record<string, string[]> = {
  wallet: ["purse", "billfold"],
  purse: ["wallet", "billfold"],
  billfold: ["wallet", "purse"],
  phone: ["mobile", "smartphone", "cellphone"],
  mobile: ["phone", "smartphone", "cellphone"],
  smartphone: ["phone", "mobile", "cellphone"],
  "id": ["identity", "identitycard"],
  identity: ["id", "identitycard"],
  bottle: ["flask", "waterbottle"],
  flask: ["bottle", "waterbottle"],
  bag: ["backpack", "rucksack"],
  backpack: ["bag", "rucksack"],
  laptop: ["notebook", "computer"],
  notebook: ["laptop", "computer"],
  earbuds: ["earphones", "headphones"],
  earphones: ["earbuds", "headphones"],
  headphones: ["earbuds", "earphones"],
};

function normalise(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const above = previous[column];
      const substitution = diagonal + (a[row - 1] === b[column - 1] ? 0 : 1);
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, substitution);
      diagonal = above;
    }
  }
  return previous[b.length];
}

function closeEnough(query: string, candidate: string): boolean {
  if (candidate.includes(query) || query.includes(candidate)) return true;
  if (query.length < 5 || candidate.length < 5) return false;
  const allowed = Math.max(query.length, candidate.length) >= 8 ? 2 : 1;
  return editDistance(query, candidate) <= allowed;
}

/** Matches all search words, allowing common aliases and small typing mistakes. */
export function matchesSearch(query: string, haystack: string): boolean {
  const terms = normalise(query);
  if (terms.length === 0) return true;
  const values = normalise(haystack);
  if (values.length === 0) return false;

  return terms.every((term) => {
    const alternatives = [term, ...(SYNONYMS[term] ?? [])];
    return alternatives.some((alternative) => values.some((value) => closeEnough(alternative, value)));
  });
}
