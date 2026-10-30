import { createFileRoute } from "@tanstack/react-router";

const unavailable = () =>
  Response.json(
    { status: "degraded", components: { database: "unavailable" } },
    { status: 503, headers: { "cache-control": "no-store" } },
  );

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env["SUPABASE_URL"]?.replace(/\/+$/, "");
        const key = process.env["SUPABASE_PUBLISHABLE_KEY"];

        if (!url || !key) {
          console.error("[health] Supabase connectivity configuration is incomplete");
          return unavailable();
        }

        try {
          // A low-privilege RPC confirms the database API can execute a query
          // without requiring the web service to store a service-role key.
          const response = await fetch(`${url}/rest/v1/rpc/health_check`, {
            method: "POST",
            headers: {
              apikey: key,
              "content-type": "application/json",
            },
            body: "{}",
            signal: AbortSignal.timeout(4000),
          });

          if (!response.ok) {
            console.error("[health] Database readiness check failed", { status: response.status });
            return unavailable();
          }

          const result: unknown = await response.json();
          if (result !== true) {
            console.error("[health] Database readiness check returned an unexpected result");
            return unavailable();
          }

          return Response.json(
            { status: "ok", components: { database: "ok" } },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("[health] Database readiness check could not run", {
            name: error instanceof Error ? error.name : "unknown",
          });
          return unavailable();
        }
      },
    },
  },
});
