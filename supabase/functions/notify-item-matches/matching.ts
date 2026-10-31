const MATCHABLE_REPORT_STATUSES = new Set(["new", "under_review", "matched"]);

export type MatchEligibility = {
  report_status: string | null;
  moderation_flag: string | null;
};

/**
 * Only current, unflagged reports should participate in student match alerts.
 * This guard is required in the Edge Function because it reads through service_role
 * and therefore does not inherit the caller's item-row visibility policy.
 */
export function isEligibleForMatching(report: MatchEligibility): boolean {
  return (
    report.moderation_flag === "none" &&
    MATCHABLE_REPORT_STATUSES.has(report.report_status ?? "")
  );
}
