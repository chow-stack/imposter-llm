# Imposter LLM

A multiplayer, team-based social-deduction game for Gen AI at Indiana University. Players act as language models: everyone receives the same prompt, but one team gets different private context. No model API is used.

## Run

```sh
npm ci
cp .env.example .env.local
# Fill in the Supabase project URL and publishable key before starting.
npm run dev
```

Open http://localhost:5173. `.env.example` intentionally contains blank values. Keep the real project URL and publishable key in ignored `.env.local` or in Vercel's environment settings. Never put a service-role key, secret key, database password, or access token in any `VITE_` variable. The build rejects non-publishable keys and unexpected `VITE_` variables.

## Before pushing to GitHub

Run `npm run check:secrets` and review `git diff --cached`. The scanner also runs before every production build. It checks source/config files for common credentials and rejects private/generated files if they are already tracked. It reports paths and credential types, never matched values. This is a pattern-based guard, not a guarantee against every possible secret.

`.gitignore` excludes environment files (except the blank `.env.example`), private-key files, local configuration, Vercel metadata, Supabase temporary files, build output, dependencies, and logs. If a private file was committed previously, ignoring it does not remove it from history: remove it from Git and rotate any actual leaked secret. This folder had no Git repository/history when audited on 2026-09-20.

The Supabase **publishable** key is necessarily visible in the deployed JavaScript and network requests. It is designed for this use; hiding it in an environment file does not make it a secret. Data access is protected by authentication, membership checks, and RLS. See [Supabase API-key documentation](https://supabase.com/docs/guides/getting-started/api-keys). No service-role or secret key is needed by this application.

Vercel responses include a Content Security Policy limiting scripts to the app origin, connections to Supabase, and fonts to Google Fonts. Framing, object embeds, camera, microphone, and geolocation are disabled. These headers take effect on Vercel, not on the Vite development server.


## Play

1. Host a room with 3–5 teams; four or five is ideal for a 20-member club.
2. Share the code or copied room link. Players enter nicknames and pick teams (up to four players each).
3. The first person on each team is its captain, who submits answers and both votes. One device per team also works. The host can remain a spectator for a shared screen.
4. Select one of the nine source rounds and a 60, 75, or 90-second timer.
5. Teams privately reveal their context and submit 1–2 sentences (320-character cap). Captains can revise until the server deadline. Drafts survive refresh on the same device.
6. After the timer, the host opens voting. All answers appear in a stable, randomized order without team identities.
7. Each captain casts one imposter vote and one funniest vote; no self-votes. Choices can change until reveal.
8. The host reveals identities, both contexts, totals, and scores, then advances to the scoreboard and another round.

Suggested sequence: IU mascot → AI dating profile → movie review or apology text → campus survival advice.

### Scoring decisions

- +1 per team correctly identifying the imposter.
- +2 to the imposter when it receives fewer votes than the most-voted answer.
- +1 extra to that escaping imposter if exactly one other team receives the most votes.
- +1 to the funniest answer. Tied funniest answers each earn a point.
- A top-vote tie involving the imposter counts as detection.
- No deduction votes means no escape points. An imposter that submits nothing cannot earn escape points.
- Missing answers appear as “No answer submitted” and cannot receive votes.
- Scoring happens once in a locked database transaction. Reset clears rounds and scores while keeping players and teams.

The brief did not define ties, missing answers, or zero-vote outcomes; these explicit rules keep those cases predictable. Sentence count is a player instruction; the database enforces the 320-character cap, avoiding unreliable punctuation-based sentence counting.

## Architecture and privacy

- React + TypeScript + Vite; Supabase Anonymous Auth, Postgres, RLS, RPCs, Realtime database changes, and Presence.
- `public.games` contains only room metadata and a revision counter. RLS restricts reads to members.
- `game_private` contains the round bank, teams, players, assignments, rounds, answers, and votes. Tables have RLS and no client table grants.
- Public `game_action` and `game_state` functions are invoker wrappers around private, narrowly authorized functions. The private functions validate `auth.uid()`, membership, captain/host authority, phase, timer, and vote targets. All functions pin their search paths and deny unauthenticated execution.
- Secret contexts and imposter identity never appear in pre-reveal room snapshots. Each team receives only its assigned context; a spectator host receives none. The browser bundle contains no round-bank secret pairs.
- Imposter selection, answer order, timers, and scoring are database-owned. Room mutations lock the room row to serialize writes.
- Realtime sends only public room metadata. Clients fetch their authorized snapshot after updates. Five-second polling and focus/network events provide recovery. Presence carries user IDs and online status, never context or answers.
- Same-browser sessions and room IDs persist locally. Clearing browser data or changing devices loses the anonymous identity; reconnect on the original device whenever possible.
- Rooms expire after 24 hours. Expiry blocks game actions and snapshots; physical retention is separate. Administrators can periodically delete expired `public.games` rows, which cascade to game data. Anonymous Auth users also require periodic administrative cleanup if desired.
- The UI asks before resetting a room. A host may reveal before everyone votes; the screen shows both vote counts.

## Supabase setup / migrations

The migrations in `supabase/migrations/` are already applied to the requested project. Anonymous sign-ins are enabled. For a new project, apply migrations in order, enable Anonymous Auth, and replace the two public environment values. The game uses the `public` Data API schema; keep `game_private` unexposed. The initial migration adds `public.games` to the Realtime publication.

The trigger-hardening migration revokes client execution of Supabase’s internal `rls_auto_enable` event-trigger function. Security Advisor’s anonymous-access notice is expected for this deliberately anonymous game; the policy still checks room membership. Private tables intentionally have RLS with no policies (default-deny).

## Verify

```sh
npm run build
npm audit
npm test
```

`npm test` uses the configured live project, creates five anonymous test identities and a room, runs a real 60-second round, checks positive and negative authorization paths, reconnection, Realtime, hidden data, late submissions, voting, scoring, and reset. It needs network access and Anonymous Auth. Test room metadata remains until expiry/administrative cleanup. Run `tests/scoring.sql` as an administrator for five additional scoring fixtures; its transaction rolls back everything.

`tests/preview-players.mjs CODE` joins three API-driven test captains to a manually created preview room for visual QA, submits sample answers and votes, and exits at scoreboard. It is a developer helper, not a game feature.

## Deploy to Vercel

This repository is deployment-ready; it has not been published automatically.

- Import this folder/repository into Vercel as a Vite project.
- Build command: `npm run build`; output: `dist`.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` using the values from your local `.env.local` or Supabase dashboard.
- Redeploy after changing build-time environment variables.
- Run a test room on the public HTTPS URL before the club meeting. Check that Supabase has not paused for inactivity.

## Design and source

Game requirements: the live-read `Personal/wiki/gen-ai-club-meeting-2-ai-technicals.md` activity brief, 2026-09-20. All nine prompt/context pairs are included.

The landing page contains only the join/host form and a small brand header. It uses the supplied Quizlet reference’s quiet canvas, white cards, and pill actions with [Gen AI at IU](https://genaiiu.com/) branding, inspected 2026-09-20: crimson `hsl(355 70% 35%)`, cream `hsl(30 25% 96%)`, DM Sans body type, and Playfair Display headings. The layout is responsive, keyboard-operable, and respects reduced motion. Fonts load from Google Fonts with system fallbacks.
