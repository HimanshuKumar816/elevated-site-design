export type Item = { id: string; user_id: string; type: "Lost" | "Found"; name: string; category: string; location: string; item_date: string; note: string };

export const CATEGORIES = ["ID card", "Wallet", "Keys", "Electronics", "Books", "Bottle", "Documents", "Other"];
