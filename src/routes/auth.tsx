import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles } from "lucide-react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";
import { signInWithUid } from "@/lib/auth.functions";
import { isValidUid, normalizeUid } from "@/lib/uid";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => {
    const r = s["redirect"];
    return { redirect: typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/browse" };
  },
  head: () => ({
    meta: [
      { title: "Sign in — CampusFind" },
      { name: "description", content: "Sign in to CampusFind with your CU university ID and password." },
      { property: "og:title", content: "Sign in — CampusFind" },
      { property: "og:description", content: "Sign in with your CU university ID." },
    ],
  }),
  component: AuthPage,
});

const field = "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3.5 text-sm transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15";

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const signIn = useServerFn(signInWithUid);
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const uid = normalizeUid(f.get("uid"));
    const password = String(f.get("password"));
    try {
      if (mode === "forgot") {
        const email = String(f.get("email") ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@cuchd\.in$/.test(email)) {
          return setError("Enter the CU email address associated with your account.");
        }
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (resetError) return setError("We couldn't send the reset email. Please try again.");
        setSent(true);
        return;
      }
      if (!isValidUid(uid)) {
        return setError("Enter a valid university ID (5–20 letters and numbers only).");
      }
      if (mode === "in") {
        const r = await signIn({ data: { uid, password } });
        if (!r.ok) return setError(r.error);
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: r.access_token,
          refresh_token: r.refresh_token,
        });
        if (sessionError) {
          setError("Your credentials were accepted, but we couldn't start your session. Please try again.");
          return;
        }
        navigate({ to: redirect, replace: true });
      } else {
        const email = String(f.get("email")).trim().toLowerCase();
        if (!/^[^@\s]+@cuchd\.in$/.test(email)) {
          return setError("Use your Chandigarh University email address ending in @cuchd.in.");
        }
        if (password.length < 8) return setError("Password must be at least 8 characters.");
        if (password.length > 128) return setError("Password must be at most 128 characters.");
        const fullName = String(f.get("full_name") ?? "").trim();
        if (!fullName || fullName.length > 80) return setError("Enter your full name (up to 80 characters).");
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + "/auth", data: { uid, full_name: fullName } },
        });
        if (error) return setError("We couldn't create the account. Check that your university ID is unused and your CU email is correct, then try again.");
        setSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="mx-auto grid max-w-7xl gap-7 px-5 py-8 sm:px-8 sm:py-12 lg:grid-cols-[1fr_0.9fr] lg:items-stretch lg:py-14">
        <aside className="relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-[2rem] bg-gradient-ink p-7 text-ink-foreground sm:p-10 lg:min-h-[650px] lg:p-12">
          <div className="pointer-events-none absolute -right-12 top-14 size-64 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative"><span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-extrabold text-white/80"><ShieldCheck size={15} className="text-emerald-200" /> A safer campus starts here</span><h1 className="mt-8 max-w-xl text-4xl font-extrabold leading-tight text-white sm:text-5xl lg:text-6xl">{mode === "in" ? "Welcome back to a more connected campus." : mode === "up" ? "Join your campus lost & found." : "Get back into your account."}</h1><p className="mt-5 max-w-lg leading-7 text-white/70">{mode === "forgot" ? "Use your Chandigarh University email to receive a secure password reset link." : "Sign in with your university ID to browse reports, publish an item, and manage match alerts in one place."}</p></div>
          <div className="relative mt-10"><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><LockKeyhole size={20} /></span><p className="mt-4 text-sm font-extrabold text-white">Private by design</p><p className="mt-1 text-xs leading-5 text-white/60">Only share the details needed to find an item.</p></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><span className="grid size-10 place-items-center rounded-xl bg-emerald-300/15 text-emerald-200"><Sparkles size={20} /></span><p className="mt-4 text-sm font-extrabold text-white">Made for students</p><p className="mt-1 text-xs leading-5 text-white/60">Keep your report and search journey in one place.</p></div></div><p className="mt-6 flex items-center gap-2 text-xs font-bold text-white/50"><CheckCircle2 size={15} className="text-emerald-200" /> Chandigarh University campus community</p></div>
        </aside>

        <div className="flex flex-col justify-center rounded-[2rem] border border-border bg-white p-5 shadow-xl shadow-primary/5 sm:p-8 lg:p-10">
          {sent ? (
            <div className="py-5 sm:py-8"><span className="grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-800"><Mail size={27} /></span><p className="mt-6 kicker text-emerald-800">Check your inbox</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">You're one step away.</h2><p className="mt-4 leading-7 text-muted-foreground">{mode === "forgot" ? "If an account exists for that CU email, a password reset link has been sent. Open it on this device to choose a new password." : "We sent a confirmation link to your CU email. Click it, then sign in with your university ID and password."}</p><button type="button" onClick={() => { setSent(false); setMode("in"); setError(""); }} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-white"><ArrowLeft size={16} /> Back to sign in</button></div>
          ) : (
            <>
              <div><p className="kicker text-emerald-800">Student access</p><h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Reset password"}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{mode === "forgot" ? "Enter the CU email linked to your account." : "Use your Chandigarh University UID and password to continue."}</p></div>
              {mode !== "forgot" && <div className="mt-7 grid grid-cols-2 rounded-xl bg-secondary p-1">{([["in", "Sign in"], ["up", "Create account"]] as const).map(([m, label]) => <button type="button" key={m} onClick={() => { setMode(m); setError(""); setSent(false); }} aria-pressed={mode === m} className={`rounded-lg px-3 py-2.5 text-sm font-extrabold transition ${mode === m ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>}
              <form onSubmit={submit} className="mt-6">
                {mode === "up" && <label className="mb-4 block text-sm font-extrabold text-foreground">Full name<input required name="full_name" maxLength={80} autoComplete="name" placeholder="Your full name" className={field} /></label>}
                {mode !== "forgot" && <label className="mb-4 block text-sm font-extrabold text-foreground">University ID (UID)<input required name="uid" placeholder="e.g. 26BCS11930" autoComplete="username" autoCapitalize="characters" className={`${field} uppercase`} /></label>}
                {(mode === "up" || mode === "forgot") && <label className="mb-4 block text-sm font-extrabold text-foreground">CU email<input required type="email" name="email" autoComplete="email" placeholder="you@cuchd.in" className={field} /></label>}
                {mode !== "forgot" && <label className="block text-sm font-extrabold text-foreground">Password<input required type="password" name="password" minLength={mode === "in" ? undefined : 8} maxLength={128} autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder={mode === "in" ? "Enter your password" : "At least 8 characters"} className={field} /></label>}
                {error && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-bold leading-6 text-destructive">{error}</p>}
                {mode === "in" && <button type="button" onClick={() => { setMode("forgot"); setError(""); }} className="mt-4 text-sm font-extrabold text-primary underline-offset-4 hover:underline">Forgot password?</button>}
                {mode === "forgot" && <button type="button" onClick={() => { setMode("in"); setError(""); }} className="mt-4 inline-flex items-center gap-2 text-sm font-extrabold text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Back to sign in</button>}
                <button disabled={busy} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Please wait…" : mode === "in" ? "Sign in securely" : mode === "up" ? "Create account" : "Send reset link"}{!busy && <ArrowRight size={17} />}</button>
              </form>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-background p-4"><KeyRound size={17} className="mt-0.5 shrink-0 text-emerald-800" /><p className="text-xs leading-5 text-muted-foreground">Account access is for Chandigarh University students. Never share your password or publish private ownership details.</p></div>
            </>
          )}
        </div>
      </section>
    </Page>
  );
}
