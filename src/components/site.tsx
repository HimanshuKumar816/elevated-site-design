import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

function useProfile() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return setUid(null);
      const { data: p } = await supabase.from("profiles").select("uid").eq("id", data.user.id).maybeSingle();
      setUid(p?.uid ?? "Student");
    }
    load();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUid(null);
        return;
      }
      if (event === "SIGNED_IN" && session?.user) {
        const userId = session.user.id;
        // Do not call another Supabase auth method inside this callback:
        // auth callbacks must return quickly to avoid client-side deadlocks.
        void Promise.resolve()
          .then(() => supabase.from("profiles").select("uid").eq("id", userId).maybeSingle())
          .then(({ data: profile }) => setUid(profile?.uid ?? "Student"))
          .catch(() => setUid("Student"));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return uid;
}

export function Header() {
  const uid = useProfile();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const link = "text-sm text-muted-foreground hover:text-foreground transition-colors";

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: "/browse" }, replace: true });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">C</span>
          <span className="font-display text-2xl">CampusFind</span>
        </Link>
        <nav className="flex items-center gap-5">
          <Link to="/how-it-works" className={`${link} hidden sm:inline`} activeProps={{ className: "text-foreground" }}>How it works</Link>
          <Link to="/browse" className={`${link} hidden sm:inline`} activeProps={{ className: "text-foreground" }}>Browse items</Link>
          {uid ? (
            <>
              <Link to="/report" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Report</Link>
              <span className="hidden text-xs font-medium tracking-wider text-muted-foreground md:inline">{uid}</span>
              <button onClick={signOut} className={link}>Sign out</button>
            </>
          ) : (
            <Link to="/auth" search={{ redirect: "/browse" }} className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Sign in with UID</Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="bg-gradient-ink text-ink-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-display text-3xl">CampusFind</p>
          <p className="mt-2 max-w-sm text-sm opacity-70">Lost → Report → Match → Verify → Return. A calmer way to reconnect students with what they lose.</p>
        </div>
        <p className="text-xs opacity-60">A design thinking project · © 2026</p>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
