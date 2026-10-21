import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function Header() {
  const link = "text-sm text-muted-foreground hover:text-foreground transition-colors";
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">C</span>
          <span className="font-display text-2xl">CampusFind</span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link to="/how-it-works" className={link} activeProps={{ className: "text-foreground" }}>How it works</Link>
          <Link to="/browse" className={link} activeProps={{ className: "text-foreground" }}>Browse items</Link>
          <Link to="/report" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Report an item</Link>
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
