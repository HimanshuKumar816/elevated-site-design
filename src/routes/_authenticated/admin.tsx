import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import { isAdminProfile } from "@/lib/auth-validation";
import { countReports, filterReports, type AdminReport, type ReportFilter } from "@/lib/admin-reports";

export const Route = createFileRoute("/_authenticated/admin")({
  // UI guard only; real enforcement is RLS + public.is_admin() in the database.
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const { data: profile } = data.user
      ? await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle()
      : { data: null };
    if (!isAdminProfile(profile)) throw redirect({ to: "/browse" });
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

type Row = AdminReport & { image_url?: string | null };

function AdminPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ReportFilter>({ query: "", type: "All", category: "All" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: items, error: itemsError } = await supabase.from("items").select("*").order("created_at", { ascending: false });
      if (itemsError) throw itemsError;
      const ids = [...new Set((items ?? []).map((i) => i.user_id))];
      const { data: profiles, error: pErr } = ids.length
        ? await supabase.from("profiles").select("id,uid,full_name").in("id", ids)
        : { data: [], error: null };
      if (pErr) throw pErr;
      const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
      const merged: Row[] = await Promise.all(
        (items ?? []).map(async (i) => {
          const p = byId.get(i.user_id);
          let image_url: string | null = null;
          if (i.image_path) {
            const { data } = await supabase.storage.from("item-images").createSignedUrl(i.image_path, 3600);
            image_url = data?.signedUrl ?? null;
          }
          return { ...i, note: i.note ?? null, image_path: i.image_path ?? null, submitter_name: p?.full_name ?? null, submitter_uid: p?.uid ?? null, image_url };
        }),
      );
      setRows(merged);
    } catch {
      setError("We couldn't load reports. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = countReports(rows);
  const categories = useMemo(() => ["All", ...new Set(rows.map((r) => r.category))], [rows]);
  const visible = filterReports(rows, filter);
  const input = "rounded-xl border border-input bg-background px-3 py-2.5 text-sm";

  return (
    <Page>
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker text-emerald-800">Administrator</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight">All reports</h1>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-extrabold disabled:opacity-60">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {([["Total", counts.total], ["Lost", counts.lost], ["Found", counts.found]] as const).map(([l, n]) => (
            <div key={l} className="rounded-2xl border border-border bg-card p-5"><p className="text-xs font-extrabold uppercase text-muted-foreground">{l}</p><p className="mt-2 text-3xl font-extrabold">{n}</p></div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <label className="relative flex-1 min-w-56"><span className="sr-only">Search reports</span>
            <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
            <input value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} placeholder="Search item, location, student, UID…" className={`${input} w-full pl-9`} />
          </label>
          <label><span className="sr-only">Type</span><select value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value as ReportFilter["type"] })} className={input}><option>All</option><option>Lost</option><option>Found</option></select></label>
          <label><span className="sr-only">Category</span><select value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} className={input}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold text-destructive">{error}</p>}
        {loading && !rows.length ? <p className="mt-10 text-muted-foreground">Loading reports…</p> : !error && visible.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">{rows.length ? "No reports match these filters." : "No reports have been submitted yet."}</p>
        ) : (
          <div className="mt-6 grid gap-4">
            {visible.map((r) => (
              <article key={r.id} className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[96px_1fr]">
                {r.image_url ? <img src={r.image_url} alt={r.name} className="size-24 rounded-xl object-cover" /> : <div className="grid size-24 place-items-center rounded-xl bg-secondary text-xs text-muted-foreground">No image</div>}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${r.type === "Lost" ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-800"}`}>{r.type}</span>
                    <h2 className="text-lg font-extrabold">{r.name}</h2>
                    <span className="text-sm text-muted-foreground">· {r.category}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{r.location} · item date {r.item_date} · reported {new Date(r.created_at).toLocaleString()}</p>
                  {r.note && <p className="mt-2 text-sm">{r.note}</p>}
                  <p className="mt-2 break-all text-xs text-muted-foreground">Submitted by {r.submitter_name ?? "Unknown"} ({r.submitter_uid ?? "—"}) · user_id {r.user_id}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}
