import { createFileRoute, Link } from "@tanstack/react-router";
import { Page } from "@/components/site";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — CampusFind" },
      { name: "description", content: "Learn how CampusFind handles account details, lost-and-found reports, private campus pins, and in-site support conversations." },
      { property: "og:title", content: "Privacy Policy — CampusFind" },
      { property: "og:description", content: "How CampusFind handles account details, reports, private location pins and in-site support conversations." },
    ],
    links: [{ rel: "canonical", href: "https://campusfind-uir0.onrender.com/privacy" }],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <Page>
      <article className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <nav aria-label="Breadcrumb" className="mb-7 text-sm text-muted-foreground">
          <Link to="/" className="font-bold text-primary hover:underline">Home</Link>
          <span className="px-2" aria-hidden="true">/</span>
          <span aria-current="page">Privacy Policy</span>
        </nav>
        <header className="mb-8">
          <p className="kicker text-emerald-800">Privacy and safety</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">CampusFind Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated: 1 November 2026</p>
        </header>
        <div className="space-y-8 rounded-[2rem] border border-border bg-white p-6 leading-7 text-muted-foreground shadow-sm sm:p-10">
          <section>
            <h2 className="text-xl font-extrabold text-foreground">1. What CampusFind does</h2>
            <p className="mt-3">CampusFind is a campus lost-and-found service designed for Chandigarh University. It helps signed-in users publish reports, browse reports, and arrange safer returns. This policy describes the information handled by the current website.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">2. Information we handle</h2>
            <ul className="mt-3 list-disc space-y-2 pl-6">
              <li>Account details such as your student UID, name, verified mobile number, and account role.</li>
              <li>Lost-and-found report details such as item name, category, lost/found status, date, written location, public description, and any image you choose to upload.</li>
              <li>Campus pin coordinates attached to reports. Exact coordinates are restricted to the report owner and authorised administrators; the public report board does not intentionally display those coordinates.</li>
              <li>Account activity, such as recorded successful sign-ins, and notification preferences or alerts you use.</li>
              <li>One-time handover codes issued when an administrator approves an item claim. The code is delivered in the claimant’s private in-app notification; a verification hash is stored for completion checks.</li>
              <li>In-site support conversations, including the subject, messages, replies, sender account, timestamps, and conversation status. Support requests do not require an email address.</li>
              <li>Basic technical request information processed by the website, hosting provider, and backend service to operate and protect the application.</li>
            </ul>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">3. How information is used</h2>
            <p className="mt-3">Information is used to authenticate accounts, display campus reports to signed-in users, show private information to authorised administrators, deliver configured notifications, respond to support conversations, deliver in-app reply notifications, maintain service reliability, and investigate misuse or security incidents.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">4. Who can see information</h2>
            <p className="mt-3">Basic report details from verified student accounts are visible to signed-in CampusFind users so they can identify possible matches. Report submissions are available to signed-in accounts; claims and secure handovers have additional verification requirements. Your profile details, claim proof, handover code and notifications are access-controlled. Exact report pins and administrator sign-in activity are restricted through database access policies. Support conversations are visible only to the account that opened them and authorised administrators. Administrator replies stay in CampusFind and create an in-app notification for the user. Do not include passwords, one-time codes, private proof-of-ownership details, or other sensitive information in public report descriptions.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">5. Service providers and security</h2>
            <p className="mt-3">CampusFind uses managed hosting and authentication/database services to run the website. The application applies access controls, authenticated sessions, database row-level policies, input validation, and transport security. No internet service can guarantee absolute security; use a unique password and sign out on shared devices.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">6. Retention and requests</h2>
            <p className="mt-3">Reports, support conversations, and activity records are kept for as long as they are needed to operate the service, resolve requests, maintain security, or meet applicable requirements. For a correction, deletion request, or privacy concern, use the <Link to="/contact" className="font-bold text-primary hover:underline">Help & Support page</Link>. Please do not send passwords or one-time codes.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">7. Cookies, sessions, and analytics</h2>
            <p className="mt-3">The current sign-in implementation uses Supabase Auth session storage in the browser to keep you signed in and refresh sessions. Google Analytics is only loaded when a valid GA4 measurement ID is configured by an administrator; analytics may otherwise remain disabled. Hosting and backend services may process operational logs.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">8. Children and campus use</h2>
            <p className="mt-3">CampusFind is intended for legitimate campus lost-and-found use. Do not publish another person's sensitive information, precise private location, identity documents, contact details, or identifying security details without a clear need and consent.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-foreground">9. Policy changes</h2>
            <p className="mt-3">This policy may be updated when the application or its data practices change. The latest revision date is shown above. Material changes should be reviewed before new collection or analytics features are enabled.</p>
          </section>
        </div>
      </article>
    </Page>
  );
}
