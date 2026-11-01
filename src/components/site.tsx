import { Button } from "@/components/ui/button";
import { Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, LogOut, Menu, PackageSearch, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type HeaderProfile = { uid: string; role: string };

function useProfile(): HeaderProfile | null {
  const [profile, setProfile] = useState<HeaderProfile | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile(userId: string) {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("uid,role")
          .eq("id", userId)
          .maybeSingle();
        if (error) throw error;
        if (active) {
          setProfile({
            uid: data?.uid ?? "Student",
            role: data?.role ?? "student",
          });
        }
      } catch {
        // Fail closed for admin navigation if the role cannot be verified.
        if (active) setProfile({ uid: "Student", role: "student" });
      }
    }

    async function loadCurrentUser() {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) {
          if (active) setProfile(null);
          return;
        }
        await loadProfile(data.user.id);
      } catch {
        if (active) setProfile(null);
      }
    }

    void loadCurrentUser();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setProfile(null);
      } else if (event === "SIGNED_IN" && session?.user) {
        // Query the profile after this callback returns; don't call auth.getUser here.
        const userId = session.user.id;
        void Promise.resolve().then(() => loadProfile(userId));
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return profile;
}

export function Header() {
  const profile = useProfile();
  const uid = profile?.uid ?? null;
  const isAdmin = profile?.role === "admin";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  async function signOut() {
    setMenuOpen(false);
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: "/browse" }, replace: true });
  }

  const navLink = "site-nav-link rounded-xl px-3 py-2.5 text-sm font-bold text-muted-foreground transition hover:bg-secondary hover:text-foreground";
  const mobileLink = "site-nav-link flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-foreground transition hover:bg-secondary";

  return (
    <header className="site-header sticky top-0 z-40 border-b border-border bg-card">
      <div className="site-header-inner mx-auto min-h-[76px] max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link to="/" onClick={() => setMenuOpen(false)} className="site-brand group flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
            <PackageSearch size={23} strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <span className="block font-display text-xl font-extrabold leading-tight tracking-normal text-foreground">CampusFind</span>
            <span className="mt-0.5 block truncate text-[10px] font-extrabold uppercase tracking-normal text-muted-foreground sm:text-[11px]">Chandigarh University</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="hidden items-center gap-1 md:flex">
          <Link to="/how-it-works" className={navLink} activeProps={{ className: "rounded-xl bg-secondary px-3 py-2.5 text-sm font-extrabold text-foreground" }}>How it works</Link>
          <Link to="/browse" className={navLink} activeProps={{ className: "rounded-xl bg-secondary px-3 py-2.5 text-sm font-extrabold text-foreground" }}>Browse items</Link>
          {uid ? (
            <>
              <span className="mx-2 h-6 w-px bg-border" />
              <span className="mr-2 max-w-28 truncate rounded-lg bg-secondary px-3 py-2 text-xs font-extrabold text-secondary-foreground" title={uid}>{uid}</span>
              {!isAdmin && <Link to="/my-reports" className={navLink}>My reports</Link>}
              <Link to="/report" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">Report an item <ArrowUpRight size={16} /></Link>
              {isAdmin && <Link to="/admin" className={navLink}>Admin dashboard</Link>}
              <Button variant="plain" type="button" onClick={signOut} className={navLink}>Sign out</Button>
            </>
          ) : (
            <Link to="/auth" search={{ redirect: "/browse" }} className="ml-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-extrabold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">Student sign in <ArrowUpRight size={16} /></Link>
          )}
        </nav>
        <Button variant="plain" ref={menuButton} type="button" aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={menuOpen} aria-controls="campusfind-mobile-nav" onClick={() => setMenuOpen((open) => !open)} className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-foreground shadow-sm transition hover:bg-secondary md:hidden">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </div>
      {menuOpen && (
        <div id="campusfind-mobile-nav" className="site-mobile-nav border-t border-border bg-background px-5 py-4 shadow-lg md:hidden">
          <nav aria-label="Mobile navigation" className="mx-auto grid max-w-7xl gap-1">
            <Link to="/" onClick={() => setMenuOpen(false)} className={mobileLink}>Home <ArrowUpRight size={16} /></Link>
            <Link to="/how-it-works" onClick={() => setMenuOpen(false)} className={mobileLink}>How it works <ArrowUpRight size={16} /></Link>
            <Link to="/browse" onClick={() => setMenuOpen(false)} className={mobileLink}>Browse items <ArrowUpRight size={16} /></Link>
            {uid ? (
              <>
                {!isAdmin && <Link to="/my-reports" onClick={() => setMenuOpen(false)} className={mobileLink}>My reports <ArrowUpRight size={16} /></Link>}
                <Link to="/report" onClick={() => setMenuOpen(false)} className={mobileLink}>Report an item <ArrowUpRight size={16} /></Link>
                {isAdmin && <Link to="/admin" onClick={() => setMenuOpen(false)} className={mobileLink}>Admin dashboard <ArrowUpRight size={16} /></Link>}
                <div className="my-1 flex items-center justify-between rounded-xl bg-secondary px-4 py-3 text-xs font-extrabold text-secondary-foreground"><span>Signed in as</span><span>{uid}</span></div>
                <Button variant="plain" type="button" onClick={signOut} className="flex items-center gap-2 rounded-xl px-4 py-3 text-left text-sm font-bold text-destructive hover:bg-destructive/5"><LogOut size={16} /> Sign out</Button>
              </>
            ) : (
              <Link to="/auth" search={{ redirect: "/browse" }} onClick={() => setMenuOpen(false)} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-extrabold text-primary-foreground">Student sign in <ArrowUpRight size={16} /></Link>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer bg-gradient-ink text-ink-foreground">
      <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="grid gap-10 border-b border-ink-foreground/10 pb-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Link to="/" className="inline-flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl border border-ink-foreground/15 bg-card/10"><PackageSearch size={22} /></span>
              <span className="font-display text-2xl font-extrabold tracking-normal">CampusFind</span>
            </Link>
            <p className="mt-4 max-w-md text-sm leading-7 text-ink-foreground/80">A simpler way for Chandigarh University students to report, find, and return lost belongings—with privacy and care at every step.</p>
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-foreground/75">Explore</p>
            <div className="mt-4 grid gap-3">
              <Link to="/browse" className="text-sm text-ink-foreground/80 transition hover:text-ink-foreground">Browse reports</Link>
              <Link to="/report" className="text-sm text-ink-foreground/80 transition hover:text-ink-foreground">Report an item</Link>
              <Link to="/how-it-works" className="text-sm text-ink-foreground/80 transition hover:text-ink-foreground">How it works</Link>
              <Link to="/contact" className="text-sm text-ink-foreground/80 transition hover:text-ink-foreground">Contact</Link>
              <Link to="/privacy" className="text-sm text-ink-foreground/80 transition hover:text-ink-foreground">Privacy policy</Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-normal text-ink-foreground/75">Our promise</p>
            <div className="mt-4 grid gap-3 text-sm text-ink-foreground/80"><span>Private by design</span><span>Built for campus life</span><span>Verify before handoff</span></div>
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-xs text-ink-foreground/75 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 CampusFind · Student-built campus lost & found</p>
          <p>Report · Match · Verify · Return</p>
        </div>
      </div>
    </footer>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="site-frame flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only z-50 rounded-xl bg-primary px-4 py-3 font-extrabold text-ink-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to main content</a>
      <Header />
      <main id="main-content" tabIndex={-1} className="page-enter min-w-0 flex-1">{children}</main>
      <Footer />
    </div>
  );
}
