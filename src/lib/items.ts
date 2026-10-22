export type Item = { id: string; user_id: string; type: "Lost" | "Found"; name: string; category: string; location: string; item_date: string; note: string; image_path?: string | null };

export const CATEGORIES = ["ID card", "Wallet", "Keys", "Electronics", "Books", "Bottle", "Documents", "Other"];
