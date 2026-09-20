import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Only variables with this prefix are ever exposed to the browser bundle.
// Other VITE_* variables (for example the ones Vercel injects automatically)
// are ignored instead of shipped or fatal.
const PUBLIC_PREFIX = "VITE_SUPABASE_";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), PUBLIC_PREFIX);
  const allowed = new Set([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  const unexpected = Object.keys(env).filter((name) => !allowed.has(name));
  if (unexpected.length) {
    // Names only, never values.
    throw new Error(
      `Unexpected ${PUBLIC_PREFIX}* variable (${unexpected.join(", ")}). Only the Supabase URL and publishable key may be exposed to the browser.`,
    );
  }
  if (
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(
      env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    )
  ) {
    throw new Error(
      "Set VITE_SUPABASE_PUBLISHABLE_KEY to a publishable key. Secret keys and legacy JWT keys are not accepted.",
    );
  }
  const url = new URL(env.VITE_SUPABASE_URL);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".supabase.co") ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "VITE_SUPABASE_URL must be an HTTPS Supabase project URL without credentials.",
    );
  }
  return { envPrefix: PUBLIC_PREFIX, plugins: [react()] };
});
