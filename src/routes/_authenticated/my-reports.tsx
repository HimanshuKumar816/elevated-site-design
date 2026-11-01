import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Bell, Check, CheckCheck, ClipboardList, Clock3, PackageCheck, ShieldCheck } from "lucide-react";
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
type OwnStatusEvent = {
  id: string;
  item_id: string;
  previous_status: ReportStatus | null;
  new_status: ReportStatus;
  created_at: string;
};
type OwnNotification = {
  id: string;
  item_id: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
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

const reportStatusSteps: Array<{ status: ReportStatus; label: string }> = [
  { status: "new", label: "Received" },
  { status: "under_review", label: "Review" },
  { status: "matched", label: "Matched" },
  { status: "claimed", label: "Claim approved" },
  { status: "returned", label: "Returned" },
];

const reportNextSteps: Record<ReportStatus, string> = {
  new: "Your report is on the campus board. Check Notifications for possible matches.",
  under_review: "An administrator is reviewing this report. Any status change will appear here.",
  matched: "A possible match has been identified. Keep an eye on Notifications while the details are checked.",
  claimed: "A claim has been approved. Open the Claims tab and follow the handover instructions.",
  returned: "This item is marked as returned. No further action is needed for this report.",
  closed: "This report is closed. Contact the CampusFind team if you believe it should be reopened.",
};

function ReportStatusTimeline({ report, events }: { report: OwnReport; events: OwnStatusEvent[] }) {
  const activeEvents = events.filter((event) => event.new_status !== "closed");
  const lastActiveEvent = activeEvents[activeEvents.length - 1];
  const progressStatus = report.report_status === "closed"
    ? lastActiveEvent?.new_status ?? "new"
    : report.report_status;
  const activeIndex = Math.max(0, reportStatusSteps.findIndex((step) => step.status === progressStatus));

  return (
    <div className="mt-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Report journey</p>
        {report.report_status === "closed" && (
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground">Closed by admin</span>
        )}
      </div>
      <ol aria-label="Report progress" className="mt-4 grid gap-3 sm:grid-cols-5">
        {reportStatusSteps.map((step, index) => {
          const completed = index <= activeIndex;
          const event = [...events].reverse().find((entry) => entry.new_status === step.status);
          const eventDate = event?.created_at ?? (step.status === "new" ? report.created_at : null);
          return (
            <li key={step.status} className="flex min-w-0 items-start gap-3 sm:flex-col sm:gap-2">
              <span className={"grid size-7 shrink-0 place-items-center rounded-full border text-xs font-extrabold " + (completed ? "border-primary bg-primary text-white" : "border-border bg-white text-muted-foreground")}>
                {completed ? <Check size={14} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={"block text-xs font-extrabold " + (completed ? "text-foreground" : "text-muted-foreground")}>{step.label}</span>
                {eventDate && <time dateTime={eventDate} className="mt-1 block text-[10px] leading-4 text-muted-foreground">{dateLabel(eventDate)}</time>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="cf-timeline-guidance mt-4">
        <span>What happens next</span>
        <p>{reportNextSteps[report.report_status]}</p>
      </div>
      {report.report_status === "closed" && (
        <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
          This report is closed and is no longer included in active campus searches. Contact the administrator team if you need it reopened.
        </p>
      )}
    </div>
  );
}

function MyReportsPage() {
  const [reports, setReports] = useState<OwnReport[]>([]);
  const [claims, setClaims] = useState<OwnClaim[]>([]);
  const [statusHistory, setStatusHistory] = useState<Record<string, OwnStatusEvent[]>>({});
  const [notifications, setNotifications] = useState<OwnNotification[]>([]);
  const [notificationError, setNotificationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"reports" | "claims" | "notifications">("reports");
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

      const reportRows = (reportsResult.data ?? []) as OwnReport[];
      const historyByItem: Record<string, OwnStatusEvent[]> = {};
      if (reportRows.length > 0) {
        const { data: historyRows, error: historyError } = await supabase
          .from("item_status_history")
          .select("id,item_id,previous_status,new_status,created_at")
          .in("item_id", reportRows.map((report) => report.id))
          .order("created_at", { ascending: true });
        if (historyError) throw historyError;
        for (const event of (historyRows ?? []) as OwnStatusEvent[]) {
          (historyByItem[event.item_id] ??= []).push(event);
        }
      }

      const { data: notificationRows, error: notificationLoadError } = await supabase
        .from("notifications")
        .select("id,item_id,title,body,created_at,read_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (notificationLoadError) throw notificationLoadError;

      setReports(reportRows);
      setStatusHistory(historyByItem);
      setNotifications((notificationRows ?? []) as OwnNotification[]);
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

  async function markNotificationRead(notificationId: string) {
    setNotificationError("");
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications")
      .update({ read_at: readAt }).eq("id", notificationId).is("read_at", null);
    if (updateError) {
      setNotificationError("We couldn't update this notification. Please try again.");
      return;
    }
    setNotifications((current) => current.map((notification) =>
      notification.id === notificationId ? { ...notification, read_at: readAt } : notification
    ));
  }

  async function markAllNotificationsRead() {
    const unreadIds = notifications.filter((notification) => !notification.read_at).map((notification) => notification.id);
    if (!unreadIds.length) return;
    setNotificationError("");
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications")
      .update({ read_at: readAt }).in("id", unreadIds).is("read_at", null);
    if (updateError) {
      setNotificationError("We couldn't update your notifications. Please try again.");
      return;
    }
    setNotifications((current) => current.map((notification) =>
      notification.read_at ? notification : { ...notification, read_at: readAt }
    ));
  }

  const unreadNotifications = notifications.filter((notification) => !notification.read_at).length;
  const claimsNeedingHandover = claims.filter((claim) => claim.status === "approved").length;

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
        {claimsNeedingHandover > 0 && (
          <button type="button" onClick={() => setActiveTab("claims")} className="cf-handover-alert mt-5 flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-900/10 bg-amber-50 p-4 text-left">
            <span><strong className="block text-sm text-amber-950">{claimsNeedingHandover} approved {claimsNeedingHandover === 1 ? "claim needs" : "claims need"} your attention</strong><span className="mt-1 block text-xs leading-5 text-amber-900">Open Claims to review the next handover step.</span></span>
            <span className="text-xs font-extrabold text-amber-950">View claims <ArrowUpRight size={13} className="ml-1 inline" /></span>
          </button>
        )}

        <div className="cf-workspace-tabs mt-7" role="tablist" aria-label="Your CampusFind workspace">
          <button type="button" role="tab" aria-selected={activeTab === "reports"} aria-controls="my-reports-panel" onClick={() => setActiveTab("reports")} className={activeTab === "reports" ? "cf-workspace-tab is-active" : "cf-workspace-tab"}><ClipboardList size={16} /> Reports <span>{reports.length}</span></button>
          <button type="button" role="tab" aria-selected={activeTab === "claims"} aria-controls="my-claims-panel" onClick={() => setActiveTab("claims")} className={activeTab === "claims" ? "cf-workspace-tab is-active" : "cf-workspace-tab"}><ShieldCheck size={16} /> Claims <span>{claims.length}</span></button>
          <button type="button" role="tab" aria-selected={activeTab === "notifications"} aria-controls="my-notifications-panel" onClick={() => setActiveTab("notifications")} className={activeTab === "notifications" ? "cf-workspace-tab is-active" : "cf-workspace-tab"}><Bell size={16} /> Notifications <span>{unreadNotifications > 0 ? unreadNotifications : "✓"}</span></button>
        </div>

        <section id="my-notifications-panel" role="tabpanel" aria-labelledby="account-notifications-title" tabIndex={0} hidden={activeTab !== "notifications"} className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Bell size={19} /></span>
              <div>
                <p className="kicker text-emerald-800">Account updates</p>
                <h2 id="account-notifications-title" className="mt-1 text-xl font-extrabold">Notifications</h2>
                <p className="mt-1 text-sm text-muted-foreground">{unreadNotifications} unread · Latest 30 updates</p>
              </div>
            </div>
            <button type="button" onClick={() => void markAllNotificationsRead()} disabled={unreadNotifications === 0} className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>
          {notificationError && <p role="alert" className="mx-5 mt-4 rounded-lg bg-destructive/5 p-3 text-xs font-bold text-destructive sm:mx-6">{notificationError}</p>}
          {notifications.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">You're all caught up. Match, claim and report-status updates will appear here.</p>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((notification) => (
                <article key={notification.id} className={"flex flex-wrap items-start justify-between gap-3 p-5 " + (notification.read_at ? "bg-white" : "bg-[#fbf7f6]")}>
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={"mt-1 size-2 shrink-0 rounded-full " + (notification.read_at ? "bg-transparent" : "bg-primary")} aria-label={notification.read_at ? "Read" : "Unread"} />
                    <div className="min-w-0">
                      <h3 className="text-sm font-extrabold text-foreground">{notification.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{notification.body}</p>
                      <time dateTime={notification.created_at} className="mt-2 block text-[11px] text-muted-foreground">{dateLabel(notification.created_at)}</time>
                    </div>
                  </div>
                  {!notification.read_at && <button type="button" onClick={() => void markNotificationRead(notification.id)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-extrabold text-foreground hover:bg-secondary">Mark read</button>}
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="my-reports-panel" role="tabpanel" aria-labelledby="my-reports-title" tabIndex={0} hidden={activeTab !== "reports"} className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Your submissions</p>
              <h2 id="my-reports-title" className="mt-2 text-2xl font-extrabold">Lost and found reports</h2>
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
                      <span className={report.type === "Lost" ? "cf-badge-lost" : "cf-badge-found"}>{report.type}</span>
                      <h3 className="text-lg font-extrabold text-foreground">{report.name}</h3>
                      <span className="text-sm text-muted-foreground">· {report.category}</span>
                    </div>
                    <span className={`cf-status-pill cf-status-${report.report_status}`}>{statusLabels[report.report_status] ?? report.report_status}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{report.location} · Item date {report.item_date}{report.item_time ? ` · ${report.item_time}` : ""}</p>
                  {(report.brand || report.color || report.model) && <p className="mt-1 text-xs font-semibold text-muted-foreground">{[report.brand, report.color, report.model].filter(Boolean).join(" · ")}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Submitted {dateLabel(report.created_at)}</p>
                  {report.moderation_flag !== "none" && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-900">This report has been flagged for administrator review. Contact the CampusFind team if you need help.</p>}
                  <ReportStatusTimeline report={report} events={statusHistory[report.id] ?? []} />
                  {report.note && <p className="mt-3 text-sm leading-6 text-muted-foreground">{report.note}</p>}
                  <p className="mt-3 break-all text-[10px] text-muted-foreground">Report ID: {report.id}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section id="my-claims-panel" role="tabpanel" aria-labelledby="my-claims-title" tabIndex={0} hidden={activeTab !== "claims"} className="mt-5 overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Ownership requests</p>
              <h2 id="my-claims-title" className="mt-2 text-2xl font-extrabold">My item claims</h2>
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
                    <span className={`cf-claim-pill cf-claim-${claim.status}`}>{claimLabels[claim.status]}</span>
                  </div>
                  <div className="mt-4 rounded-lg bg-secondary/60 p-3">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Your private proof</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{claim.proof}</p>
                  </div>
                  {claim.status === "approved" && <p className="mt-3 rounded-lg border border-emerald-900/10 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">Your approval notification contains a one-time 12-character handover code. Show it to a CampusFind administrator in person when the item is handed over. Do not share it in advance.</p>}
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
