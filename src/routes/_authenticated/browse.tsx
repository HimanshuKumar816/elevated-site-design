import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ArrowUpRight, Bell, Check, MapPin, PackageSearch, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES, type Item } from "@/lib/items";

export const Route = createFileRoute("/_authenticated/browse")({
  head: () => ({
    meta: [
      { title: "Browse lost & found items — CampusFind" },
      { name: "description", content: "Search lost and found reports across campus by item, category and location." },
      { property: "og:title", content: "Browse lost & found items — CampusFind" },
      { property: "og:description", content: "Search lost and found reports across campus." },
    ],
  }),
  component: Browse,
});

function Browse() {
  const [items, setItems] = useState<(Item & { image_url?: string })[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; uid: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState<"All" | "Lost" | "Found">("All");
  const [cat, setCat] = useState("All");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [alerts, setAlerts] = useState<Array<{ id: string; title: string; body: string; created_at: string; read_at: string | null }>>([]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const { data, error: queryError } = await supabase
        .from("items")
        .select("*")
        .order("created_at", { ascending: false });
      if (queryError) throw queryError;
      const rows = (data ?? []) as Item[];
      // Image storage is optional: one expired or inaccessible image URL must
      // not make the entire lost-and-found board disappear.
      const withImages = await Promise.all(rows.map(async (item) => {
        if (!item.image_path) return item;
        try {
          const { data: signed, error: signedUrlError } = await supabase.storage
            .from("item-images")
            .createSignedUrl(item.image_path, 60 * 60);
          return signedUrlError || !signed?.signedUrl
            ? item
            : { ...item, image_url: signed.signedUrl };
        } catch {
          return item;
        }
      }));
      setItems(withImages);
    } catch {
      setItems(null);
      setError("We couldn't load reports. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    supabase.auth.getUser().then(async ({ data }) => {
      const userId = data.user?.id ?? null;
      setMe(userId);
      if (!userId) return;
      try {
        const { data: profileRow, error: profileError } = await supabase
          .from("profiles")
          .select("full_name,uid")
          .eq("id", userId)
          .maybeSingle();
        if (!profileError && profileRow) {
          setProfile({ full_name: profileRow.full_name, uid: profileRow.uid });
        }
      } catch {
        // Profile details are optional UI data; auth and browsing remain available.
      }
      try {
        const { data: notificationRows, error: notificationError } = await supabase
          .from("notifications")
          .select("id,title,body,created_at,read_at")
          .order("created_at", { ascending: false })
          .limit(10);
        if (!notificationError) setAlerts((notificationRows ?? []) as typeof alerts);
      } catch {
        // A notification failure should not prevent item browsing.
      }
    }).catch(() => {
      // If auth lookup is temporarily unavailable, keep the public shell usable.
      setMe(null);
    });
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

  async function markRead(id: string) {
    const { error: updateError } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    if (!updateError) setAlerts((current) => current.map((alert) => alert.id === id ? { ...alert, read_at: new Date().toISOString() } : alert));
  }

  async function remove(id: string) {
    setRemovingId(id);
    setError("");
    try {
      const { error: deleteError } = await supabase.from("items").delete().eq("id", id);
      if (deleteError) throw deleteError;
      await load();
    } catch {
      setError("We couldn't remove that report. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }

  const shown = useMemo(() => {
    const filtered = (items ?? []).filter(
      (item) =>
        (type === "All" || item.type === type) &&
        (cat === "All" || item.category === cat) &&
        `${item.name} ${item.location} ${item.note}`.toLowerCase().includes(q.toLowerCase()),
    );

    return filtered.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const dateA = new Date(a.item_date).getTime();
      const dateB = new Date(b.item_date).getTime();
      return sortBy === "newest" ? dateB - dateA : dateA - dateB;
    });
  }, [items, q, type, cat, sortBy]);

  const pill = (on: boolean) => `rounded-full px-4 py-2 text-sm transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`;

  return (
    <Page>
      <section className="student-workspace mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        {profile && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-white px-5 py-4 shadow-sm">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Signed in as</p>
              <p className="mt-1 text-lg font-extrabold text-foreground">{profile.full_name}</p>
            </div>
            <div className="rounded-xl bg-secondary px-4 py-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Student UID</p>
              <p className="mt-1 font-mono text-sm font-extrabold text-foreground">{profile.uid}</p>
            </div>
          </div>
        )}
        <div className="student-workspace-hero relative overflow-hidden rounded-[2rem] bg-gradient-ink px-6 py-9 text-ink-foreground sm:px-10 sm:py-12 lg:px-14 lg:py-14">
          <div className="pointer-events-none absolute -right-10 -top-24 size-72 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl"><p className="kicker text-emerald-200">Campus report board</p><h1 className="mt-4 text-4xl font-extrabold leading-tight text-white sm:text-5xl">Lost something? Start here.</h1><p className="mt-4 max-w-xl leading-7 text-white/70">Search reports, narrow by category, and compare details. Keep one identifying detail private until you're ready to verify a claim.</p></div>
            <Link to="/report" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-primary transition hover:bg-emerald-200">Add a report <ArrowUpRight size={17} /></Link>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4"><span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><PackageSearch size={20} /></span><div><p className="text-2xl font-extrabold tracking-tight">{items?.length ?? "—"}</p><p className="text-xs font-bold text-muted-foreground">Reports on the board</p></div></div>
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4"><span className="grid size-10 place-items-center rounded-xl bg-amber-50 text-amber-800"><Search size={20} /></span><div><p className="text-2xl font-extrabold tracking-tight">{items?.filter((item) => item.type === "Lost").length ?? "—"}</p><p className="text-xs font-bold text-muted-foreground">Lost reports</p></div></div>
          <div className="surface-card flex items-center gap-3 rounded-2xl p-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Check size={20} /></span><div><p className="text-2xl font-extrabold tracking-tight">{items?.filter((item) => item.type === "Found").length ?? "—"}</p><p className="text-xs font-bold text-muted-foreground">Found reports</p></div></div>
        </div>

        {alerts.length > 0 && <section aria-label="Match notifications" className="mt-8 rounded-2xl border border-emerald-900/10 bg-emerald-50/70 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-white text-emerald-800 shadow-sm"><Bell size={19} /></span><div><h2 className="text-lg font-extrabold tracking-tight">Your match alerts</h2><p className="mt-1 text-sm text-muted-foreground">Updates about reports that may match yours.</p></div></div><span className="rounded-full bg-emerald-900 px-3 py-1.5 text-xs font-extrabold text-white">{alerts.filter((alert) => !alert.read_at).length} unread</span></div><ul className="mt-4 grid gap-3 md:grid-cols-2">{alerts.map((alert) => <li key={alert.id} className={`rounded-xl border border-emerald-900/10 bg-white p-4 ${alert.read_at ? "opacity-70" : ""}`}><div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Bell size={15} /></span><div className="min-w-0 flex-1"><p className="font-extrabold text-foreground">{alert.title}</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{alert.body}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(alert.created_at).toLocaleString()}</p></div>{!alert.read_at && <button type="button" onClick={() => markRead(alert.id)} aria-label={`Mark alert as read: ${alert.title}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-emerald-800 transition hover:bg-emerald-50"><Check size={16} /></button>}</div></li>)}</ul></section>}

        <div className="mt-8 rounded-2xl border border-border bg-white p-4 shadow-sm sm:p-5">
          <label htmlFor="item-search" className="mb-2 block text-xs font-extrabold uppercase tracking-[0.14em] text-muted-foreground">Search reports</label>
          <div className="flex items-center gap-3 rounded-xl border border-input bg-background px-4 transition focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-ring/10"><Search size={19} className="shrink-0 text-muted-foreground" /><input id="item-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Try “wallet”, “library”, or “black bottle”…" className="min-h-12 w-full border-0 bg-transparent text-sm outline-none ring-0 placeholder:text-muted-foreground/70 focus:ring-0" />{!q && <kbd aria-hidden="true" className="hidden rounded-md border border-border bg-white px-2 py-1 text-xs font-extrabold text-muted-foreground sm:block">/</kbd>}{q && <button type="button" onClick={() => setQ("")} className="shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold text-primary hover:bg-secondary">Clear</button>}</div>
          <div className="mt-4 grid gap-4 border-t border-border pt-4 md:grid-cols-[1.2fr_1fr_1fr] md:items-end">
            <div>
              <span className="mb-2 inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"><SlidersHorizontal size={14} /> Item status</span>
              <div className="flex flex-wrap items-center gap-2">{(["All", "Lost", "Found"] as const).map((t) => <button type="button" key={t} onClick={() => setType(t)} aria-pressed={type === t} className={`rounded-xl border px-3 py-2 text-sm font-extrabold transition ${type === t ? "border-primary bg-primary text-primary-foreground shadow-sm" : "border-border bg-white text-muted-foreground hover:bg-secondary"}`}>{t === "All" ? "All reports" : t + " items"}</button>)}</div>
            </div>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">Category
              <select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-ring/10"><option value="All">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="block text-xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"><span className="inline-flex items-center gap-2"><ArrowUpDown size={14} /> Sort by</span>
              <select aria-label="Sort reports" value={sortBy} onChange={(e) => setSortBy(e.target.value as "newest" | "oldest" | "name")} className="mt-2 min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-extrabold normal-case tracking-normal text-foreground outline-none focus:border-primary/40 focus:ring-4 focus:ring-ring/10"><option value="newest">Newest item date</option><option value="oldest">Oldest item date</option><option value="name">Name A–Z</option></select>
            </label>
          </div>
        </div>

        {error && <div role="alert" className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><span>{error}</span><button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 font-extrabold transition hover:bg-destructive/10"><RefreshCw size={15} /> Try again</button></div>}

        <div className="mt-8 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Recent reports</h2><p className="mt-1 text-sm text-muted-foreground">{loading ? "Loading the latest reports…" : `Showing ${shown.length} of ${items?.length ?? 0} reports`}</p></div><div className="flex items-center gap-2">{(q || type !== "All" || cat !== "All") && <button type="button" onClick={() => { setQ(""); setType("All"); setCat("All"); }} className="rounded-xl border border-border bg-white px-3 py-2 text-xs font-extrabold text-muted-foreground transition hover:bg-secondary hover:text-foreground">Clear filters</button>}{items && <p className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-extrabold text-secondary-foreground"><span className="size-2 rounded-full bg-emerald-500" /> Board loaded</p>}</div></div>

        {loading && <div role="status" className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((n) => <div key={n} className="animate-pulse rounded-2xl border border-border bg-white p-4"><div className="aspect-[16/10] rounded-xl bg-secondary" /><div className="mt-4 h-4 w-1/3 rounded bg-secondary" /><div className="mt-3 h-6 w-2/3 rounded bg-secondary" /><div className="mt-3 h-3 w-1/2 rounded bg-secondary" /></div>)}</div>}

        {!loading && items && shown.length > 0 && <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((i) => <article key={i.id} className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5"><div className="relative aspect-[16/10] overflow-hidden bg-secondary">{i.image_url ? <img src={i.image_url} alt={i.name} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top_right,oklch(0.87_0.11_157_/_0.45),transparent_38%),linear-gradient(140deg,oklch(0.96_0.01_245),oklch(0.92_0.025_245))] text-primary/70"><PackageSearch size={38} strokeWidth={1.5} /><span className="text-[10px] font-extrabold uppercase tracking-[0.2em]">Campus report</span></div>}<span className={`absolute left-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] shadow-sm ${i.type === "Found" ? "bg-emerald-300 text-emerald-950" : "bg-white text-primary"}`}>{i.type}</span><span className="absolute bottom-3 right-3 rounded-full border border-white/70 bg-white/90 px-3 py-1.5 text-xs font-extrabold text-foreground shadow-sm">{i.category}</span></div><div className="flex flex-1 flex-col p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><h3 className="line-clamp-2 text-xl font-extrabold leading-snug tracking-tight text-foreground">{i.name}</h3><span className="mt-1 shrink-0 rounded-lg bg-secondary px-2 py-1 text-[10px] font-extrabold text-muted-foreground">{new Date(i.item_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span></div><p className="mt-3 flex items-center gap-2 text-sm font-bold text-muted-foreground"><MapPin size={15} className="shrink-0 text-emerald-800" /><span className="truncate">{i.location}</span></p>{i.note && <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{i.note}</p>}<div className="mt-auto pt-5"><div className="flex items-center justify-between border-t border-border pt-4"><span className="text-xs font-bold text-muted-foreground">{i.type === "Found" ? "Reported as found" : "Reported as lost"}</span>{i.user_id === me && <button type="button" disabled={removingId === i.id} onClick={() => remove(i.id)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-extrabold text-muted-foreground transition hover:bg-destructive/5 hover:text-destructive disabled:opacity-50"><Trash2 size={14} /> {removingId === i.id ? "Removing…" : "Remove"}</button>}</div><p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-700" /> Compare details and verify ownership before arranging a handoff.</p></div></div></article>)}</div>}

        {!loading && items && shown.length === 0 && <div className="mt-5 rounded-3xl border border-dashed border-border bg-white px-6 py-14 text-center sm:py-20"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-primary"><PackageSearch size={27} /></span><h3 className="mt-5 text-xl font-extrabold tracking-tight">{items.length === 0 ? "Start the board with a report" : "No reports match those filters"}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{items.length === 0 ? "There are no reports yet. Add the first report and give another student a place to start looking." : "Try another search term, clear the filters, or browse a different category."}</p><div className="mt-5 flex flex-wrap justify-center gap-3">{items.length === 0 ? <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground">Create a report <ArrowUpRight size={16} /></Link> : <button type="button" onClick={() => { setQ(""); setType("All"); setCat("All"); }} className="rounded-xl border border-border px-4 py-3 text-sm font-extrabold hover:bg-secondary">Clear filters</button>}</div></div>}
      </section>
    </Page>
  );
}
