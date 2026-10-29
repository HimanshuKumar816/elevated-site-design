import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ArrowUpRight, CheckCircle2, Mail, Send } from "lucide-react";
import { Page } from "@/components/site";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact CampusFind" },
      { name: "description", content: "Send a question or report a problem to the CampusFind administrators." },
      { property: "og:title", content: "Contact CampusFind" },
      { property: "og:description", content: "Send a question or report a problem to the CampusFind administrators." },
    ],
  }),
  component: ContactPage,
});

const field =
  "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-ring/15";

function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSuccess(false);

    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
      setError("Enter a name between 2 and 100 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
      setError("Enter a valid email address.");
      return;
    }
    if (cleanSubject.length < 3 || cleanSubject.length > 160) {
      setError("The subject must be between 3 and 160 characters.");
      return;
    }
    if (cleanMessage.length < 10 || cleanMessage.length > 5000) {
      setError("Your message must be between 10 and 5,000 characters.");
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !publishableKey) {
      setError("The contact form is temporarily unavailable. Please try again later.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/contact`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: publishableKey,
        },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          subject: cleanSubject,
          message: cleanMessage,
          website,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        setError(
          response.status === 429
            ? "Too many messages have been submitted from this connection. Please try again later."
            : result.error || "We couldn't save your message. Please try again.",
        );
        return;
      }
      setSuccess(true);
      setName("");
      setEmail("");
      setSubject("");
      setMessage("");
      setWebsite("");
    } catch {
      setError("We couldn't connect to the contact service. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
        <nav aria-label="Breadcrumb" className="mb-7 text-sm text-muted-foreground">
          <Link to="/" className="font-bold text-primary hover:underline">Home</Link>
          <span className="px-2" aria-hidden="true">/</span>
          <span aria-current="page">Contact</span>
        </nav>
        <div className="rounded-[2rem] border border-border bg-white p-6 shadow-sm sm:p-10">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-secondary text-primary"><Mail size={22} /></span>
            <div>
              <p className="kicker text-emerald-800">We’re listening</p>
              <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">Contact CampusFind</h1>
              <p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Send the administrator team a question, correction, or report of a problem. Your message is stored in a restricted inbox that only authorised administrators can read.</p>
            </div>
          </div>

          {success && (
            <p role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-900/10 bg-emerald-50 p-4 text-sm font-bold leading-6 text-emerald-900">
              <CheckCircle2 size={19} className="mt-0.5 shrink-0" /> Your message was received. Please do not include passwords, one-time codes, or private proof-of-ownership details in contact messages.
            </p>
          )}
          {error && <p role="alert" className="mt-6 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm font-bold leading-6 text-destructive">{error}</p>}

          <form onSubmit={submit} className="mt-8 grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-extrabold text-foreground">
              Your name
              <input name="name" required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={field} />
            </label>
            <label className="block text-sm font-extrabold text-foreground">
              Email address
              <input name="email" required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
            </label>
            <label className="block text-sm font-extrabold text-foreground sm:col-span-2">
              Subject
              <input name="subject" required minLength={3} maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} className={field} />
            </label>
            <label className="block text-sm font-extrabold text-foreground sm:col-span-2">
              Message
              <textarea name="message" required minLength={10} maxLength={5000} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} className={field} />
            </label>
            <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
              <label>Leave this blank<input name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
            </div>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">Messages are saved for the administrator team. Don't send passwords, OTPs, financial details, or sensitive identity information.</p>
            <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2">
              {busy ? "Sending…" : "Send message"} {!busy && <Send size={16} />}
            </button>
          </form>
          <p className="mt-6 text-sm text-muted-foreground">Read the <Link to="/privacy" className="font-bold text-primary hover:underline">Privacy Policy</Link> to learn how contact messages are handled.</p>
        </div>
        <div className="mt-6 flex justify-end">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-extrabold text-primary hover:bg-secondary">Back to CampusFind <ArrowUpRight size={16} /></Link>
        </div>
      </section>
    </Page>
  );
}
