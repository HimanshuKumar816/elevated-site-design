import { describe, expect, it } from "vitest";
import { isEligibleForMatching } from "./matching";

describe("match notification eligibility", () => {
  it.each(["new", "under_review", "matched"])(
    "allows active unflagged reports in the %s state",
    (report_status) => {
      expect(isEligibleForMatching({ report_status, moderation_flag: "none" })).toBe(true);
    },
  );

  it.each(["claimed", "returned", "closed", "unknown", null])(
    "rejects reports in the %s state",
    (report_status) => {
      expect(isEligibleForMatching({ report_status, moderation_flag: "none" })).toBe(false);
    },
  );

  it.each(["duplicate", "suspicious", "hidden", null])(
    "rejects reports with the %s moderation flag",
    (moderation_flag) => {
      expect(isEligibleForMatching({ report_status: "new", moderation_flag })).toBe(false);
    },
  );
});
