import { describe, expect, it } from "vitest";
import { canClaimFoundReport, isVerifiedStudent } from "@/lib/access";

const verifiedStudent = { role: "student", verification_status: "verified" };
const unverifiedStudent = { role: "student", verification_status: "unverified" };
const foundReport = {
  type: "Found" as const,
  user_id: "owner-1",
  report_status: "new" as const,
  moderation_flag: "none" as const,
};

describe("student access rules", () => {
  it("requires both the student role and verified status", () => {
    expect(isVerifiedStudent(verifiedStudent)).toBe(true);
    expect(isVerifiedStudent(unverifiedStudent)).toBe(false);
    expect(isVerifiedStudent({ role: "admin", verification_status: "verified" })).toBe(false);
    expect(isVerifiedStudent(null)).toBe(false);
  });

  it("allows a verified student to claim another student's active clean found report", () => {
    expect(canClaimFoundReport(verifiedStudent, foundReport, "claimant-1")).toBe(true);
  });

  it("blocks unverified users, admins and signed-out users from claiming", () => {
    expect(canClaimFoundReport(unverifiedStudent, foundReport, "claimant-1")).toBe(false);
    expect(canClaimFoundReport({ role: "admin", verification_status: "verified" }, foundReport, "admin-1")).toBe(false);
    expect(canClaimFoundReport(verifiedStudent, foundReport, null)).toBe(false);
  });

  it("blocks self-claims and lost reports", () => {
    expect(canClaimFoundReport(verifiedStudent, foundReport, "owner-1")).toBe(false);
    expect(canClaimFoundReport(verifiedStudent, { ...foundReport, type: "Lost" }, "claimant-1")).toBe(false);
  });

  it("blocks closed or flagged found reports", () => {
    expect(canClaimFoundReport(verifiedStudent, { ...foundReport, report_status: "returned" }, "claimant-1")).toBe(false);
    expect(canClaimFoundReport(verifiedStudent, { ...foundReport, moderation_flag: "suspicious" }, "claimant-1")).toBe(false);
    expect(canClaimFoundReport(verifiedStudent, { ...foundReport, moderation_flag: "hidden" }, "claimant-1")).toBe(false);
    expect(canClaimFoundReport(verifiedStudent, { ...foundReport, moderation_flag: "duplicate" }, "claimant-1")).toBe(false);
  });
});
