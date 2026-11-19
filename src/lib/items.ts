export type ReportStatus = "new" | "under_review" | "matched" | "claimed" | "returned" | "closed";
export type ModerationFlag = "none" | "duplicate" | "suspicious" | "hidden";

export type Item = {
  id: string;
  user_id: string;
  type: "Lost" | "Found";
  name: string;
  category: string;
  location: string;
  item_date: string;
  item_time?: string;
  brand?: string;
  color?: string;
  model?: string;
  note: string;
  image_path?: string | null;
  report_status?: ReportStatus;
  moderation_flag?: ModerationFlag;
};

export const CATEGORIES = [
  "Personal Belongings",
  "Electronics & Technology",
  "Study Materials",
  "Clothing & Wearables",
  "Everyday Essentials",
  "Important Documents",
  "Other / Miscellaneous",
] as const;

export type ItemCategory = (typeof CATEGORIES)[number];
