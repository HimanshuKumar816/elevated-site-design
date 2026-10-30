import { describe, expect, it } from "vitest";
import { isValidUid, normalizeUid } from "./uid";

describe("normalizeUid", () => {
  it("trims whitespace and normalizes case", () => {
    expect(normalizeUid("  23bcs10001 ")).toBe("23BCS10001");
  });

  it("handles nullish values safely", () => {
    expect(normalizeUid(null)).toBe("");
    expect(normalizeUid(undefined)).toBe("");
  });
});

describe("isValidUid", () => {
  it("accepts 5–20 ASCII letters and digits", () => {
    expect(isValidUid("23BCS10001")).toBe(true);
    expect(isValidUid("abcde")).toBe(true);
    expect(isValidUid("A".repeat(20))).toBe(true);
  });

  it("rejects blank, too-short, too-long, and punctuated UIDs", () => {
    expect(isValidUid("")).toBe(false);
    expect(isValidUid("AB12")).toBe(false);
    expect(isValidUid("A".repeat(21))).toBe(false);
    expect(isValidUid("23-BCS-10001")).toBe(false);
  });
});
