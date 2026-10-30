import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  it("matches exact item names and locations", () => {
    expect(matchesSearch("wallet", "Black wallet found near the library")).toBe(true);
    expect(matchesSearch("library", "Central library")).toBe(true);
  });

  it("matches common campus item synonyms", () => {
    expect(matchesSearch("purse", "Brown wallet")).toBe(true);
    expect(matchesSearch("mobile", "Lost smartphone")).toBe(true);
    expect(matchesSearch("backpack", "Blue bag")).toBe(true);
    expect(matchesSearch("earphones", "Wireless earbuds")).toBe(true);
  });

  it("tolerates small typing mistakes", () => {
    expect(matchesSearch("walet", "Black wallet")).toBe(true);
    expect(matchesSearch("libary", "Central library")).toBe(true);
  });

  it("requires all words to match and handles empty searches", () => {
    expect(matchesSearch("", "Any item")).toBe(true);
    expect(matchesSearch("black wallet", "Black leather wallet")).toBe(true);
    expect(matchesSearch("black laptop", "Black wallet")).toBe(false);
  });
});
