import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  const navigate = useNavigate();

  // Signed-in users should land in their role-specific workspace, not the public landing page.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!active || !authData.user) return;
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .maybeSingle();
        if (!active) return;
        navigate({ to: profile?.role === "admin" ? "/admin" : "/browse", replace: true });
      } catch {
        // If auth is temporarily unavailable, keep the public landing page usable.
      }
    })();
    return () => { active = false; };
  }, [navigate]);

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
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div className="max-w-xl">
            <p className="kicker text-emerald-800">Made for campus life</p>
            <h2 className="mt-4 text-3xl font-extrabold leading-tight text-foreground sm:text-4xl">Good returns begin with clear information.</h2>
            <p className="mt-4 leading-7 text-muted-foreground">CampusFind gives students one organised flow to report an item, search existing reports, and compare details before arranging a handoff.</p>
            <Link to="/browse" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground transition hover:-translate-y-0.5 hover:bg-primary/90">Explore campus reports <ArrowRight size={16} /></Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { number: "01", title: "Organised reports", description: "Search by item, type, category and location.", icon: Search },
              { number: "02", title: "Useful context", description: "Share the details that help others recognise an item.", icon: MapPin },
              { number: "03", title: "Safer handoffs", description: "Keep one identifying detail private until verification.", icon: ShieldCheck },
            ].map(({ number, title, description, icon: Icon }) => (
              <article key={number} className="group rounded-2xl border border-border bg-background p-5 transition duration-200 hover:-translate-y-1 hover:border-emerald-900/20 hover:bg-white hover:shadow-xl hover:shadow-primary/5 sm:p-6">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold tracking-[0.16em] text-muted-foreground/70">{number}</span>
                  <span className="grid size-10 place-items-center rounded-xl bg-white text-primary shadow-sm transition group-hover:bg-emerald-100 group-hover:text-emerald-900"><Icon size={19} /></span>
                </div>
                <h3 className="mt-7 text-base font-extrabold tracking-tight text-foreground">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-20 sm:px-8 sm:pb-28">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-gradient-ink px-6 py-10 text-ink-foreground sm:px-12 sm:py-14 lg:px-16"><div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-emerald-300/15 blur-3xl" /><div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-center"><div className="max-w-2xl"><p className="kicker text-emerald-200">A better way to bring things home</p><h2 className="mt-4 text-3xl font-extrabold leading-tight text-white sm:text-5xl">That missing item could be one report away.</h2><p className="mt-4 max-w-xl leading-7 text-white/70">Add what you know, browse what has been reported, and help make campus returns a little easier.</p></div><div className="flex flex-wrap gap-3"><Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-primary transition hover:bg-emerald-200">Report an item <ArrowRight size={17} /></Link><Link to="/browse" className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-white/10">Browse board</Link></div></div></div>
      </section>
    </Page>
  );
}
