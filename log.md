# Change log

## 2026-09-20

- Built the React/TypeScript/Vite game in the requested imposter-llm folder.
- Connected the imposter-llm Supabase project; applied private game schema, membership RLS, host/captain authorization, random assignments, server timers, anonymous answers, voting, scoring, and reset.
- Added all nine source rounds, teams, reconnecting sessions, Realtime updates, Presence, host spectator mode, and responsive Gen AI at IU styling inspired by the supplied Quizlet reference.
- Enabled Anonymous Auth through the project owner. Removed unnecessary client execution of the internal RLS event trigger and indexed foreign keys.
- Verified a full live multiplayer round, negative authorization paths, Realtime, reconnection, timer enforcement, scoring, and reset. Verified five scoring edge cases in a rolled-back database transaction. Inspected desktop/mobile UI.
- Production build passed; dependency audit reports zero vulnerabilities. Added Vercel deployment configuration and documentation. Public deployment is not yet performed.
- Completed a second browser-driven round with three test captains: writing, anonymous voting, reveal, and scoreboard. Added accessible modal keyboard handling, revision-order protection, phase scroll reset, and standard React development refresh.
- Aligned local migration versions with the verified Supabase migration history. Remaining advisor notices concern intentional anonymous membership access, default-deny private tables, and unused password-login protection; the game does not use passwords.

## 2026-09-20 — Minimal landing page and GitHub safety review

- Replaced the promotional landing page with one centered, responsive join/host form. Removed feature cards, marketing copy, footer, and unused styles/icons; kept game screens and in-game help.
- Kept the empty environment example; expanded Git exclusions for configuration, keys, logs, build output, and local service metadata.
- Added a pre-build credential scanner and Vite configuration validation that rejects privileged keys and unexpected client environment variables.
- Added Vercel Content Security Policy and Permissions Policy. Verified live RLS on all eight tables and no direct private-table grants; only authenticated room members can read public room metadata.
- Updated setup and GitHub instructions to explain that the browser publishable key is intentionally public, while secret keys never belong in the client or Git.

## 2026-09-20 — Vercel build fix

- Vite now exposes only `VITE_SUPABASE_*` variables (`envPrefix`) and ignores other `VITE_*` variables such as those Vercel injects, instead of failing the build. A stray `VITE_SUPABASE_*` variable still fails and the error names it. Verified extra variables do not reach the bundle.

# 2026-09-20 — Player-chosen team names

- Replaced fixed display names with a one-time team name chosen by the first player to join each team.
- Added server-side captain, lobby, length, uniqueness, capacity, and membership checks through the `game_team` RPC.
- Added stable team positions and integration coverage for choosing and locking names.
- Added an insert trigger so the already-deployed room-creation function assigns those positions without requiring an immediate function replacement.
