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
  note: string;
  image_path?: string | null;
  report_status?: ReportStatus;
  moderation_flag?: ModerationFlag;
};

export const CATEGORIES = [
  "ID card",
  "Wallet",
  "Keys",
  "Electronics",
  "Books",
  "Bottle",
  "Documents",
  "Bag",
  "Clothing",
  "Accessories",
  "Other",
];
