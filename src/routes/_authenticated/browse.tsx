import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowUpDown,
  ArrowUpRight,
  Eye,
  Bell,
  Bookmark,
  BookmarkCheck,
  Check,
  MapPin,
  PackageSearch,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES, type Item, type ReportStatus } from "@/lib/items";
import { CAMPUS_LOCATIONS } from "@/lib/campus-locations";
import { canClaimFoundReport } from "@/lib/access";

const PAGE_SIZE = 24;

export const Route = createFileRoute("/_authenticated/browse")({
  head: () => ({
    meta: [
      { title: "Browse lost & found items — CampusFind" },
      { name: "description", content: "Search lost and found reports across campus by item, category and location." },
      { property: "og:title", content: "Browse lost & found items — CampusFind" },
      { property: "og:description", content: "Search lost and found reports across campus." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Browse,
});

type BoardItem = Item & {
  image_url?: string | null;
  report_status?: ReportStatus;
};
type AlertRow = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const statusLabels: Record<ReportStatus, string> = {
  new: "Open report",
  under_review: "Under review",
  matched: "Match confirmed",
  claimed: "Claim in progress",
  returned: "Returned",
  closed: "Closed",
};

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

async function addSignedImages(rows: BoardItem[]): Promise<BoardItem[]> {
  return Promise.all(rows.map(async (item) => {
    if (!item.image_path) return item;
    try {
      const { data, error } = await supabase.storage
        .from("item-images")
        .createSignedUrl(item.image_path, 60 * 60);
      return error || !data?.signedUrl ? item : { ...item, image_url: data.signedUrl };
    } catch {
      return item;
    }
  }));
}

function Browse() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const itemsLengthRef = useRef(0);
  const fetchSequenceRef = useRef(0);
  const [me, setMe] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; uid: string; role: string; verification_status: string } | null>(null);
  const [savedItemIds, setSavedItemIds] = useState<string[]>([]);
  const [savedOnly, setSavedOnly] = useState(false);
  const [locationFilter, setLocationFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState<"All" | "Lost" | "Found">("All");
  const [cat, setCat] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [alertBusy, setAlertBusy] = useState(false);
  const [claimTarget, setClaimTarget] = useState<BoardItem | null>(null);
  const [claimProof, setClaimProof] = useState("");
  const [claimError, setClaimError] = useState("");
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState("");
  const [detailTarget, setDetailTarget] = useState<BoardItem | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const fetchPage = useCallback(async (reset: boolean) => {
    const requestSequence = reset ? fetchSequenceRef.current + 1 : fetchSequenceRef.current;
    if (reset) {
      fetchSequenceRef.current = requestSequence;
      itemsLengthRef.current = 0;
      setLoading(true);
      setLoadingMore(false);
      setError("");
    } else {
      setLoadingMore(true);
    }
    try {
      const offset = reset ? 0 : itemsLengthRef.current;
      const { data, error: queryError } = await supabase.rpc("search_items_v2", {
        ...(q.trim() ? { p_query: q.trim() } : {}),
        p_type: type,
        p_category: cat,
        p_sort: sortBy,
        p_offset: offset,
        p_limit: PAGE_SIZE + 1,
        ...(locationFilter !== "All" ? { p_location: locationFilter } : {}),
        p_status: statusFilter,
        ...(dateFrom ? { p_date_from: dateFrom } : {}),
        ...(dateTo ? { p_date_to: dateTo } : {}),
        p_saved_only: savedOnly,
      });
      if (queryError) throw queryError;
      const returned = (data ?? []) as BoardItem[];
      const nextHasMore = returned.length > PAGE_SIZE;
      const page = await addSignedImages(returned.slice(0, PAGE_SIZE));
      if (requestSequence !== fetchSequenceRef.current) return;
      setHasMore(nextHasMore);
      itemsLengthRef.current = reset ? page.length : itemsLengthRef.current + page.length;
      setItems((current) => reset ? page : [...current, ...page]);
    } catch {
      if (requestSequence === fetchSequenceRef.current) {
        setError("We couldn't load reports. Please check your connection and try again.");
        if (reset) setItems([]);
      }
    } finally {
      if (requestSequence === fetchSequenceRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [q, type, cat, sortBy, locationFilter, statusFilter, dateFrom, dateTo, savedOnly]);

  useEffect(() => {
    const handle = window.setTimeout(() => { void fetchPage(true); }, 250);
    return () => window.clearTimeout(handle);
  }, [fetchPage]);

  useEffect(() => {
    let active = true;
    async function loadAccountDetails() {
      try {
        const { data, error: authError } = await supabase.auth.getUser();
        if (authError || !data.user) return;
        const userId = data.user.id;
        if (active) setMe(userId);

        const [profileResult, alertResult] = await Promise.all([
          supabase.from("profiles").select("full_name,uid,role,verification_status").eq("id", userId).maybeSingle(),
          supabase.from("notifications").select("id,title,body,created_at,read_at")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(10),
        ]);
        if (active && !profileResult.error && profileResult.data) {
          setProfile({
            full_name: profileResult.data.full_name,
            uid: profileResult.data.uid,
            role: profileResult.data.role ?? "student",
            verification_status: profileResult.data.verification_status ?? "unverified",
          });
        }
        if (active && !alertResult.error) setAlerts((alertResult.data ?? []) as AlertRow[]);
        const { data: savedRows, error: savedError } = await supabase
          .from("saved_items").select("item_id").eq("user_id", userId);
        if (active && !savedError) setSavedItemIds((savedRows ?? []).map((row) => row.item_id));
      } catch {
        // An account panel or notification failure does not block public browsing.
      }
    }
    void loadAccountDetails();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
      event.preventDefault();
      document.getElementById("item-search")?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  async function toggleSavedItem(item: BoardItem) {
    setSavedMessage("");
    const isSaved = savedItemIds.includes(item.id);
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again.");
      if (isSaved) {
        const { error } = await supabase.from("saved_items")
          .delete().eq("user_id", authData.user.id).eq("item_id", item.id);
        if (error) throw error;
        setSavedItemIds((current) => current.filter((id) => id !== item.id));
        setSavedMessage("Removed from saved items.");
        if (savedOnly) void fetchPage(true);
      } else {
        const { error } = await supabase.from("saved_items")
          .insert({ user_id: authData.user.id, item_id: item.id });
        if (error && error.code !== "23505") throw error;
        setSavedItemIds((current) => current.includes(item.id) ? current : [...current, item.id]);
        setSavedMessage("Saved to your list.");
      }
    } catch {
      setSavedMessage("We couldn't update saved items. Please try again.");
    }
  }

  async function markRead(id: string) {
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications")
      .update({ read_at: readAt }).eq("id", id).is("read_at", null);
    if (!updateError) setAlerts((current) => current.map((alert) => alert.id === id ? { ...alert, read_at: readAt } : alert));
  }

  async function markAllRead() {
    const unread = alerts.filter((alert) => !alert.read_at).map((alert) => alert.id);
    if (!unread.length || alertBusy) return;
    setAlertBusy(true);
    const readAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("notifications")
      .update({ read_at: readAt }).in("id", unread).is("read_at", null);
    if (!updateError) setAlerts((current) => current.map((alert) => alert.read_at ? alert : { ...alert, read_at: readAt }));
    setAlertBusy(false);
  }

  function openClaim(item: BoardItem) {
    setClaimTarget(item);
    setClaimProof("");
    setClaimError("");
    setClaimSuccess("");
  }

  async function submitClaim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!claimTarget || claimBusy) return;
    const proof = claimProof.trim();
    if (proof.length < 20 || proof.length > 1500) {
      setClaimError("Please provide 20–1,500 characters explaining how you can prove ownership.");
      return;
    }
    setClaimBusy(true);
    setClaimError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Please sign in again.");
      const { error: insertError } = await supabase.from("item_claims").insert({
        item_id: claimTarget.id,
        claimant_id: authData.user.id,
        proof,
      });
      if (insertError) {
        if (insertError.code === "23505") {
          throw new Error("You already have a pending claim for this item.");
        }
        throw insertError;
      }
      setClaimSuccess("Your private claim was sent to the CampusFind administrators for review.");
      setClaimTarget(null);
      setClaimProof("");
    } catch (cause) {
      setClaimError(cause instanceof Error && cause.message.includes("pending claim")
        ? cause.message
        : "We couldn't submit the claim. Please check the details and try again.");
    } finally {
      setClaimBusy(false);
    }
  }

  useEffect(() => {
    if (!detailTarget && !claimTarget && !lightboxImage) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleDialogKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDetailTarget(null);
        setClaimTarget(null);
        setLightboxImage(null);
      }
    }
    window.addEventListener("keydown", handleDialogKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleDialogKey);
    };
  }, [detailTarget, claimTarget, lightboxImage]);

  const unreadCount = alerts.filter((alert) => !alert.read_at).length;
  const lostCount = items.filter((item) => item.type === "Lost").length;
  const foundCount = items.filter((item) => item.type === "Found").length;
  const pill = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-sm font-extrabold transition ${active
      ? "border-primary bg-primary text-primary-foreground shadow-sm"
      : "border-border bg-white text-muted-foreground hover:bg-secondary"}`;

  const shown = useMemo(() => items, [items]);

  return (
    <Page>
      <section className="student-workspace mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        {profile?.role === "student" && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white px-5 py-4 shadow-sm">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Signed in as</p>
              <p className="mt-1 text-lg font-extrabold text-foreground">{profile.full_name}</p>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Student UID</p>
              <p className="mt-1 font-mono text-sm font-extrabold text-foreground">{profile.uid}</p>
              {profile.verification_status === "verified" ? (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-800"><ShieldCheck size={13} /> Verified CU student</p>
              ) : (
                <p className="mt-1 text-[11px] font-semibold text-muted-foreground">Identity verification not completed</p>
              )}
              {profile.verification_status !== "verified" && <p className="mt-2 text-[11px] leading-5 text-muted-foreground">You can browse reports now. Reporting and claiming unlock after administrator verification.</p>}
            </div>
            <Link to="/my-reports" className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-3 py-2 text-xs font-extrabold text-primary hover:bg-secondary">
              My reports <ArrowUpRight size={14} />
            </Link>
          </div>
        )}

        <div className="student-workspace-hero relative overflow-hidden rounded-[2rem] bg-gradient-ink px-6 py-9 text-ink-foreground sm:px-10 sm:py-12 lg:px-14 lg:py-14">
          <div className="pointer-events-none absolute -right-10 -top-24 size-72 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <p className="kicker text-emerald-200">Campus report board</p>
              <h1 className="mt-4 text-4xl font-extrabold leading-tight text-white sm:text-5xl">Lost something? Start here.</h1>
              <p className="mt-4 max-w-xl leading-7 text-white/70">Search campus reports with common item names and spelling variations. Keep one identifying detail private until ownership is verified.</p>
            </div>
            <Link to="/report" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-primary transition hover:bg-emerald-200">
              Add a report <ArrowUpRight size={17} />
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><PackageSearch size={20} /></span>
            <div><p className="text-2xl font-extrabold tracking-tight">{items.length}</p><p className="text-xs font-bold text-muted-foreground">Reports loaded</p></div>
          </div>
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-800"><Search size={20} /></span>
            <div><p className="text-2xl font-extrabold tracking-tight">{lostCount}</p><p className="text-xs font-bold text-muted-foreground">Lost reports loaded</p></div>
          </div>
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Check size={20} /></span>
            <div><p className="text-2xl font-extrabold tracking-tight">{foundCount}</p><p className="text-xs font-bold text-muted-foreground">Found reports loaded</p></div>
          </div>
        </div>

        {claimSuccess && (
          <div role="status" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-900/10 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
            <span>{claimSuccess}</span>
            <Link to="/my-reports" className="underline underline-offset-4">Track your claim</Link>
          </div>
        )}

        {alerts.length > 0 && (
          <section aria-label="Match notifications" className="mt-8 rounded-2xl border border-emerald-900/10 bg-emerald-50/70 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-white text-emerald-800 shadow-sm"><Bell size={19} /></span>
                <div><h2 className="text-lg font-extrabold tracking-tight">Your match alerts</h2><p className="mt-1 text-sm text-muted-foreground">Updates about reports that may match yours.</p></div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald-900 px-3 py-1.5 text-xs font-extrabold text-white">{unreadCount} unread</span>
                {unreadCount > 0 && <button type="button" disabled={alertBusy} onClick={() => void markAllRead()} className="rounded-lg border border-emerald-900/20 bg-white px-3 py-2 text-xs font-extrabold text-emerald-900 hover:bg-emerald-50 disabled:opacity-60">{alertBusy ? "Updating…" : "Mark all read"}</button>}
              </div>
            </div>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {alerts.map((alert) => (
                <li key={alert.id} className={`rounded-xl border border-emerald-900/10 bg-white p-4 ${alert.read_at ? "opacity-70" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Bell size={15} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold text-foreground">{alert.title}</p>
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-extrabold">{alert.read_at ? "Read" : "Unread"}</span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{alert.body}</p>
                      <p className="mt-2 text-xs text-muted-foreground">{new Date(alert.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                    {!alert.read_at && <button type="button" onClick={() => void markRead(alert.id)} aria-label={`Mark alert as read: ${alert.title}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-emerald-800 transition hover:bg-emerald-50"><Check size={16} /></button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {savedMessage && <p role="status" className="mt-4 rounded-xl border border-border bg-white px-4 py-3 text-sm font-semibold text-muted-foreground">{savedMessage}</p>}

        <div className="mt-8 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="item-search" className="mb-2 block text-xs font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Search reports</label>
          <div className="flex items-center gap-3 rounded-xl border border-input bg-background px-4 transition focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-ring/10">
            <Search size={19} className="shrink-0 text-muted-foreground" />
            <input id="item-search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Try “purse”, “mobile”, “libary”, or “black bottle”…" className="min-h-12 w-full border-0 bg-transparent text-sm outline-none ring-0 placeholder:text-muted-foreground/70 focus:ring-0" />
            {!q && <kbd aria-hidden="true" className="hidden rounded-md border border-border bg-white px-2 py-1 text-xs font-extrabold text-muted-foreground sm:block">/</kbd>}
            {q && <button type="button" onClick={() => setQ("")} className="shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold text-primary hover:bg-secondary">Clear</button>}
          </div>
          <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-2 xl:grid-cols-4 md:items-end">
            <div>
              <span className="mb-2 inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"><SlidersHorizontal size={14} /> Item type</span>
              <div className="flex flex-wrap items-center gap-2">
                {(["All", "Lost", "Found"] as const).map((value) => (
                  <button type="button" key={value} onClick={() => setType(value)} aria-pressed={type === value} className={pill(type === value)}>{value === "All" ? "All reports" : value + " items"}</button>
                ))}
              </div>
            </div>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Category
              <select aria-label="Filter by category" value={cat} onChange={(event) => setCat(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-ring/10">
                <option value="All">All categories</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"><span className="inline-flex items-center gap-2"><ArrowUpDown size={14} /> Sort by</span>
              <select aria-label="Sort reports" value={sortBy} onChange={(event) => setSortBy(event.target.value as "newest" | "oldest" | "name")} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-ring/10">
                <option value="newest">Newest item date</option><option value="oldest">Oldest item date</option><option value="name">Name A–Z</option>
              </select>
            </label>
          </div>
          <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Campus area
              <select aria-label="Filter by campus area" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground">
                <option value="All">All campus areas</option>{CAMPUS_LOCATIONS.map((location) => <option key={location}>{location}</option>)}
              </select>
            </label>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Report status
              <select aria-label="Filter by report status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground">
                <option value="All">All statuses</option>
                <option value="new">New</option><option value="under_review">Under review</option><option value="matched">Matched</option><option value="claimed">Claim in progress</option><option value="returned">Returned</option><option value="closed">Closed</option>
              </select>
            </label>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">From date
              <input aria-label="Filter reports from date" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold normal-case tracking-normal text-foreground" />
            </label>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">To date
              <input aria-label="Filter reports to date" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-semibold normal-case tracking-normal text-foreground" />
            </label>
          </div>
          {(q || type !== "All" || cat !== "All" || locationFilter !== "All" || statusFilter !== "All" || dateFrom || dateTo || savedOnly) && (
            <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Active filters">
              <span className="text-xs font-bold text-muted-foreground">Active:</span>
              {q && <button type="button" onClick={() => setQ("")} className="cf-filter-chip">Search: {q} <X size={12} /></button>}
              {type !== "All" && <button type="button" onClick={() => setType("All")} className="cf-filter-chip">{type} items <X size={12} /></button>}
              {cat !== "All" && <button type="button" onClick={() => setCat("All")} className="cf-filter-chip">{cat} <X size={12} /></button>}
              {locationFilter !== "All" && <button type="button" onClick={() => setLocationFilter("All")} className="cf-filter-chip">{locationFilter} <X size={12} /></button>}
              {statusFilter !== "All" && <button type="button" onClick={() => setStatusFilter("All")} className="cf-filter-chip">{statusLabels[statusFilter as ReportStatus]} <X size={12} /></button>}
              {dateFrom && <button type="button" onClick={() => setDateFrom("")} className="cf-filter-chip">From {dateFrom} <X size={12} /></button>}
              {dateTo && <button type="button" onClick={() => setDateTo("")} className="cf-filter-chip">To {dateTo} <X size={12} /></button>}
              {savedOnly && <button type="button" onClick={() => setSavedOnly(false)} className="cf-filter-chip">Saved only <X size={12} /></button>}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly((value) => !value)} className={pill(savedOnly)}>
              {savedOnly ? "Showing saved items" : "Show saved items only"} · {savedItemIds.length}
            </button>
            <span className="text-xs text-muted-foreground">Saved items are private to your account.</span>
          </div>
        </div>

        {error && <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><span>{error}</span><button type="button" onClick={() => void fetchPage(true)} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-extrabold transition hover:bg-destructive/10"><RefreshCw size={15} /> Try again</button></div>}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Recent reports</h2><p className="mt-1 text-sm text-muted-foreground">{loading ? "Searching the campus board…" : `Showing ${shown.length} loaded results`}</p></div>
          <div className="flex items-center gap-2">
            {(q || type !== "All" || cat !== "All" || locationFilter !== "All" || statusFilter !== "All" || dateFrom || dateTo || savedOnly) && <button type="button" onClick={() => { setQ(""); setType("All"); setCat("All"); setLocationFilter("All"); setStatusFilter("All"); setDateFrom(""); setDateTo(""); setSavedOnly(false); }} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-extrabold text-muted-foreground transition hover:bg-secondary hover:text-foreground">Clear filters</button>}
            {!loading && <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold text-secondary-foreground"><span className="inline-block size-2 rounded-full bg-emerald-500 mr-2" /> Search ready</span>}
          </div>
        </div>

        {loading && <div role="status" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="cf-skeleton-card p-4"><div className="aspect-[16/10] rounded-xl bg-secondary" /><div className="mt-4 h-4 w-1/3 rounded bg-secondary" /><div className="mt-3 h-6 w-2/3 rounded bg-secondary" /><div className="mt-3 h-3 w-1/2 rounded bg-secondary" /></div>)}</div>}

        {!loading && shown.length > 0 && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((item) => {
              const reportStatus = item.report_status ?? "new";
              const canClaim = canClaimFoundReport(profile, { ...item, report_status: reportStatus }, me);
              return (
                <article key={item.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5">
                  <div className="relative aspect-[16/10] overflow-hidden bg-secondary">
                    {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-primary/70"><PackageSearch size={38} strokeWidth={1.5} /><span className="text-[10px] font-extrabold uppercase tracking-[0.2em]">Campus report</span></div>}
                    <span className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] shadow-sm ${item.type === "Found" ? "cf-badge-found" : "cf-badge-lost"}`}>{item.type}</span>
                    <span className="absolute bottom-3 right-3 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-extrabold text-foreground shadow-sm">{item.category}</span>
                  </div>
                  <div className="flex flex-1 flex-col p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="line-clamp-2 text-xl font-extrabold leading-snug tracking-tight text-foreground">{item.name}</h3>
                      <span className="mt-1 shrink-0 rounded-lg bg-secondary px-2 py-1 text-[10px] font-extrabold text-muted-foreground">{dateLabel(item.item_date)}</span>
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-sm font-bold text-muted-foreground"><MapPin size={15} className="shrink-0 text-emerald-800" /><span className="truncate">{item.location}</span></p>
                    {(item.brand || item.color || item.model) && <p className="mt-2 text-xs font-semibold text-muted-foreground">{[item.brand, item.color, item.model].filter(Boolean).join(" · ")}</p>}
                    {item.item_time && <p className="mt-1 text-xs text-muted-foreground">Approx. time: {item.item_time}</p>}
                    {item.note && <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{item.note}</p>}
                    <div className="mt-auto pt-5">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                        <span className={`cf-status-pill cf-status-${reportStatus}`}>{statusLabels[reportStatus]}</span>
                        <button type="button" onClick={() => setDetailTarget(item)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-extrabold text-foreground hover:bg-secondary"><Eye size={14} /> Details</button>
                        <button type="button" aria-pressed={savedItemIds.includes(item.id)} aria-label={savedItemIds.includes(item.id) ? "Remove saved item" : "Save item"} onClick={() => void toggleSavedItem(item)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs font-extrabold text-primary hover:bg-secondary">
                          {savedItemIds.includes(item.id) ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                          {savedItemIds.includes(item.id) ? "Saved" : "Save"}
                        </button>
                        {canClaim && <button type="button" onClick={() => openClaim(item)} className="rounded-xl bg-primary px-3 py-2 text-xs font-extrabold text-primary-foreground hover:bg-primary/90">This is mine — claim item</button>}
                        {item.user_id === me && <Link to="/my-reports" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-extrabold text-primary hover:bg-secondary">Track report <ArrowUpRight size={13} /></Link>}
                      </div>
                      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-700" /> Ownership claims are reviewed privately by a CampusFind administrator.</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && shown.length === 0 && !error && (
          <div className="mt-5 rounded-3xl border border-dashed border-border bg-white px-6 py-14 text-center sm:py-20">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-primary"><PackageSearch size={27} /></span>
            <h3 className="mt-5 text-xl font-extrabold tracking-tight">{q || type !== "All" || cat !== "All" ? "No reports match that search" : "Start the board with a report"}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Try a synonym, check the spelling, clear filters, or create a new report.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground">Create a report <ArrowUpRight size={16} /></Link>
              <button type="button" onClick={() => { setQ(""); setType("All"); setCat("All"); }} className="rounded-xl border border-border px-4 py-3 text-sm font-extrabold hover:bg-secondary">Clear filters</button>
            </div>
          </div>
        )}

        {!loading && hasMore && (
          <div className="mt-8 text-center">
            <button type="button" onClick={() => void fetchPage(false)} disabled={loadingMore} className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-sm font-extrabold text-foreground shadow-sm hover:bg-secondary disabled:opacity-60">
              <RefreshCw size={15} className={loadingMore ? "animate-spin" : ""} /> {loadingMore ? "Loading more…" : "Load more reports"}
            </button>
          </div>
        )}
      </section>

      {detailTarget && (
        <div className="cf-dialog-backdrop fixed inset-0 z-[75] flex items-center justify-center p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetailTarget(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="item-detail-title" className="cf-item-dialog max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={detailTarget.type === "Found" ? "cf-badge-found" : "cf-badge-lost"}>{detailTarget.type}</span>
                  <span className="cf-category-chip">{detailTarget.category}</span>
                  <span className={`cf-status-pill cf-status-${detailTarget.report_status ?? "new"}`}>{statusLabels[detailTarget.report_status ?? "new"]}</span>
                </div>
                <h2 id="item-detail-title" className="mt-3 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{detailTarget.name}</h2>
                <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MapPin size={15} className="shrink-0 text-primary" /> {detailTarget.location}</p>
              </div>
              <button type="button" onClick={() => setDetailTarget(null)} className="grid size-10 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Close item details"><X size={18} /></button>
            </div>
            <div className="grid gap-5 p-5 sm:grid-cols-[.9fr_1.1fr] sm:p-6">
              <div className="overflow-hidden rounded-xl bg-secondary">
                {detailTarget.image_url ? <button type="button" onClick={() => setLightboxImage(detailTarget.image_url ?? null)} className="group relative block min-h-48 w-full cursor-zoom-in bg-secondary" aria-label={`View ${detailTarget.name} photograph full screen`}><img src={detailTarget.image_url} alt={detailTarget.name} className="max-h-[360px] min-h-48 w-full object-contain" /><span className="absolute bottom-3 right-3 rounded-lg bg-ink/80 px-3 py-2 text-xs font-bold text-white opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">View full image</span></button> : <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-muted-foreground"><PackageSearch size={42} strokeWidth={1.5} /><span className="text-xs font-bold">No photograph was added</span></div>}
              </div>
              <div className="min-w-0">
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-background p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Item date</dt><dd className="mt-1 text-sm font-bold text-foreground">{dateLabel(detailTarget.item_date)}</dd></div>
                  <div className="rounded-lg bg-background p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Approx. time</dt><dd className="mt-1 text-sm font-bold text-foreground">{detailTarget.item_time || "Not provided"}</dd></div>
                  <div className="rounded-lg bg-background p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Brand</dt><dd className="mt-1 text-sm font-bold text-foreground">{detailTarget.brand || "Not provided"}</dd></div>
                  <div className="rounded-lg bg-background p-3"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Colour</dt><dd className="mt-1 text-sm font-bold text-foreground">{detailTarget.color || "Not provided"}</dd></div>
                  <div className="rounded-lg bg-background p-3 sm:col-span-2"><dt className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">Model</dt><dd className="mt-1 text-sm font-bold text-foreground">{detailTarget.model || "Not provided"}</dd></div>
                </dl>
                <div className="mt-4"><p className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">Public description</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-foreground">{detailTarget.note || "The reporter did not add a public description."}</p></div>
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">A possible match is not proof of ownership. Keep unique identifying details private and let the administrator review claims.</p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border p-5 sm:p-6">
              <button type="button" onClick={() => setDetailTarget(null)} className="rounded-lg border border-border px-4 py-2.5 text-sm font-extrabold hover:bg-secondary">Close</button>
              {canClaimFoundReport(profile, { ...detailTarget, report_status: detailTarget.report_status ?? "new" }, me) && <button type="button" onClick={() => { openClaim(detailTarget); setDetailTarget(null); }} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-extrabold text-white">Submit ownership claim</button>}
              {detailTarget.user_id === me && <Link to="/my-reports" onClick={() => setDetailTarget(null)} className="rounded-lg bg-secondary px-4 py-2.5 text-sm font-extrabold text-foreground">Track my report</Link>}
            </div>
          </section>
        </div>
      )}

      {lightboxImage && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/95 p-3 sm:p-8" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setLightboxImage(null); }}>
          <section role="dialog" aria-modal="true" aria-label="Full-size item photograph" className="relative flex h-full w-full items-center justify-center">
            <button type="button" onClick={() => setLightboxImage(null)} className="absolute right-1 top-1 z-10 inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black/50 px-3 py-2 text-sm font-bold text-white hover:bg-black/70" aria-label="Close full-size image"><X size={17} /> Close</button>
            <img src={lightboxImage} alt="Full-size item photograph" className="max-h-full max-w-full object-contain" />
          </section>
        </div>
      )}

      {claimTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/65 p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="claim-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div><p className="kicker text-emerald-800">Private ownership claim</p><h2 id="claim-title" className="mt-2 text-2xl font-extrabold">Claim {claimTarget.name}</h2><p className="mt-2 text-sm text-muted-foreground">{claimTarget.location} · {claimTarget.category}</p></div>
              <button type="button" onClick={() => { setClaimTarget(null); setClaimError(""); }} className="grid size-9 place-items-center rounded-lg hover:bg-secondary" aria-label="Close claim form"><X size={18} /></button>
            </div>
            <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">Describe a detail that proves the item belongs to you. Do not publish this proof on the report board. Only you and authorised administrators can read it.</p>
            <form onSubmit={submitClaim} className="mt-5">
              <label htmlFor="claim-proof" className="block text-sm font-extrabold text-foreground">Private proof of ownership</label>
              <textarea id="claim-proof" required minLength={20} maxLength={1500} rows={5} value={claimProof} onChange={(event) => setClaimProof(event.target.value)} placeholder="Describe a unique detail, contents, mark, serial details, or other evidence only the owner would know." className="mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm leading-6 outline-none focus:border-primary" />
              <p className="mt-1 text-xs text-muted-foreground">{claimProof.trim().length}/1,500 characters · minimum 20</p>
              {claimError && <p role="alert" className="mt-3 rounded-xl bg-destructive/5 p-3 text-sm font-bold text-destructive">{claimError}</p>}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setClaimTarget(null)} className="rounded-xl border border-border px-4 py-2.5 text-sm font-extrabold hover:bg-secondary">Cancel</button>
                <button type="submit" disabled={claimBusy} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground disabled:opacity-60">{claimBusy ? "Submitting…" : "Send private claim"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </Page>
  );
}
