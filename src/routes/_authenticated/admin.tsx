import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LogOut, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isAdminProfile } from "@/lib/auth-validation";
import { countReports, filterReports, type AdminReport, type ReportFilter } from "@/lib/admin-reports";

const PAGE_SIZE = 500;
const PROFILE_BATCH_SIZE = 100;

export const Route = createFileRoute("/_authenticated/admin")({
  // Client-side route guard improves UX; profile RLS and the trusted role column
  // remain the source of truth and prevent non-admin profile enumeration.
  beforeLoad: async () => {
    let allowed = false;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (!userError && userData.user) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userData.user.id)
          .maybeSingle();
        allowed = !profileError && isAdminProfile(profile);
      }
    } catch {
      allowed = false;
    }
    if (!allowed) throw redirect({ to: "/browse" });
  },
  head: () => ({
    meta: [
      { title: "Administrator dashboard — CampusFind" },
      { name: "description", content: "Read-only moderation view of all CampusFind lost and found reports." },
      { property: "og:title", content: "Administrator dashboard — CampusFind" },
      { property: "og:description", content: "Moderation dashboard for campus lost and found reports." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

type Row = AdminReport & {
  image_url?: string | null;
  submitter_role: string | null;
};

type ContactMessage = {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  created_at: string;
};

type LoginActivity = {
  id: string;
  user_id: string;
  login_method: string;
  logged_in_at: string;
  full_name: string | null;
  uid: string | null;
  role: string | null;
};

type MatchItem = {
  id: string;
  user_id: string;
  type: "Lost" | "Found";
  name: string;
  category: string;
  location: string;
  item_date: string;
  note: string | null;
  created_at: string;
  image_url: string | null;
  submitter_name: string | null;
  submitter_uid: string | null;
};

type ItemMatch = {
  id: string;
  matched_at: string;
  lost: MatchItem;
  found: MatchItem;
};

function AdminPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ReportFilter>({ query: "", type: "All", category: "All" });
  const [loginEvents, setLoginEvents] = useState<LoginActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesError, setMatchesError] = useState("");
  const [contactMessages, setContactMessages] = useState<ContactMessage[]>([]);
  const [contactLoading, setContactLoading] = useState(true);
  const [contactError, setContactError] = useState("");

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } catch {
      // Clear this browser cache even if the remote logout request fails.
    }
    queryClient.clear();
    navigate({ to: "/admin-login", replace: true });
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Read in pages rather than silently stopping at the PostgREST row limit.
      const items: Array<{
        id: string;
        user_id: string;
        type: string;
        name: string;
        category: string;
        location: string;
        item_date: string;
        note: string;
        created_at: string;
        image_path: string | null;
      }> = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: itemsError } = await supabase
          .from("items")
          .select("*")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (itemsError) throw itemsError;
        const page = data ?? [];
        items.push(...page);
        if (page.length < PAGE_SIZE) break;
      }

      const userIds = [...new Set(items.map((item) => item.user_id))];
      const profiles = new Map<string, { uid: string; full_name: string; role: string }>();
      // Small batches keep URL/request sizes bounded even if the report list grows.
      for (let offset = 0; offset < userIds.length; offset += PROFILE_BATCH_SIZE) {
        const ids = userIds.slice(offset, offset + PROFILE_BATCH_SIZE);
        const { data, error: profilesError } = await supabase
          .from("profiles")
          .select("id,uid,full_name,role")
          .in("id", ids);
        if (profilesError) throw profilesError;
        for (const profile of data ?? []) {
          profiles.set(profile.id, { uid: profile.uid, full_name: profile.full_name, role: profile.role });
        }
      }

      const merged: Row[] = await Promise.all(
        items.map(async (item) => {
          const profile = profiles.get(item.user_id);
          let image_url: string | null = null;
          if (item.image_path) {
            try {
              const { data, error: imageError } = await supabase.storage
                .from("item-images")
                .createSignedUrl(item.image_path, 60 * 60);
              if (!imageError) image_url = data?.signedUrl ?? null;
            } catch {
              // An unavailable image should not hide the underlying report.
              image_url = null;
            }
          }
          return {
            ...item,
            note: item.note ?? null,
            image_path: item.image_path ?? null,
            submitter_name: profile?.full_name ?? null,
            submitter_uid: profile?.uid ?? null,
            submitter_role: profile?.role ?? null,
            image_url,
          };
        }),
      );
      setRows(merged);
    } catch {
      setError("We couldn't load reports. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLoginActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError("");
    try {
      const { data: events, error: eventsError } = await supabase
        .from("login_events")
        .select("id,user_id,login_method,logged_in_at")
        .order("logged_in_at", { ascending: false })
        .limit(50);
      if (eventsError) throw eventsError;

      const userIds = [...new Set((events ?? []).map((event) => event.user_id))];
      const profilesById = new Map<string, { full_name: string; uid: string; role: string }>();
      if (userIds.length) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,uid,full_name,role")
          .in("id", userIds);
        if (profilesError) throw profilesError;
        for (const profile of profiles ?? []) {
          profilesById.set(profile.id, {
            full_name: profile.full_name,
            uid: profile.uid,
            role: profile.role,
          });
        }
      }

      const activity = (events ?? []).map((event) => {
        const profile = profilesById.get(event.user_id);
        return {
          ...event,
          full_name: profile?.full_name ?? null,
          uid: profile?.uid ?? null,
          role: profile?.role ?? null,
        };
      });
      // Hide any historical administrator events from before admin logging was disabled.
      setLoginEvents(activity.filter((event) => event.role === "student"));
    } catch {
      setActivityError("We couldn't load recent sign-ins. Please retry.");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLoginActivity();
  }, [loadLoginActivity]);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchesError("");
    try {
      // Match alerts are stored as two mirrored notifications (one per reporter).
      // Deduplicate them into one Lost-versus-Found pair for the admin console.
      const { data: notifications, error: notificationsError } = await supabase
        .from("notifications")
        .select("id,item_id,matched_item_id,created_at")
        .not("matched_item_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (notificationsError) throw notificationsError;

      const pairMap = new Map<string, { itemIds: [string, string]; matched_at: string }>();
      for (const notification of notifications ?? []) {
        if (!notification.item_id || !notification.matched_item_id) continue;
        const sortedIds = [notification.item_id, notification.matched_item_id].sort() as [string, string];
        const pairKey = sortedIds.join(":");
        if (!pairMap.has(pairKey)) pairMap.set(pairKey, { itemIds: sortedIds, matched_at: notification.created_at });
      }

      const itemIds = [...new Set([...pairMap.values()].flatMap((pair) => pair.itemIds))];
      if (itemIds.length === 0) {
        setMatches([]);
        return;
      }

      const { data: itemRows, error: itemsError } = await supabase
        .from("items")
        .select("id,user_id,type,name,category,location,item_date,note,created_at,image_path")
        .in("id", itemIds);
      if (itemsError) throw itemsError;

      const userIds = [...new Set((itemRows ?? []).map((item) => item.user_id))];
      const profilesById = new Map<string, { full_name: string; uid: string }>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from("profiles")
          .select("id,full_name,uid")
          .in("id", userIds);
        if (profilesError) throw profilesError;
        for (const profile of profiles ?? []) profilesById.set(profile.id, { full_name: profile.full_name, uid: profile.uid });
      }

      const enrichedItems = await Promise.all((itemRows ?? []).map(async (item) => {
        let image_url: string | null = null;
        if (item.image_path) {
          try {
            const { data, error: imageError } = await supabase.storage
              .from("item-images")
              .createSignedUrl(item.image_path, 60 * 60);
            if (!imageError) image_url = data?.signedUrl ?? null;
          } catch {
            image_url = null;
          }
        }
        const profile = profilesById.get(item.user_id);
        return {
          ...item,
          type: item.type as "Lost" | "Found",
          note: item.note ?? null,
          image_url,
          submitter_name: profile?.full_name ?? null,
          submitter_uid: profile?.uid ?? null,
        } satisfies MatchItem;
      }));
      const itemsById = new Map(enrichedItems.map((item) => [item.id, item]));

      const result: ItemMatch[] = [];
      for (const [pairKey, pair] of pairMap) {
        const first = itemsById.get(pair.itemIds[0]);
        const second = itemsById.get(pair.itemIds[1]);
        if (!first || !second || first.type === second.type) continue;
        result.push({
          id: pairKey,
          matched_at: pair.matched_at,
          lost: first.type === "Lost" ? first : second,
          found: first.type === "Found" ? first : second,
        });
      }
      result.sort((a, b) => new Date(b.matched_at).getTime() - new Date(a.matched_at).getTime());
      setMatches(result);
    } catch {
      setMatchesError("We couldn't load possible item matches. Please retry.");
    } finally {
      setMatchesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  const loadContactMessages = useCallback(async () => {
    setContactLoading(true);
    setContactError("");
    try {
      const { data, error: messagesError } = await supabase
        .from("contact_messages")
        .select("id,name,email,subject,message,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (messagesError) throw messagesError;
      setContactMessages((data ?? []) as ContactMessage[]);
    } catch {
      setContactError("We couldn't load contact messages. Please retry.");
    } finally {
      setContactLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContactMessages();
  }, [loadContactMessages]);

  const counts = countReports(rows);
  const categories = useMemo(() => ["All", ...new Set(rows.map((report) => report.category))], [rows]);
  const input = "rounded-xl border border-input bg-background px-3 py-2.5 text-sm";

  const visibleLost = filterReports(rows.filter((report) => report.type === "Lost"), { ...filter, type: "All" });
  const visibleFound = filterReports(rows.filter((report) => report.type === "Found"), { ...filter, type: "All" });

  const renderReportCard = (report: Row) => (
    <article id={`report-${report.id}`} key={report.id} className="interactive-card grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-[96px_1fr]">
      {report.image_url ? (
        <img src={report.image_url} alt={report.name} loading="lazy" referrerPolicy="no-referrer" className="size-24 rounded-xl object-cover" />
      ) : (
        <div className="grid size-24 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">No image</div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${report.type === "Lost" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>{report.type}</span>
          <h3 className="text-lg font-extrabold">{report.name}</h3>
          <span className="text-sm text-muted-foreground">· {report.category}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{report.location} · item date {report.item_date} · reported {new Date(report.created_at).toLocaleString()}</p>
        {report.note && <p className="mt-2 text-sm">{report.note}</p>}
        <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs leading-6 text-muted-foreground">
          <p><span className="font-extrabold text-foreground">Reported by:</span> {report.submitter_name ?? "Unknown"} · UID {report.submitter_uid ?? "—"}</p>
          <p><span className="font-extrabold text-foreground">Account:</span> {report.submitter_role === "admin" ? "Administrator" : report.submitter_role === "student" ? "Student" : "Unknown"}</p>
          <p className="break-all"><span className="font-extrabold text-foreground">Report reference:</span> {report.id}</p>
        </div>
      </div>
    </article>
  );

  const renderReportSection = (title: string, reports: Row[], emptyText: string) => (
    <section className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div>
          <p className="kicker text-emerald-800">Report management</p>
          <h2 className="mt-2 text-2xl font-extrabold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Separate from student login activity.</p>
        </div>
        <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{reports.length} reports</span>
      </div>
      {loading && <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading reports…</p>}
      {!loading && !error && reports.length === 0 && (
        <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">
          {rows.length ? emptyText : title === "Lost reports" ? "No lost items have been reported yet." : "No found items have been reported yet."}
        </p>
      )}
      {!error && reports.length > 0 && (
        <div className="grid gap-4 border-t border-border p-4 sm:p-5">{reports.map(renderReportCard)}</div>
      )}
    </section>
  );

  const renderMatchItem = (label: "Lost item" | "Found item", item: MatchItem) => (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${label === "Lost item" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>
          {label === "Lost item" ? "Lost" : "Found"}
        </span>
      </div>
      <div className="mt-3 flex items-start gap-3">
        {item.image_url ? (
          <img src={item.image_url} alt={item.name} loading="lazy" className="size-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] text-muted-foreground">No image</div>
        )}
        <div className="min-w-0">
          <h3 className="font-extrabold text-foreground">{item.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{item.category} · {item.location}</p>
          <p className="mt-1 text-xs text-muted-foreground">Item date {item.item_date}</p>
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        <p>Reported by <span className="font-extrabold text-foreground">{item.submitter_name ?? "Unknown"}</span></p>
        <p>UID {item.submitter_uid ?? "—"}</p>
        <p className="break-all">Report ID {item.id}</p>
      </div>
    </div>
  );

  const renderMatchesSection = (
    <section className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
        <div>
          <p className="kicker text-emerald-800">Matching system</p>
          <h2 className="mt-2 text-2xl font-extrabold">Item matches found</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Possible matches between Lost and Found reports. These are system suggestions for administrator review, not confirmed handovers.</p>
        </div>
        <button type="button" onClick={() => void loadMatches()} disabled={matchesLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
          {matchesLoading ? "Refreshing…" : "Refresh matches"}
        </button>
      </div>
      {matchesError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{matchesError}</p>}
      {matchesLoading ? (
        <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Checking possible matches…</p>
      ) : matches.length === 0 ? (
        <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No possible Lost/Found matches have been identified yet.</p>
      ) : (
        <div className="grid gap-4 border-t border-border p-4 sm:p-5 lg:grid-cols-2">
          {matches.map((match) => (
            <article key={match.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-extrabold text-amber-900">Possible match</span>
                <time className="text-xs text-muted-foreground" dateTime={match.matched_at}>Found {new Date(match.matched_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {renderMatchItem("Lost item", match.lost)}
                {renderMatchItem("Found item", match.found)}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="admin-shell page-enter min-h-screen">
      <header className="admin-topbar sticky top-0 z-40 border-b backdrop-blur-xl">
        <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/admin" className="flex min-w-0 items-center gap-3">
            <span className="admin-brand-icon grid size-11 shrink-0 place-items-center rounded-2xl shadow-sm">
              <ShieldCheck size={22} />
            </span>
            <span className="min-w-0">
              <span className="admin-brand-title block font-display text-lg font-extrabold leading-tight tracking-tight">CampusFind</span>
              <span className="admin-brand-subtitle mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.16em]">Administrator console</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="admin-access-pill hidden rounded-full px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] sm:inline-flex">Restricted access</span>
            <Link to="/browse" className="admin-utility-link inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-extrabold transition sm:text-sm">
              Student site <ArrowUpRight size={15} />
            </Link>
            <button type="button" onClick={() => void signOut()} className="admin-signout inline-flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-extrabold transition sm:px-4 sm:text-sm">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="min-w-0">
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="admin-dashboard-header flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker admin-kicker">Administrator workspace</p>
            <h1 className="admin-dashboard-title mt-2 text-4xl font-extrabold tracking-tight">Control room</h1>
            <p className="admin-dashboard-subtitle mt-2 text-sm leading-6">Lost and found reports, student sign-ins and possible item matches are shown in separate sections.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void load();
              void loadLoginActivity();
              void loadMatches();
              void loadContactMessages();
            }}
            disabled={loading || activityLoading || matchesLoading || contactLoading}
            className="admin-refresh-button inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {([["Total", counts.total], ["Lost", counts.lost], ["Found", counts.found]] as const).map(([label, value]) => (
            <div key={label} className="admin-stat-card interactive-card rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="admin-stat-label text-xs font-extrabold uppercase">{label}</p>
              <p className="admin-stat-value mt-2 text-3xl font-extrabold">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search reports</span>
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input value={filter.query} onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))} placeholder="Search item, location, student, UID…" className={`${input} w-full pl-9`} />
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select value={filter.category} onChange={(event) => setFilter((current) => ({ ...current, category: event.target.value }))} className={input}>
              {categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
        </div>

        {error && (
          <div role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold text-destructive">
            <p>{error}</p>
            <button type="button" onClick={() => void load()} className="mt-2 underline underline-offset-4">Try again</button>
          </div>
        )}

        {renderReportSection("Lost reports", visibleLost, "No lost-item reports match these filters.")}
        {renderReportSection("Found reports", visibleFound, "No found-item reports match these filters.")}


        <section className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Account activity</p>
              <h2 className="mt-2 text-2xl font-extrabold">Recent sign-ins</h2>
              <p className="mt-1 text-sm text-muted-foreground">Student account activity only. Administrator sign-ins are not recorded.</p>
            </div>
            <button type="button" onClick={() => void loadLoginActivity()} disabled={activityLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
              {activityLoading ? "Refreshing…" : "Refresh activity"}
            </button>
          </div>
          {activityError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{activityError}</p>}
          {activityLoading ? (
            <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading sign-in activity…</p>
          ) : loginEvents.length === 0 ? (
            <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No successful sign-ins have been recorded yet. New logins will appear here.</p>
          ) : (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-extrabold sm:px-6">Person</th>
                    <th className="px-5 py-3 font-extrabold">Method</th>
                    <th className="px-5 py-3 font-extrabold">Signed in</th>
                  </tr>
                </thead>
                <tbody>
                  {loginEvents.map((event) => (
                    <tr key={event.id} className="border-t border-border align-top">
                      <td className="px-5 py-4 sm:px-6">
                        <p className="font-extrabold">{event.full_name ?? "Unknown account"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">UID {event.uid ?? "—"}</p>
                      </td>
                      <td className="px-5 py-4">{event.login_method === "otp" ? "SMS OTP" : event.login_method === "signup" ? "Account created" : "Password"}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{new Date(event.logged_in_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {renderMatchesSection}

        <section className="admin-panel mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Contact inbox</p>
              <h2 className="mt-2 text-2xl font-extrabold">Messages from the website</h2>
              <p className="mt-1 text-sm text-muted-foreground">Only authenticated administrators can read these messages.</p>
            </div>
            <button type="button" onClick={() => void loadContactMessages()} disabled={contactLoading} className="rounded-xl border border-border bg-white px-3 py-2 text-sm font-extrabold disabled:opacity-60">
              {contactLoading ? "Refreshing…" : "Refresh inbox"}
            </button>
          </div>
          {contactError && <p role="alert" className="mx-5 mb-4 rounded-xl bg-destructive/5 p-3 text-sm text-destructive sm:mx-6">{contactError}</p>}
          {contactLoading ? (
            <p role="status" className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">Loading contact messages…</p>
          ) : contactMessages.length === 0 ? (
            <p className="mx-5 mb-5 rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground sm:mx-6">No contact messages have been received yet.</p>
          ) : (
            <div className="grid gap-3 border-t border-border p-4 sm:p-5">
              {contactMessages.map((message) => (
                <article key={message.id} className="interactive-card rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-extrabold text-foreground">{message.subject}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">From {message.name} · <a className="font-bold text-primary underline-offset-2 hover:underline" href={"mailto:" + message.email}>{message.email}</a></p>
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{message.message}</p>
                </article>
              ))}
            </div>
          )}
        </section>


      </section>
      </main>
    </div>
  );
}
