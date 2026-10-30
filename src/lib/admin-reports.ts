import { matchesSearch } from "@/lib/search";

export type AdminReport = {
  id: string;
  user_id: string;
  type: string;
  name: string;
  category: string;
  location: string;
  item_date: string;
  item_time?: string;
  brand?: string;
  color?: string;
  model?: string;
  note: string | null;
  created_at: string;
  image_path: string | null;
  submitter_name: string | null;
  submitter_uid: string | null;
};

export type ReportFilter = { query: string; type: "All" | "Lost" | "Found"; category: string };

export function filterReports<T extends AdminReport>(reports: T[], f: ReportFilter): T[] {
  const q = f.query.trim();
  return reports.filter((report) => {
    if (f.type !== "All" && report.type !== f.type) return false;
    if (f.category !== "All" && report.category !== f.category) return false;
    if (!q) return true;
    const searchable = [
      report.name,
      report.category,
      report.location,
      report.note ?? "",
      report.submitter_name ?? "",
      report.submitter_uid ?? "",
    ].join(" ");
    return matchesSearch(q, searchable);
  });
}

export function countReports(reports: AdminReport[]) {
  return {
    total: reports.length,
    lost: reports.filter((report) => report.type === "Lost").length,
    found: reports.filter((report) => report.type === "Found").length,
  };
}
