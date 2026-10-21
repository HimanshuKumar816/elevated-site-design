import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // This informational page is public and must not depend on auth being available.
    if (location.pathname === "/how-it-works") return;

    // Treat auth/backend initialization failures as signed-out state instead of
    // allowing the shared route guard to crash the whole page.
    let user = null;
    try {
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch {
      user = null;
    }

    if (!user) {
      throw redirect({ to: "/auth", search: { redirect: location.pathname } });
    }
  },
  component: () => <Outlet />,
});
