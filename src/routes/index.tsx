import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, BadgeCheck, BellRing, Check, LockKeyhole, MapPin, PackageSearch, Search, ShieldCheck, Sparkles } from "lucide-react";
import { Page } from "@/components/site";
import hero from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CampusFind — Smart Campus Lost & Found" },
      { name: "description", content: "A trusted campus-focused place to report lost items, discover potential matches, and safely reconnect belongings with their owners." },
      { property: "og:title", content: "CampusFind — Smart Campus Lost & Found" },
      { property: "og:description", content: "Report, search and safely recover lost items around Chandigarh University." },
    ],
  }),
  component: Home,
});

const steps = [
  { number: "01", title: "Report", description: "Add the item, where you last saw it, and useful details.", icon: PackageSearch },
  { number: "02", title: "Discover matches", description: "Search reports and compare details that might line up.", icon: Search },
  { number: "03", title: "Verify & return", description: "Keep one private detail for a safer handoff.", icon: ShieldCheck },
];
const assurances = ["One place for campus reports", "Private details stay private", "Verify before handing over"];

function Home() {
  return (
    <Page>
      <section className="relative isolate overflow-hidden">
        <div className="hero-grid absolute inset-0 -z-10" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-16 lg:pb-24 lg:pt-20">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white/80 px-3.5 py-2 text-xs font-extrabold text-primary shadow-sm backdrop-blur">
              <span className="size-2 rounded-full bg-emerald-500" /> Campus lost & found, made simpler
            </div>
            <h1 className="mt-7 max-w-3xl text-balance text-5xl font-extrabold leading-[1.02] tracking-[-0.055em] text-foreground sm:text-6xl lg:text-[4.65rem]">
              Lost something?<span className="mt-1 block text-primary">Let's get it back.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">Campus life moves fast. CampusFind brings lost and found reports into one organised place, so students can search clearly, share useful details, and reconnect belongings with their owners.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/report" className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground shadow-md shadow-primary/15 transition duration-200 hover:-translate-y-0.5 hover:shadow-lg">Report an item <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" /></Link>
              <Link to="/browse" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white/80 px-5 py-3 text-sm font-extrabold text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/25 hover:bg-white">Explore the board <ArrowUpRight size={17} /></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-xs font-bold text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-emerald-700" /> Built around safer returns</span>
              <span className="inline-flex items-center gap-2"><LockKeyhole size={15} className="text-emerald-700" /> Student-focused privacy</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[570px] lg:ml-auto">
            <div className="absolute -right-5 -top-5 size-28 rounded-full bg-emerald-200/70 blur-3xl" />
            <div className="absolute -bottom-5 -left-5 size-32 rounded-full bg-blue-200/70 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white p-2 shadow-[0_35px_100px_-45px_oklch(0.20_0.05_253_/_0.55)] sm:p-3">
              <div className="relative min-h-[390px] overflow-hidden rounded-[1.45rem] bg-primary sm:min-h-[475px]">
                <img src={hero} alt="A wallet and student ID left on a campus bench" width={1600} height={1008} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-primary/95 via-primary/20 to-primary/10" />
                <div className="absolute left-5 right-5 top-5 flex items-start justify-between gap-4 sm:left-7 sm:right-7 sm:top-7">
                  <div className="rounded-full border border-white/25 bg-primary/25 px-3.5 py-2 text-[11px] font-extrabold uppercase tracking-[0.15em] text-white backdrop-blur-md">CampusFind · CU</div>
                  <div className="grid size-11 place-items-center rounded-2xl border border-white/25 bg-white/15 text-white backdrop-blur-md"><Sparkles size={20} /></div>
                </div>
                <div className="absolute inset-x-5 bottom-5 sm:inset-x-7 sm:bottom-7">
                  <p className="kicker text-white/70">A clearer way to reconnect</p>
                  <h2 className="mt-2 max-w-sm text-3xl font-extrabold leading-tight text-white sm:text-4xl">From lost to found, one step at a time.</h2>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white backdrop-blur"><Search size={14} /> Search reports</span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs font-bold text-white backdrop-blur"><BellRing size={14} /> Match alerts</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="surface-card absolute -bottom-7 left-4 right-4 rounded-2xl p-4 sm:-left-8 sm:right-12 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><BadgeCheck size={22} /></div>
                <div className="min-w-0 flex-1"><p className="text-sm font-extrabold text-foreground">A more thoughtful return</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Compare details privately. A match is a starting point, not proof of ownership.</p></div>
                <Check size={18} className="shrink-0 text-emerald-700" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-border/80 bg-white/75">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-6 sm:px-8 md:grid-cols-3 md:gap-8">
          {assurances.map((item, index) => <div key={item} className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-primary">{index === 0 ? <Search size={17} /> : index === 1 ? <LockKeyhole size={17} /> : <ShieldCheck size={17} />}</span><p className="text-sm font-extrabold text-foreground">{item}</p></div>)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl"><p className="kicker text-emerald-800">Simple by design</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-foreground sm:text-5xl">Less searching in circles. More chances of a return.</h2><p className="mt-4 max-w-xl leading-7 text-muted-foreground">A clear journey from the first report to a safer handoff—without chasing information across scattered messages.</p></div>
          <Link to="/how-it-works" className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl px-3 py-2 text-sm font-extrabold text-primary transition hover:bg-secondary md:self-auto">See how it works <ArrowUpRight size={17} /></Link>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map(({ number, title, description, icon: Icon }) => <article key={number} className="group rounded-3xl border border-border bg-white p-6 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-emerald-900/20 hover:shadow-xl hover:shadow-primary/5 sm:p-8"><div className="flex items-center justify-between"><span className="text-xs font-extrabold tracking-[0.18em] text-muted-foreground/70">{number} / 03</span><span className="grid size-12 place-items-center rounded-2xl bg-secondary text-primary transition group-hover:bg-emerald-100 group-hover:text-emerald-900"><Icon size={22} /></span></div><h3 className="mt-8 text-xl font-extrabold tracking-tight text-foreground">{title}</h3><p className="mt-3 leading-7 text-muted-foreground">{description}</p></article>)}
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 sm:py-20 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <div><p className="kicker text-emerald-800">A real campus problem</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-foreground sm:text-4xl">Make the information easier to find.</h2><p className="mt-4 leading-7 text-muted-foreground">CampusFind provides a central place to browse reports, add useful context, and compare details before arranging a return.</p><div className="mt-7 flex flex-wrap gap-3"><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground transition hover:bg-primary/90">Browse reports <ArrowRight size={16} /></Link><Link to="/report" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-extrabold text-foreground transition hover:bg-secondary">Add a report</Link></div></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[{ value: "70%", label: "of surveyed students had lost something on campus" }, { value: "30", label: "students interviewed during project research" }, { value: "1", label: "central place to report and search" }].map((item) => <div key={item.value} className="rounded-2xl border border-border bg-background p-5 sm:p-6"><p className="text-4xl font-extrabold tracking-tight text-primary sm:text-5xl">{item.value}</p><p className="mt-3 text-sm leading-6 text-muted-foreground">{item.label}</p></div>)}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
        <div><p className="kicker text-emerald-800">Grounded in place</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-foreground sm:text-5xl">Built around Chandigarh University.</h2><p className="mt-5 leading-7 text-muted-foreground">Use the campus-area map to orient yourself. When making a report, include the nearest building or campus landmark to help others narrow down the search.</p><a href="https://www.openstreetmap.org/?mlat=30.7689&mlon=76.5750#map=16/30.7689/76.5750" target="_blank" rel="noreferrer" className="mt-7 inline-flex items-center gap-2 rounded-xl border border-border bg-white px-4 py-3 text-sm font-extrabold text-foreground shadow-sm transition hover:border-primary/25 hover:bg-secondary">Open campus-area map <ArrowUpRight size={16} /></a><p className="mt-4 text-xs leading-5 text-muted-foreground">Map data © OpenStreetMap contributors. Confirm the exact building or gate when reporting.</p></div>
        <div className="overflow-hidden rounded-[1.75rem] border border-border bg-white p-2 shadow-xl shadow-primary/5 sm:p-3"><iframe title="Map around Chandigarh University, Gharuan" src="https://www.openstreetmap.org/export/embed.html?bbox=76.555%2C30.755%2C76.595%2C30.782&layer=mapnik&marker=30.7689%2C76.5750" className="h-[320px] w-full rounded-[1.25rem] sm:h-[420px]" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>
      </section>

      <section className="px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-ink px-6 py-10 text-ink-foreground sm:px-12 sm:py-14 lg:px-16"><div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-emerald-300/15 blur-3xl" /><div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center"><div className="max-w-2xl"><p className="kicker text-emerald-200">A better way to bring things home</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-white sm:text-5xl">That missing item could be one report away.</h2><p className="mt-4 max-w-xl leading-7 text-white/70">Add what you know, browse what has been reported, and help make campus returns a little easier.</p></div><div className="flex flex-wrap gap-3"><Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-primary transition hover:bg-emerald-200">Report an item <ArrowRight size={17} /></Link><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-white/10">Browse board</Link></div></div></div>
      </section>
    </Page>
  );
}
