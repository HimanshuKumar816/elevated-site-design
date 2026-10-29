import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LogOut, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CampusMap } from "@/components/campus-map";
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
  latitude: number | null;
  longitude: number | null;
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

      const { data: pinnedLocations, error: locationError } = await supabase
        .from("item_locations")
        .select("item_id,latitude,longitude");
      if (locationError) throw locationError;
      const locationByItem = new Map(
        (pinnedLocations ?? []).map((pin) => [pin.item_id, { latitude: pin.latitude, longitude: pin.longitude }]),
      );

      const userIds = [...new Set(items.map((item) => item.user_id))];
      const profiles = new Map<string, { uid: string; full_name: string }>();
      // Small batches keep URL/request sizes bounded even if the report list grows.
      for (let offset = 0; offset < userIds.length; offset += PROFILE_BATCH_SIZE) {
        const ids = userIds.slice(offset, offset + PROFILE_BATCH_SIZE);
        const { data, error: profilesError } = await supabase
          .from("profiles")
          .select("id,uid,full_name")
          .in("id", ids);
        if (profilesError) throw profilesError;
        for (const profile of data ?? []) {
          profiles.set(profile.id, { uid: profile.uid, full_name: profile.full_name });
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
          const pin = locationByItem.get(item.id);
          return {
            ...item,
            note: item.note ?? null,
            image_path: item.image_path ?? null,
            submitter_name: profile?.full_name ?? null,
            submitter_uid: profile?.uid ?? null,
            image_url,
            latitude: pin?.latitude ?? null,
            longitude: pin?.longitude ?? null,
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

      setLoginEvents((events ?? []).map((event) => {
        const profile = profilesById.get(event.user_id);
        return {
          ...event,
          full_name: profile?.full_name ?? null,
          uid: profile?.uid ?? null,
          role: profile?.role ?? null,
        };
      }));
    } catch {
      setActivityError("We couldn't load recent sign-ins. Please retry.");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLoginActivity();
  }, [loadLoginActivity]);

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
  const visible = filterReports(rows, filter);
  const campusMarkers = useMemo(() => rows.flatMap((report) => {
    if (report.latitude === null || report.longitude === null) return [];
    return [{
      id: report.id,
      lat: report.latitude,
      lng: report.longitude,
      title: report.name,
      detail: [
        "Status: " + report.type,
        "Category: " + report.category,
        "Location: " + report.location,
        "Date: " + report.item_date,
        "Submitted by " + (report.submitter_name ?? "Unknown") + " (" + (report.submitter_uid ?? "—") + ")",
      ].join(" · "),
      href: `#report-${report.id}`,
    }];
  }), [rows]);
  const input = "rounded-xl border border-input bg-background px-3 py-2.5 text-sm";

  return (
    <div className="page-enter min-h-screen bg-secondary/40">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/admin" className="flex min-w-0 items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-ink text-white shadow-sm">
              <ShieldCheck size={22} />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg font-extrabold leading-tight tracking-tight text-foreground">CampusFind</span>
              <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">Administrator console</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="hidden rounded-full bg-secondary px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-secondary-foreground sm:inline-flex">Restricted access</span>
            <Link to="/" className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-extrabold text-muted-foreground transition hover:bg-secondary hover:text-foreground sm:text-sm">
              Student site <ArrowUpRight size={15} />
            </Link>
            <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white px-3 py-2.5 text-xs font-extrabold text-foreground transition hover:bg-secondary sm:px-4 sm:text-sm">
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main id="main-content" className="min-w-0">
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker text-emerald-800">Administrator</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight">All reports</h1>
            <p className="mt-2 text-sm text-muted-foreground">Read-only view of all lost and found reports.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void load();
              void loadLoginActivity();
              void loadContactMessages();
            }}
            disabled={loading || activityLoading || contactLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-extrabold disabled:opacity-60"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {([["Total", counts.total], ["Lost", counts.lost], ["Found", counts.found]] as const).map(([label, value]) => (
            <div key={label} className="interactive-card rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="text-xs font-extrabold uppercase text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-extrabold">{value}</p>
            </div>
          ))}
        </div>

        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Account activity</p>
              <h2 className="mt-2 text-2xl font-extrabold">Recent sign-ins</h2>
              <p className="mt-1 text-sm text-muted-foreground">The latest 50 successful student and administrator sign-ins.</p>
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
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-secondary/70 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-extrabold sm:px-6">Person</th>
                    <th className="px-5 py-3 font-extrabold">Account type</th>
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
                      <td className="px-5 py-4">
                        <span className={event.role === "admin" ? "rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white" : "rounded-full bg-secondary px-2.5 py-1 text-xs font-bold"}>
                          {event.role === "admin" ? "Administrator" : "Student"}
                        </span>
                      </td>
                      <td className="px-5 py-4">{event.login_method === "otp" ? "SMS OTP" : event.login_method === "signup" ? "Account created" : event.role === "admin" ? "Admin password" : "Password"}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{new Date(event.logged_in_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
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

        <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 p-5 sm:p-6">
            <div>
              <p className="kicker text-emerald-800">Location intelligence</p>
              <h2 className="mt-2 text-2xl font-extrabold">Chandigarh University campus map</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">This campus-only map is restricted to administrators. It displays private coordinates already saved for reports; public users see only the location description they submit.</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-2 text-xs font-extrabold">{campusMarkers.length} pinned reports</span>
          </div>
          <CampusMap mode="viewer" markers={campusMarkers} className="mx-4 mb-4" />
          <p className="px-5 pb-5 text-xs leading-5 text-muted-foreground sm:px-6">Some reports may not have a pin. New public reports collect a written campus landmark instead of exposing a map; pin data appears here only when coordinates are available.</p>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search reports</span>
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input
              value={filter.query}
              onChange={(event) => setFilter((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search item, location, student, UID…"
              className={`${input} w-full pl-9`}
            />
          </label>
          <label>
            <span className="sr-only">Type</span>
            <select
              value={filter.type}
              onChange={(event) => setFilter((current) => ({ ...current, type: event.target.value as ReportFilter["type"] }))}
              className={input}
            >
              <option>All</option><option>Lost</option><option>Found</option>
            </select>
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

        {loading && !rows.length ? (
          <p role="status" className="mt-10 text-muted-foreground">Loading reports…</p>
        ) : !error && visible.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            {rows.length ? "No reports match these filters." : "No reports have been submitted yet."}
          </p>
        ) : (
          <div className="mt-6 grid gap-4">
            {visible.map((report) => (
              <article id={`report-${report.id}`} key={report.id} className="interactive-card grid gap-4 rounded-2xl border border-border bg-card p-5 shadow-soft sm:grid-cols-[96px_1fr]">
                {report.image_url ? (
                  <img src={report.image_url} alt={report.name} loading="lazy" referrerPolicy="no-referrer" className="size-24 rounded-xl object-cover" />
                ) : (
                  <div className="grid size-24 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">No image</div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${report.type === "Lost" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>
                      {report.type}
                    </span>
                    <h2 className="text-lg font-extrabold">{report.name}</h2>
                    <span className="text-sm text-muted-foreground">· {report.category}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {report.location} · item date {report.item_date} · reported {new Date(report.created_at).toLocaleString()}
                  </p>
                  {report.note && <p className="mt-2 text-sm">{report.note}</p>}
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    Submitted by {report.submitter_name ?? "Unknown"} ({report.submitter_uid ?? "—"}) · user_id {report.user_id}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      </main>
    </div>
  );
}
