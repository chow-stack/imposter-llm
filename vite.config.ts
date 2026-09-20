import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const allowed = new Set([
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
  ]);
  if (Object.keys(env).some((name) => !allowed.has(name))) {
    throw new Error(
      "Unexpected VITE_ variable. Only the Supabase URL and publishable key may be exposed to the browser.",
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
  return { plugins: [react()] };
});
