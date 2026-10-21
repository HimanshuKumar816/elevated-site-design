import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site";
import hero from "@/assets/hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CampusFind — Smart Campus Lost & Found" },
      { name: "description", content: "Report, search and safely recover lost items on campus. One trusted place instead of scattered messages." },
      { property: "og:title", content: "CampusFind — Smart Campus Lost & Found" },
      { property: "og:description", content: "Report, search and safely recover lost items on campus." },
    ],
  }),
  component: Home,
});

const steps = [
  ["Report", "Submit item details in under a minute."],
  ["Match", "Similar lost and found reports surface together."],
  ["Alert", "The possible owner is notified."],
  ["Verify", "Ownership is confirmed with a private detail."],
  ["Return", "A controlled handoff at an authorised point."],
];

function Home() {
  return (
    <Page>
      <section className="relative overflow-hidden">
        <img src={hero} alt="A forgotten wallet and ID card on a campus bench at sunset" width={1600} height={1008} className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/80 to-ink/10" />
        <div className="relative mx-auto max-w-6xl px-6 py-32 text-ink-foreground md:py-44">
          <p className="kicker text-accent">Smart campus lost & found</p>
          <h1 className="mt-6 max-w-2xl text-6xl leading-[0.95] md:text-8xl">Lost something? <em className="text-accent">Find it</em> faster.</h1>
          <p className="mt-6 max-w-lg text-lg opacity-80">One trusted place to report, search and safely return belongings — instead of scattered WhatsApp groups and notice boards.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/report" className="rounded-full bg-accent px-6 py-3 font-medium text-accent-foreground hover:opacity-90">Report an item</Link>
            <Link to="/browse" className="rounded-full border border-ink-foreground/30 px-6 py-3 font-medium hover:bg-ink-foreground/10">Browse found items</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="kicker text-muted-foreground">The problem</p>
          <h2 className="mt-4 text-5xl leading-tight">People want to return things. The information is just scattered.</h2>
        </div>
        <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-3">
          {[["70%", "of surveyed students had lost something on campus"], ["30", "students interviewed in our research"], ["1", "central place to report & search"]].map(([n, t]) => (
            <div key={n} className="bg-card p-6">
              <p className="font-display text-6xl text-primary">{n}</p>
              <p className="mt-3 text-sm text-muted-foreground">{t}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-secondary/60 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <p className="kicker text-muted-foreground">Five steps to a return</p>
          <h2 className="mt-4 max-w-xl text-5xl">Every step removes a little uncertainty.</h2>
          <ol className="mt-14 grid gap-4 md:grid-cols-5">
            {steps.map(([t, d], i) => (
              <li key={t} className="rounded-2xl bg-card p-6 shadow-soft">
                <span className="font-display text-4xl text-accent">0{i + 1}</span>
                <p className="mt-6 font-semibold">{t}</p>
                <p className="mt-2 text-sm text-muted-foreground">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="rounded-3xl bg-gradient-ink p-12 text-ink-foreground md:p-16">
          <p className="kicker text-accent">Built on trust</p>
          <h2 className="mt-4 max-w-2xl text-5xl">A match is not proof. Verification protects both finder and owner.</h2>
          <div className="mt-10 grid gap-6 text-sm opacity-85 md:grid-cols-3">
            <p>Sensitive identifying details stay private.</p>
            <p>Claimants answer a private question only the owner would know.</p>
            <p>Security verifies before every handoff.</p>
          </div>
          <Link to="/how-it-works" className="mt-10 inline-block rounded-full bg-accent px-6 py-3 font-medium text-accent-foreground">See how it works</Link>
        </div>
      </section>
    </Page>
  );
}
