import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site";

export const Route = createFileRoute("/_authenticated/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — CampusFind" },
      { name: "description", content: "From design thinking research to a hybrid solution: how CampusFind reconnects students with lost items." },
      { property: "og:title", content: "How CampusFind works" },
      { property: "og:description", content: "Empathize, define, ideate, prototype, test — the journey behind CampusFind." },
    ],
  }),
  component: How,
});

const phases = [
  ["Empathize", "We listened to 30 students. The journey was always the same: lose, search, wait, give up and buy a replacement."],
  ["Define", "How might we help students recover lost belongings quickly, simply and safely? Fast. Visible. Trusted."],
  ["Ideate", "Notice boards, WhatsApp groups, a website, an app, QR codes. We chose a central hub with admin verification."],
  ["Prototype", "Structured reports — category, location, time, safe details — so matches surface automatically."],
  ["Test", "With 10 students we shortened the report flow, made search more visible and added match notifications."],
];

const roadmap = [["Today", "Google Form for easy reporting"], ["Next", "Central hub with search & matching"], ["Later", "Campus app with smart notifications"]];

function How() {
  return (
    <Page>
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-16">
        <p className="kicker text-muted-foreground">Design thinking</p>
        <h1 className="mt-4 max-w-3xl text-6xl leading-tight md:text-7xl">Designed around the people who lose things.</h1>
      </section>
      <section className="mx-auto max-w-6xl px-6 pb-24">
        {phases.map(([t, d], i) => (
          <div key={t} className="grid gap-4 border-t border-border py-10 md:grid-cols-[120px_240px_1fr]">
            <span className="font-display text-3xl text-accent">0{i + 1}</span>
            <h2 className="text-4xl">{t}</h2>
            <p className="max-w-xl text-lg text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>
      <section className="bg-gradient-ink py-24 text-ink-foreground">
        <div className="mx-auto max-w-6xl px-6">
          <p className="kicker text-accent">The hybrid path</p>
          <h2 className="mt-4 text-5xl">Start with what students know.</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {roadmap.map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-ink-foreground/15 p-8">
                <p className="kicker text-accent">{t}</p>
                <p className="mt-4 font-display text-3xl">{d}</p>
              </div>
            ))}
          </div>
          <Link to="/report" className="mt-12 inline-block rounded-full bg-accent px-6 py-3 font-medium text-accent-foreground">Report an item</Link>
        </div>
      </section>
    </Page>
  );
}
