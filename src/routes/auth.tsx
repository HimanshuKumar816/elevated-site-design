import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
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

const field = "mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring";

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
        await supabase.auth.setSession({ access_token: r.access_token, refresh_token: r.refresh_token });
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
      <section className="mx-auto grid max-w-6xl gap-16 px-6 py-20 md:grid-cols-2">
        <div>
          <p className="kicker text-muted-foreground">Chandigarh University students</p>
          <h1 className="mt-4 text-6xl leading-tight">{mode === "in" ? "Welcome back." : mode === "up" ? "Create your account." : "Reset your password."}</h1>
          <p className="mt-6 max-w-md text-muted-foreground">{mode === "forgot" ? "Enter your Chandigarh University email and we'll send you a secure password reset link." : "Sign in with your university ID (UID) and password to browse and report items across campus."}</p>
        </div>
        {sent ? (
          <div className="rounded-3xl bg-gradient-ink p-10 text-ink-foreground">
            <h2 className="text-4xl">Check your email.</h2>
            <p className="mt-4 opacity-80">{mode === "forgot" ? "If an account exists for that CU email, a password reset link has been sent. Open it on this device to choose a new password." : "We sent a confirmation link to your CU email. Click it, then sign in with your UID and password."}</p>
            <button onClick={() => { setSent(false); setMode("in"); }} className="mt-8 rounded-full bg-accent px-6 py-3 font-medium text-accent-foreground">Back to sign in</button>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-3xl border border-border bg-card p-8 shadow-soft">
            <div className="grid grid-cols-2 gap-2 rounded-full bg-secondary p-1">
              {([["in", "Sign in"], ["up", "Create account"]] as const).map(([m, l]) => (
                <button type="button" key={m} onClick={() => { setMode(m); setError(""); }} className={`rounded-full py-2 text-sm font-medium ${mode === m ? "bg-primary text-primary-foreground" : ""}`}>{l}</button>
              ))}
            </div>
            {mode === "up" && <label className="mt-6 block text-sm font-medium">Full name<input required name="full_name" maxLength={80} className={field} /></label>}
            {mode !== "forgot" && <label className="mt-6 block text-sm font-medium">University ID (UID)<input required name="uid" placeholder="e.g. 23BCS10001" autoComplete="username" className={`${field} uppercase`} /></label>}
            {(mode === "up" || mode === "forgot") && <label className="mt-4 block text-sm font-medium">CU email<input required type="email" name="email" placeholder="you@cuchd.in" className={field} /></label>}
            {mode !== "forgot" && <label className="mt-4 block text-sm font-medium">Password<input required type="password" name="password" minLength={mode === "in" ? undefined : 8} maxLength={128} autoComplete={mode === "in" ? "current-password" : "new-password"} className={field} /></label>}
            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
            {mode === "in" && <button type="button" onClick={() => { setMode("forgot"); setError(""); }} className="mt-4 text-sm text-muted-foreground underline">Forgot password?</button>}
            {mode === "forgot" && <button type="button" onClick={() => { setMode("in"); setError(""); }} className="mt-4 text-sm text-muted-foreground underline">Back to sign in</button>}
            <button disabled={busy} className="mt-6 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60">
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
            </button>
          </form>
        )}
      </section>
    </Page>
  );
}
