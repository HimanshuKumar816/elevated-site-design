import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health/live")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { status: "alive" },
          { headers: { "cache-control": "no-store" } },
        ),
    },
  },
});
