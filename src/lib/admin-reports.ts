export type AdminReport = {
  id: string;
  user_id: string;
  type: string;
  name: string;
  category: string;
  location: string;
  item_date: string;
  note: string | null;
  created_at: string;
  image_path: string | null;
  submitter_name: string | null;
  submitter_uid: string | null;
};

export type ReportFilter = { query: string; type: "All" | "Lost" | "Found"; category: string };

export function filterReports<T extends AdminReport>(reports: T[], f: ReportFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return reports.filter((r) => {
    if (f.type !== "All" && r.type !== f.type) return false;
    if (f.category !== "All" && r.category !== f.category) return false;
    if (!q) return true;
    return [r.name, r.category, r.location, r.note, r.submitter_name, r.submitter_uid, r.user_id]
      .some((v) => (v ?? "").toLowerCase().includes(q));
  });
}

export function countReports(reports: AdminReport[]) {
  return {
    total: reports.length,
    lost: reports.filter((r) => r.type === "Lost").length,
    found: reports.filter((r) => r.type === "Found").length,
  };
}
