export type Item = { id: string; type: "Lost" | "Found"; name: string; category: string; location: string; date: string; note: string };

export const CATEGORIES = ["ID card", "Wallet", "Keys", "Electronics", "Books", "Bottle", "Documents", "Other"];

export const SAMPLE_ITEMS: Item[] = [
  { id: "1", type: "Found", name: "Black leather wallet", category: "Wallet", location: "Central Library, 2nd floor", date: "2026-10-20", note: "Handed to library desk." },
  { id: "2", type: "Lost", name: "Student ID card", category: "ID card", location: "Main canteen", date: "2026-10-20", note: "Blue lanyard attached." },
  { id: "3", type: "Found", name: "Wireless earphones case", category: "Electronics", location: "Block C, Room 204", date: "2026-10-19", note: "White case. Kept at security office." },
  { id: "4", type: "Lost", name: "Set of 3 keys", category: "Keys", location: "Sports ground", date: "2026-10-18", note: "Small keychain attached." },
  { id: "5", type: "Found", name: "Steel water bottle", category: "Bottle", location: "Lecture Hall 1", date: "2026-10-18", note: "Has stickers on it." },
  { id: "6", type: "Lost", name: "Data Structures textbook", category: "Books", location: "Bus stop near Gate 2", date: "2026-10-17", note: "Name written inside the cover." },
];
