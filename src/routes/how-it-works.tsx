import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Compass, EyeOff, PackageSearch, Search, ShieldCheck, Users } from "lucide-react";
import { Page } from "@/components/site";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How CampusFind works — CampusFind" },
      { name: "description", content: "How CampusFind helps students report items, search potential matches, and verify ownership before arranging a return." },
      { property: "og:title", content: "How CampusFind works" },
      { property: "og:description", content: "A clearer process for returning belongings around campus." },
    ],
    links: [{ rel: "canonical", href: "https://campusfind-uir0.onrender.com/how-it-works" }],
  }),
  component: How,
});

const phases = [
  { title: "Report clearly", label: "01", description: "Add the item name, category, date, and nearest campus landmark. A photo can help others recognise it.", icon: PackageSearch },
  { title: "Search the board", label: "02", description: "Browse lost and found reports, search descriptions and places, and narrow results with filters.", icon: Search },
  { title: "Compare details", label: "03", description: "A potential match is a lead—not proof. Compare the details and keep a private identifying detail for verification.", icon: EyeOff },
  { title: "Arrange a safe return", label: "04", description: "Once ownership is reasonably verified, agree on a clear campus handoff point and return the item.", icon: ShieldCheck },
];
const principles = [
  { title: "Useful, not overwhelming", description: "Structured fields make reports easier to scan and compare.", icon: Compass },
  { title: "Privacy comes first", description: "Keep the one detail that proves ownership out of the public description.", icon: EyeOff },
  { title: "Community powered", description: "Each clear report gives other students a better place to begin.", icon: Users },
];

function How() {
  return (
    <Page>
      <section className="relative isolate overflow-hidden"><div className="hero-grid absolute inset-0 -z-10" /><div className="mx-auto max-w-7xl px-5 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-16"><nav aria-label="Breadcrumb" className="mb-7 text-sm text-muted-foreground"><Link to="/" className="font-bold text-primary hover:underline">Home</Link><span className="px-2" aria-hidden="true">/</span><span aria-current="page">How it works</span></nav><p className="kicker text-emerald-800">The process</p><h1 className="mt-4 max-w-4xl text-4xl font-extrabold leading-tight text-foreground sm:text-6xl">Designed to make the next step obvious.</h1><p className="mt-5 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">CampusFind brings scattered lost-and-found information into one clear journey—from a report to a verified return.</p><div className="mt-7 flex flex-wrap gap-3"><Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-md transition hover:-translate-y-0.5">Report an item <ArrowRight size={16} /></Link><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl border border-border bg-white px-5 py-3 text-sm font-extrabold text-foreground hover:bg-secondary">Browse the board</Link></div></div></section>
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16"><div className="grid gap-4 md:grid-cols-2">{phases.map(({ title, label, description, icon: Icon }) => <article key={label} className="group rounded-3xl border border-border bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 sm:p-8"><div className="flex items-center justify-between"><span className="text-xs font-extrabold tracking-[0.18em] text-muted-foreground/70">{label} / 04</span><span className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary transition group-hover:bg-emerald-100 group-hover:text-emerald-900"><Icon size={23} /></span></div><h2 className="mt-7 text-2xl font-extrabold tracking-tight">{title}</h2><p className="mt-3 max-w-xl leading-7 text-muted-foreground">{description}</p></article>)}</div></section>
      <section className="bg-white py-16 sm:py-20"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="max-w-2xl"><p className="kicker text-emerald-800">Built around trust</p><h2 className="mt-4 text-3xl font-extrabold sm:text-5xl">Good product design is more than a nice screen.</h2><p className="mt-4 leading-7 text-muted-foreground">It makes the right action clear, sets expectations, and helps people make safer decisions.</p></div><div className="mt-9 grid gap-4 md:grid-cols-3">{principles.map(({ title, description, icon: Icon }) => <article key={title} className="rounded-2xl border border-border bg-background p-6"><span className="grid size-11 place-items-center rounded-xl bg-white text-emerald-800 shadow-sm"><Icon size={20} /></span><h3 className="mt-5 text-lg font-extrabold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p></article>)}</div></div></section>
      <section className="px-5 py-16 sm:px-8 sm:py-20"><div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-ink p-7 text-white sm:p-10 lg:p-14"><div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center"><div className="max-w-2xl"><p className="kicker text-emerald-200">Start with one clear report</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-white sm:text-4xl">Your next search can start here.</h2><p className="mt-3 leading-7 text-white/70">Add an item to the board or look through reports that are already there.</p></div><div className="flex flex-wrap gap-3"><Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-primary hover:bg-emerald-200">Report an item <ArrowRight size={16} /></Link><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-extrabold text-white hover:bg-white/10">Explore reports</Link></div></div></div></section>
    </Page>
  );
}
