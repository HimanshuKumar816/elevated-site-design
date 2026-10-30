import { describe, expect, it } from "vitest";
import { isValidOtp, normalizePhoneNumber } from "./phone";

describe("normalizePhoneNumber", () => {
  it("adds India's country code to a 10-digit number", () => {
    expect(normalizePhoneNumber("9876543210")).toBe("+919876543210");
  });

  it("normalizes separators and an explicit Indian country code", () => {
    expect(normalizePhoneNumber("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhoneNumber("919876543210")).toBe("+919876543210");
  });

  it("accepts valid E.164 numbers from other countries", () => {
    expect(normalizePhoneNumber("+14155552671")).toBe("+14155552671");
  });

  it("rejects missing, incomplete, and malformed numbers", () => {
    expect(normalizePhoneNumber("")).toBe("");
    expect(normalizePhoneNumber("98765")).toBe("");
    expect(normalizePhoneNumber("abc9876543210")).toBe("");
    expect(normalizePhoneNumber("+01234567890")).toBe("");
  });
});

describe("isValidOtp", () => {
  it("accepts exactly six digits", () => {
    expect(isValidOtp("123456")).toBe(true);
  });

  it("rejects incomplete, non-numeric, and empty codes", () => {
    expect(isValidOtp("12345")).toBe(false);
    expect(isValidOtp("12a456")).toBe(false);
    expect(isValidOtp("")).toBe(false);
    expect(isValidOtp(null)).toBe(false);
  });
});
