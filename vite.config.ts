// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Explicitly bridge Lovable Cloud's server-side build environment names to Vite's
// browser-safe names. Only the URL and publishable/anon key are exposed to the client;
// the service-role key is intentionally never read or defined here.
const mode = process.env.NODE_ENV === "development" ? "development" : "production";
const fileEnv = loadEnv(mode, process.cwd(), "");
const buildEnv = { ...fileEnv, ...process.env };
const supabaseUrl = buildEnv.VITE_SUPABASE_URL || buildEnv.SUPABASE_URL || "";
const supabasePublishableKey =
  buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY || buildEnv.SUPABASE_PUBLISHABLE_KEY || "";

export default defineConfig({
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
