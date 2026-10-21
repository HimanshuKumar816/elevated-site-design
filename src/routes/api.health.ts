import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await supabaseAdmin.from("profiles").select("id").limit(1);
          if (error) {
            console.error("[health] Database readiness check failed", { code: error.code });
            return Response.json(
              { status: "degraded", components: { database: "unavailable" } },
              { status: 503, headers: { "cache-control": "no-store" } },
            );
          }
          return Response.json(
            { status: "ok", components: { database: "ok" } },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          console.error("[health] Database readiness check could not run");
          return Response.json(
            { status: "degraded", components: { database: "unavailable" } },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
