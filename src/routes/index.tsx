import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, ArrowUpRight, Check, LockKeyhole, PackageSearch, Search, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Page } from "@/components/site";
import heroImage from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "CampusFind — Lost & Found at Chandigarh University" },
      { name: "description", content: "One clear place for Chandigarh University students to report lost items, browse found belongings, and arrange safer returns." },
      { property: "og:title", content: "CampusFind — Lost & Found at Chandigarh University" },
      { property: "og:description", content: "Report it. Search the board. Bring it home." },
    ],
    links: [{ rel: "canonical", href: "https://campusfind-fs6c.onrender.com/" }],
  }),
  component: Home,
});

const steps = [
  { number: "01", title: "Report lost or found", description: "Choose what happened, then add the item name, date and campus area.", icon: PackageSearch },
  { number: "02", title: "Search campus reports", description: "Use item names, categories and campus locations to narrow the board.", icon: Search },
  { number: "03", title: "Verify before handoff", description: "Keep one identifying detail private and use the claim process before returning an item.", icon: ShieldCheck },
];

function Home() {
  const navigate = useNavigate();

  // Signed-in users should land in their role-specific workspace, not the public landing page.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!active || !authData.user) return;
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
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
      <section className="home-hero">
        <div className="mx-auto grid max-w-7xl items-center gap-8 px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[0.96fr_1.04fr] lg:gap-16 lg:pb-24 lg:pt-20">
          <div className="home-hero-copy relative z-10">
            <div className="home-eyebrow"><span className="home-eyebrow-mark" /> CHANDIGARH UNIVERSITY · LOST & FOUND</div>
            <h1 className="mt-7 max-w-2xl text-balance text-4xl font-extrabold leading-[0.99] tracking-normal text-foreground sm:text-6xl lg:text-6xl">
              Lost on campus?
              <span className="home-headline-accent mt-2 block">Let's bring it back.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
              The campus moves quickly. Your belongings shouldn't disappear into group chats and guesswork. Search the campus board first; if the item is not listed, report it and follow a clear process to get it back.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/browse" className="home-primary-cta group inline-flex min-h-14 items-center justify-center gap-3 px-6 py-3.5 text-sm font-bold text-ink-foreground transition">
                Find an item <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link to="/report" className="home-secondary-cta inline-flex min-h-14 items-center justify-center gap-3 px-6 py-3.5 text-sm font-bold text-foreground transition">
                Report lost or found <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-5 text-xs font-semibold text-muted-foreground sm:text-sm">
              <span className="inline-flex items-center gap-2"><LockKeyhole size={16} className="text-primary" /> Private student details</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck size={16} className="text-primary" /> Verify before handoff</span>
            </div>
          </div>

          <div className="home-hero-visual relative mx-auto w-full max-w-[640px] lg:ml-auto">
            <div className="home-image-frame relative overflow-hidden">
              <img src={heroImage} alt="A wallet on a campus bench beside a tree-lined university walkway" width={1280} height={853} fetchPriority="high" className="home-image h-full w-full object-cover" />
              <div className="home-image-caption absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-5 text-ink-foreground sm:p-7">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-normal text-ink-foreground/70">The campus return desk</p>
                  <p className="mt-2 max-w-sm text-2xl font-extrabold leading-tight tracking-normal sm:text-3xl">A lost item is not a lost cause.</p>
                </div>
                <span className="home-photo-stamp">CF<br/>01</span>
              </div>
            </div>
            <div className="home-image-note">
              <span className="home-note-icon"><Check size={17} strokeWidth={2.5} /></span>
              <span><strong>Made for campus life.</strong> One place to report, search and reconnect.</span>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="How CampusFind works" className="home-process-band">
        <div className="mx-auto grid max-w-7xl gap-0 px-5 sm:px-8 md:grid-cols-3">
          {steps.map(({ number, title, description, icon: Icon }) => (
            <article key={number} className="home-process-step">
              <div className="flex items-center justify-between gap-4">
                <span className="home-step-number">{number}</span>
                <Icon size={20} strokeWidth={1.8} className="text-primary" />
              </div>
              <h2 className="mt-5 text-xl font-bold tracking-normal text-foreground">{title}</h2>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-trust-section">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="home-section-label">A better way to look after your things</p>
            <h2 className="mt-4 max-w-xl text-3xl font-extrabold leading-[1.05] tracking-normal text-foreground sm:text-5xl">
              Less noise.
              <span className="block text-primary">More found.</span>
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
              CampusFind turns scattered messages into clear, searchable reports. You stay in control of the details you share and the proof you keep private.
            </p>
            <Link to="/how-it-works" className="home-text-link mt-7 inline-flex items-center gap-2 text-sm font-bold text-primary">
              See how it works <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="home-principles">
            <article className="home-principle-row"><span className="home-principle-number">01</span><div><h3 className="font-bold text-foreground">A focused campus board</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Search by item, category, report type and campus location.</p></div></article>
            <article className="home-principle-row"><span className="home-principle-number">02</span><div><h3 className="font-bold text-foreground">Details that stay yours</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Keep a unique ownership detail private until you need to verify a claim.</p></div></article>
            <article className="home-principle-row"><span className="home-principle-number">03</span><div><h3 className="font-bold text-foreground">A more considered handoff</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">Use a possible match as a lead, then verify before returning an item.</p></div></article>
          </div>
        </div>
      </section>

      <section className="home-final-cta px-5 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-7 bg-ink px-6 py-0 text-ink-foreground sm:px-10 sm:py-12 lg:grid-cols-[1fr_auto] lg:items-center lg:px-14">
          <div>
            <p className="text-xs font-bold uppercase tracking-normal text-ink-foreground/60">Your next step starts here</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-normal sm:text-4xl">Something missing? Start with the board.</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-ink-foreground/70">Search recent reports or add a clear report of your own. Every useful detail helps.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/browse" className="home-final-primary inline-flex min-h-12 items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-ink-foreground transition">Browse items <ArrowRight size={17} /></Link>
            <Link to="/report" className="home-final-secondary inline-flex min-h-12 items-center justify-center gap-2 border border-ink-foreground/25 px-5 py-3 text-sm font-bold text-ink-foreground transition hover:bg-card/10">Make a report</Link>
          </div>
        </div>
      </section>
    </Page>
  );
}
