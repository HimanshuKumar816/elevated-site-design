import type { Item } from "@/lib/items";

export type StudentAccessProfile = {
  role?: unknown;
  verification_status?: unknown;
} | null | undefined;

export type ClaimableFoundReport = Pick<Item, "type" | "user_id"> &
  Partial<Pick<Item, "report_status" | "moderation_flag">>;

export function isVerifiedStudent(profile: StudentAccessProfile): boolean {
  return profile?.role === "student" && profile.verification_status === "verified";
}

export function canClaimFoundReport(
  profile: StudentAccessProfile,
  item: ClaimableFoundReport,
  currentUserId: string | null,
): boolean {
  return (
    isVerifiedStudent(profile) &&
    currentUserId !== null &&
    item.type === "Found" &&
    item.user_id !== currentUserId &&
    ["new", "under_review", "matched"].includes(item.report_status ?? "new") &&
    (item.moderation_flag ?? "none") === "none"
  );
}
