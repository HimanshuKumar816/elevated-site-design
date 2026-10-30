import { describe, expect, it } from "vitest";
import { isValidIsoDate } from "./date";

describe("isValidIsoDate", () => {
  it("accepts valid ISO calendar dates", () => {
    expect(isValidIsoDate("2026-10-21")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("21-10-2026")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });
});
