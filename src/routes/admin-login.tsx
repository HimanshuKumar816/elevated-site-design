import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { signInWithUid } from "@/lib/auth.functions";
import { normalizeUid } from "@/lib/uid";
import { isAdminProfile, NO_ADMIN_ACCESS } from "@/lib/auth-validation";

export const Route = createFileRoute("/admin-login")({
  head: () => ({
    meta: [
      { title: "Administrator sign in — CampusFind" },
      { name: "description", content: "Restricted administrator access to the CampusFind moderation console." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLoginPage,
});

const field =
  "mt-2 w-full rounded-xl border border-input bg-background px-4 py-3.5 text-sm transition placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15";

function AdminLoginPage() {
  const navigate = useNavigate();
  const [uid, setUid] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    setError("");
    const adminUid = normalizeUid(uid);
    if (!/^[A-Z0-9]{5,20}$/.test(adminUid)) {
      setError("Enter a valid administrator UID.");
      return;
    }
    if (!password || password.length > 128) {
      setError("Enter your administrator password.");
      return;
    }

    setBusy(true);
    try {
      const result = await signInWithUid({ data: { uid: adminUid, password } });
      if (!result.ok) {
        setError(result.error || "Incorrect administrator UID or password.");
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (sessionError) throw sessionError;

      const { data: userData, error: userError } = await supabase.auth.getUser();
      const { data: profile, error: profileError } = userData.user
        ? await supabase
            .from("profiles")
            .select("role")
            .eq("id", userData.user.id)
            .maybeSingle()
        : { data: null, error: null };

      if (userError || profileError || !isAdminProfile(profile)) {
        await supabase.auth.signOut();
        setPassword("");
        setError(NO_ADMIN_ACCESS);
        return;
      }

      // Admin authentication is intentionally excluded from student login activity.
      navigate({ to: "/admin", replace: true });
    } catch {
      setError("Administrator sign-in is temporarily unavailable. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink px-4 py-8 text-ink-foreground sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 top-0 size-80 rounded-full bg-emerald-300/10 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 bottom-0 size-96 rounded-full bg-blue-300/10 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-white shadow-2xl shadow-black/20 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative flex min-h-[260px] flex-col justify-between overflow-hidden bg-gradient-ink p-7 text-white sm:p-10 lg:min-h-[600px] lg:p-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-10 size-64 rounded-full bg-emerald-300/15 blur-3xl" />
          <div className="relative">
            <div className="inline-flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-2xl border border-white/15 bg-white/10 text-emerald-200">
                <ShieldCheck size={24} />
              </span>
              <span>
                <span className="block text-lg font-extrabold tracking-tight">CampusFind</span>
                <span className="mt-0.5 block text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/55">Administration</span>
              </span>
            </div>
            <p className="mt-10 inline-flex rounded-full border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-emerald-100">
              Restricted access
            </p>
            <h1 className="mt-5 max-w-lg text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              CampusFind administrator portal.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-7 text-white/65 sm:text-base">
              A separate workspace for authorised moderation and report oversight. Student sign-in does not grant administrator access.
            </p>
          </div>
          <div className="relative mt-8 flex items-center gap-2 border-t border-white/10 pt-5 text-xs font-bold text-white/60">
            <LockKeyhole size={15} className="text-emerald-200" />
            Access is checked against the account's server-managed role.
          </div>
        </section>

        <section className="flex flex-col justify-center p-6 text-foreground sm:p-10 lg:p-12">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-secondary px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] text-secondary-foreground">Admin sign in</span>
            <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-extrabold text-muted-foreground transition hover:text-primary">
              Student site <ArrowUpRight size={14} />
            </Link>
          </div>

          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Welcome back.</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Use your administrator UID and password to continue to the moderation console.
          </p>

          <form onSubmit={submit} className="mt-7">
            <label className="block text-sm font-extrabold">
              Administrator UID
              <input
                required
                name="uid"
                autoComplete="username"
                autoCapitalize="characters"
                maxLength={20}
                value={uid}
                onChange={(event) => setUid(event.target.value.toUpperCase())}
                placeholder="Enter administrator UID"
                className={`${field} uppercase`}
              />
            </label>

            <label className="mt-5 block text-sm font-extrabold">
              Password
              <input
                required
                name="password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your administrator password"
                className={field}
              />
            </label>

            {error && (
              <p role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm font-bold leading-6 text-destructive">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              aria-busy={busy}
              className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground shadow-lg shadow-primary/15 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? "Checking access…" : "Sign in to admin portal"}
              {!busy && <ArrowRight size={17} />}
            </button>
          </form>

          <div className="mt-7 border-t border-border pt-5">
            <p className="text-xs leading-5 text-muted-foreground">
              Are you a student? Use the regular CampusFind sign-in to report and browse items.
            </p>
            <Link to="/auth" search={{ redirect: "/browse" }} className="mt-2 inline-flex items-center gap-1.5 text-sm font-extrabold text-primary transition hover:underline">
              Go to student sign in <ArrowRight size={15} />
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
