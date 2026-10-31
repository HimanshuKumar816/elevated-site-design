import { describe, expect, it } from "vitest";
import { explainItemMatch, findItemMatches, scoreItemMatch } from "@/lib/match-score";
import type { Item } from "@/lib/items";

type MatchCandidate = Pick<Item, "type" | "name" | "category" | "location" | "note" | "item_date"> &
  Partial<Pick<Item, "brand" | "color" | "model">>;

const lost: MatchCandidate = {
  type: "Lost" as const,
  name: "Black wireless earbuds",
  category: "Electronics",
  location: "Central Library",
  note: "Dark case with a small scratch",
  item_date: "2026-10-30",
  brand: "Samsung",
  color: "Black",
  model: "Galaxy Buds FE",
};

describe("item matching", () => {
  it("rewards matching brand, colour, model, and close report dates", () => {
    const detailedMatch = {
      ...lost,
      type: "Found" as const,
      item_date: "2026-10-31",
    };
    const weakerMatch = {
      ...lost,
      type: "Found" as const,
      name: "Student notebook",
      category: "Books",
      location: "Parking Area",
      note: "No description available",
      item_date: "2026-09-01",
      brand: "Sony",
      color: "Red",
      model: "Different device",
    };

    expect(scoreItemMatch(lost, detailedMatch)).toBeGreaterThan(scoreItemMatch(lost, weakerMatch));
  });

  it("recognises common item-name synonyms without treating them as ownership proof", () => {
    const phone = {
      type: "Lost" as const,
      name: "Samsung cellphone",
      category: "Electronics",
      location: "Central Library",
      note: "Black phone case",
      item_date: "2026-10-30",
      brand: "Samsung",
      color: "Black",
      model: "Galaxy",
    };
    const candidate = { ...phone, type: "Found" as const, name: "Samsung smartphone" };
    expect(scoreItemMatch(phone, candidate)).toBeGreaterThan(70);
    expect(explainItemMatch(phone, candidate)).toContain("same brand");
  });

  it("explains matches using only public report fields", () => {
    const candidate = { ...lost, type: "Found" as const };
    expect(explainItemMatch(lost, candidate)).toEqual(
      expect.arrayContaining(["same category (Electronics)", "similar item names", "same brand", "same colour", "same model"]),
    );
  });

  it("never matches two reports of the same type", () => {
    expect(scoreItemMatch(lost, { ...lost, name: "Wireless earbuds" })).toBe(0);
  });

  it("returns the strongest opposite-type candidates first", () => {
    const strong = { ...lost, type: "Found" as const };
    const weak = {
      ...lost,
      type: "Found" as const,
      name: "Blue notebook",
      category: "Books",
      location: "Sports Complex",
      brand: "",
      color: "Blue",
      model: "",
    };
    const matches = findItemMatches(lost, [weak, strong]);
    expect(matches[0]?.item).toEqual(strong);
    expect(matches[0]?.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });
});
