import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, ClipboardList, Clock3, PackageCheck, ShieldCheck } from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import type { ModerationFlag, ReportStatus } from "@/lib/items";

export const Route = createFileRoute("/_authenticated/my-reports")({
  head: () => ({
    meta: [
      { title: "My reports — CampusFind" },
      { name: "description", content: "Track your lost and found reports, matches, and item claims." },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth", search: { redirect: "/my-reports" } });
  },
  component: MyReportsPage,
});

type OwnReport = {
  id: string;
  type: "Lost" | "Found";
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
  report_status: ReportStatus;
  moderation_flag: ModerationFlag;
};
type OwnClaim = {
  id: string;
  item_id: string;
  proof: string;
  status: "pending" | "approved" | "rejected" | "completed";
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  item_name: string;
  item_location: string;
  item_category: string | null;
};

const statusLabels: Record<ReportStatus, string> = {
  new: "New",
  under_review: "Under review",
  matched: "Possible match confirmed",
  claimed: "Claim approved",
  returned: "Returned",
  closed: "Closed",
};

const claimLabels: Record<OwnClaim["status"], string> = {
  pending: "Waiting for admin review",
  approved: "Approved — arrange collection",
  rejected: "Not approved",
  completed: "Return completed",
};

function dateLabel(value: string) {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function MyReportsPage() {
  const [reports, setReports] = useState<OwnReport[]>([]);
  const [claims, setClaims] = useState<OwnClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again.");
      const userId = authData.user.id;

      const [reportsResult, claimsResult] = await Promise.all([
        supabase
          .from("items")
          .select("id,type,name,category,location,item_date,item_time,brand,color,model,note,created_at,report_status,moderation_flag")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabase
          .from("item_claims")
          .select("id,item_id,proof,status,admin_note,created_at,reviewed_at,item_name_snapshot,item_location_snapshot,item_category_snapshot")
          .eq("claimant_id", userId)
          .order("created_at", { ascending: false }),
      ]);
      if (reportsResult.error) throw reportsResult.error;
      if (claimsResult.error) throw claimsResult.error;

      const claimRows = claimsResult.data ?? [];
      const itemIds = [...new Set(claimRows.map((claim) => claim.item_id))];
      let itemById = new Map<string, { name: string; location: string }>();
      if (itemIds.length) {
        const { data: claimItems, error: claimItemsError } = await supabase
          .from("items")
          .select("id,name,location")
          .in("id", itemIds);
        if (claimItemsError && claimItemsError.code !== "PGRST116") throw claimItemsError;
        itemById = new Map((claimItems ?? []).map((item) => [item.id, { name: item.name, location: item.location }]));
      }

      setReports((reportsResult.data ?? []) as OwnReport[]);
      setClaims(claimRows.map((claim) => ({
        ...claim,
        item_name: claim.item_name_snapshot ?? itemById.get(claim.item_id)?.name ?? "Found item",
        item_location: claim.item_location_snapshot ?? itemById.get(claim.item_id)?.location ?? "Details unavailable",
        item_category: claim.item_category_snapshot ?? null,
      })) as OwnClaim[]);
    } catch {
      setError("We couldn't load your reports. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    total: reports.length,
    active: reports.filter((report) => !["returned", "closed"].includes(report.report_status)).length,
    claims: claims.length,
  }), [reports, claims]);

  return (
    <Page>
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker text-emerald-800">Your CampusFind account</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-foreground">My reports</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Track reports you submitted and claims you made. Private proof is only visible to you and authorised administrators.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-sm font-extrabold hover:bg-secondary disabled:opacity-60">
              <Clock3 size={16} /> {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground">
              Report an item <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Reports submitted", value: counts.total, icon: ClipboardList },
            { label: "Active reports", value: counts.active, icon: PackageCheck },
            { label: "Claims submitted", value: counts.claims, icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
              <Icon size={19} className="text-emerald-800" />
              <p className="mt-4 text-3xl font-extrabold text-foreground">{value}</p>
              <p className="mt-1 text-xs font-bold text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>

        {error && <div role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold text-destructive">{error}</div>}

        <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Your submissions</p>
              <h2 className="mt-2 text-2xl font-extrabold">Lost and found reports</h2>
              <p className="mt-1 text-sm text-muted-foreground">Each report has its own status and review history.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{reports.length} reports</span>
          </div>
          {loading ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">Loading your reports…</p>
          ) : reports.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-extrabold text-foreground">You haven't submitted a report yet.</p>
              <Link to="/report" className="mt-3 inline-flex items-center gap-2 text-sm font-extrabold text-primary hover:underline">Create your first report <ArrowUpRight size={15} /></Link>
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:p-5">
              {reports.map((report) => (
                <article key={report.id} className="rounded-xl border border-border p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${report.type === "Lost" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>{report.type}</span>
                      <h3 className="text-lg font-extrabold text-foreground">{report.name}</h3>
                      <span className="text-sm text-muted-foreground">· {report.category}</span>
                    </div>
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold">{statusLabels[report.report_status] ?? report.report_status}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{report.location} · Item date {report.item_date}{report.item_time ? ` · ${report.item_time}` : ""}</p>
                  {(report.brand || report.color || report.model) && <p className="mt-1 text-xs font-semibold text-muted-foreground">{[report.brand, report.color, report.model].filter(Boolean).join(" · ")}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Submitted {dateLabel(report.created_at)}</p>
                  {report.moderation_flag !== "none" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900">This report has been flagged for administrator review. Contact the CampusFind team if you need help.</p>}
                  {report.note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{report.note}</p>}
                  <p className="mt-3 break-all text-[10px] text-muted-foreground">Report ID: {report.id}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Ownership requests</p>
              <h2 className="mt-2 text-2xl font-extrabold">My item claims</h2>
              <p className="mt-1 text-sm text-muted-foreground">Claims are reviewed by an administrator. Your proof is private.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{claims.length} claims</span>
          </div>
          {loading ? (
            <p role="status" className="p-6 text-sm text-muted-foreground">Loading claims…</p>
          ) : claims.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">You haven't claimed a found item yet. Browse found reports and submit a claim when you can provide ownership proof.</p>
          ) : (
            <div className="grid gap-3 p-4 sm:p-5">
              {claims.map((claim) => (
                <article key={claim.id} className="rounded-xl border border-border p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-extrabold text-foreground">{claim.item_name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{claim.item_location}{claim.item_category ? ` · ${claim.item_category}` : ""}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Submitted {dateLabel(claim.created_at)}</p>
                    </div>
                    <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold">{claimLabels[claim.status]}</span>
                  </div>
                  <div className="mt-4 rounded-lg bg-secondary/60 p-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Your private proof</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{claim.proof}</p>
                  </div>
                  {claim.admin_note && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900">Admin update: {claim.admin_note}</p>}
                  {claim.reviewed_at && <p className="mt-2 text-xs text-muted-foreground">Reviewed {dateLabel(claim.reviewed_at)}</p>}
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="mt-7">
          <Link to="/browse" className="inline-flex items-center gap-2 text-sm font-extrabold text-primary hover:underline"><ArrowLeft size={16} /> Back to campus reports</Link>
        </div>
      </section>
    </Page>
  );
}
