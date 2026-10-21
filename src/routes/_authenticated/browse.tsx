import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  const [items, setItems] = useState<Item[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<"All" | "Lost" | "Found">("All");
  const [cat, setCat] = useState("All");

  async function load() {
    const { data } = await supabase.from("items").select("*").order("created_at", { ascending: false });
    setItems((data ?? []) as Item[]);
  }
  useEffect(() => {
    load();
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
  }, []);

  async function remove(id: string) {
    await supabase.from("items").delete().eq("id", id);
    load();
  }

  const shown = useMemo(
    () => (items ?? []).filter((i) => (type === "All" || i.type === type) && (cat === "All" || i.category === cat) && `${i.name} ${i.location} ${i.note}`.toLowerCase().includes(q.toLowerCase())),
    [items, q, type, cat],
  );

  const pill = (on: boolean) => `rounded-full px-4 py-2 text-sm transition-colors ${on ? "bg-primary text-primary-foreground" : "bg-card border border-border hover:bg-secondary"}`;

  return (
    <Page>
      <section className="mx-auto max-w-6xl px-6 py-20">
        <p className="kicker text-muted-foreground">Live board</p>
        <h1 className="mt-4 text-6xl">Browse items</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by item, place or detail…" className="mt-10 w-full rounded-2xl border border-input bg-card px-6 py-4 text-lg outline-none focus:ring-2 focus:ring-ring" />
        <div className="mt-4 flex flex-wrap gap-2">
          {(["All", "Lost", "Found"] as const).map((t) => <button key={t} onClick={() => setType(t)} className={pill(type === t)}>{t}</button>)}
          <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-full border border-border bg-card px-4 py-2 text-sm">
            <option>All</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <article key={i.id} className="rounded-2xl border border-border bg-card p-6 shadow-soft">
              <div className="flex items-center justify-between">
                <span className={`kicker rounded-full px-3 py-1 ${i.type === "Found" ? "bg-accent/25 text-foreground" : "bg-primary text-primary-foreground"}`}>{i.type}</span>
                <span className="text-xs text-muted-foreground">{i.item_date}</span>
              </div>
              <h2 className="mt-5 text-3xl">{i.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{i.category} · {i.location}</p>
              {i.note && <p className="mt-4 text-sm">{i.note}</p>}
              {i.user_id === me && <button onClick={() => remove(i.id)} className="mt-4 text-xs text-muted-foreground underline hover:text-destructive">Remove my report</button>}
            </article>
          ))}
        </div>
        {items && shown.length === 0 && (
          <p className="mt-6 text-muted-foreground">{items.length === 0 ? <>No reports yet. <Link to="/report" className="underline">Be the first to report an item.</Link></> : "No items match your search."}</p>
        )}
      </section>
    </Page>
  );
}
