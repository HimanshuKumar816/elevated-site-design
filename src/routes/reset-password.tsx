import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Page } from "@/components/site";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — CampusFind" },
      { name: "description", content: "Choose a new password for your CampusFind account." },
    ],
  }),
  component: ResetPasswordPage,
});

const field = "mt-2 w-full rounded-xl border border-input bg-card px-4 py-3 outline-none focus:ring-2 focus:ring-ring";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 8 || password.length > 128) {
      setError("Password must be between 8 and 128 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        setError("This reset link is invalid or expired. Request a new one from the sign-in page.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("We couldn't update your password. Please request a new reset link and try again.");
        return;
      }
      setDone(true);
      window.setTimeout(() => {
        void supabase.auth.signOut().finally(() => navigate({ to: "/auth", replace: true }));
      }, 900);
    } catch {
      setError("Something went wrong. Please request a new reset link and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="mx-auto max-w-xl px-6 py-20">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          <p className="kicker text-muted-foreground">Account security</p>
          <h1 className="mt-4 text-5xl">Choose a new password.</h1>
          {done ? (
            <div role="status" className="mt-6">
              <p>Your password has been updated. Returning you to sign in…</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8">
              <label className="block text-sm font-medium">New password
                <input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
              </label>
              <label className="mt-4 block text-sm font-medium">Confirm new password
                <input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} />
              </label>
              {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
              <button disabled={busy} className="mt-6 w-full rounded-full bg-primary py-3 font-medium text-primary-foreground disabled:opacity-60">
                {busy ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </section>
    </Page>
  );
}
