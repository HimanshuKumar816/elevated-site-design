import { describe, expect, it } from "vitest";
import { isAdminProfile, validateNewPassword, validateSignup } from "./auth-validation";
import { countReports, filterReports, type AdminReport } from "./admin-reports";

const base = { fullName: "Asha Rao", uid: " 26bcs11930 ", phone: "98765 43210", password: "longpass1", confirmPassword: "longpass1" };

describe("validateNewPassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validateNewPassword("1234567", "1234567")).toMatch(/at least 8/);
  });
  it("accepts exactly 8 characters", () => {
    expect(validateNewPassword("12345678", "12345678")).toBeNull();
  });
  it("rejects mismatched confirmation", () => {
    expect(validateNewPassword("12345678", "12345679")).toBe("Passwords do not match.");
  });
});

describe("validateSignup", () => {
  it("normalizes UID and phone", () => {
    const r = validateSignup(base);
    expect(r).toEqual({ ok: true, value: { fullName: "Asha Rao", uid: "26BCS11930", phone: "+919876543210", password: "longpass1" } });
  });
  it("rejects empty name", () => {
    expect(validateSignup({ ...base, fullName: "  " }).ok).toBe(false);
  });
  it("rejects invalid UID", () => {
    expect(validateSignup({ ...base, uid: "ab-1" }).ok).toBe(false);
  });
  it("rejects invalid phone", () => {
    expect(validateSignup({ ...base, phone: "12345" }).ok).toBe(false);
  });
  it("rejects password mismatch before any OTP", () => {
    expect(validateSignup({ ...base, confirmPassword: "different1" })).toEqual({ ok: false, error: "Passwords do not match." });
  });
});

describe("isAdminProfile", () => {
  it("only accepts role admin", () => {
    expect(isAdminProfile({ role: "admin" })).toBe(true);
    expect(isAdminProfile({ role: "student" })).toBe(false);
    expect(isAdminProfile({ role: "ADMIN" })).toBe(false);
    expect(isAdminProfile(null)).toBe(false);
    expect(isAdminProfile({})).toBe(false);
  });
});

describe("admin report filtering", () => {
  const r = (o: Partial<AdminReport>): AdminReport => ({ id: "1", user_id: "u1", type: "Lost", name: "Wallet", category: "Wallet", location: "Block A", item_date: "2026-01-01", note: null, created_at: "", image_path: null, submitter_name: "Asha", submitter_uid: "26BCS11930", ...o });
  const list = [r({ id: "1" }), r({ id: "2", type: "Found", name: "Keys", category: "Keys", submitter_uid: "22BCS00001" })];
  it("counts total/lost/found", () => {
    expect(countReports(list)).toEqual({ total: 2, lost: 1, found: 1 });
  });
  it("filters by type and searches submitter UID", () => {
    expect(filterReports(list, { query: "", type: "Found", category: "All" }).map((x) => x.id)).toEqual(["2"]);
    expect(filterReports(list, { query: "22bcs", type: "All", category: "All" }).map((x) => x.id)).toEqual(["2"]);
  });
});
