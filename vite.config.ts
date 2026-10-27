import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Load local environment variables for server-side functions. Only the public
// URL and publishable key are explicitly injected into the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, env);

  const supabaseUrl = env["VITE_SUPABASE_URL"] || env["SUPABASE_URL"] || "";
  const supabasePublishableKey =
    env["VITE_SUPABASE_PUBLISHABLE_KEY"] || env["SUPABASE_PUBLISHABLE_KEY"] || "";

  return {
    plugins: [
      tsConfigPaths(),
      tailwindcss(),
      tanstackStart({ server: { entry: "server" } }),
      nitro({ preset: "render-com" }),
      viteReact(),
    ],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    },
  };
});
