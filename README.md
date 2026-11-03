# Imposter LLM

**A multiplayer social-deduction party game where players pretend to be language models.**

Every team gets the same prompt, but one secret *imposter* team gets different private context. Teams write a short answer "as the model", then everyone reads the anonymous answers and votes on who was working from different context. Catch the imposter to score, or blend in as the imposter for a bigger payoff.

Built for the Gen AI Club at Indiana University, as a fun way to show how context shapes model output. It makes no model API calls. All game logic, timing, and scoring run inside Postgres.

![React](https://img.shields.io/badge/React-19-61dafb) ![Vite](https://img.shields.io/badge/Vite-8-646cff) ![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20Postgres%20%2B%20Realtime-3ecf8e) ![License: MIT](https://img.shields.io/badge/license-MIT-blue)

---

## Contents

- [How to play](#how-to-play)
- [Scoring](#scoring)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security and privacy](#security-and-privacy)
- [Project structure](#project-structure)
- [License](#license)

## How to play

1. **Host a room** with 3–5 teams. Four or five teams works best for a group of about 20.
2. **Join.** Players open the room code or link, enter a nickname, and pick a team (up to four players each). The first player on a team names it and becomes captain. One device per team also works, and the host can stay a spectator on the projector.
3. **Start.** The host picks a 60, 75, or 90-second writing timer. The database picks 10 different prompts at random from a bank of 31.
4. **Write.** Each team privately sees its context and submits 1–2 sentences (up to 320 characters). Captains can revise until the deadline, and drafts survive a page refresh.
5. **Vote.** When the timer ends, or once every team has submitted, all answers appear anonymously in a random order. Each captain casts one imposter vote (no self-votes) and can change it until the reveal.
6. **Reveal.** The host reveals identities, both contexts, vote totals, and scores, then moves on. The imposter changes every round. After round 10, the highest score wins.

## Scoring

| Event | Points |
|---|:---:|
| A team correctly identifies the imposter | +1 to that team |
| The imposter gets fewer votes than the most-voted answer | +2 to the imposter |

Edge cases have explicit rules:

- A top-vote tie that includes the imposter counts as a detection.
- If nobody votes, there are no escape points, and an imposter that submits nothing can't earn them either.
- Missing answers show as "No answer submitted" and can't receive votes.
- Scoring runs once, in a locked database transaction. A reset clears rounds and scores but keeps players and teams.

## Architecture

- **Frontend:** React 19, TypeScript, and Vite, as a single-page app.
- **Backend:** Supabase Anonymous Auth, Postgres with Row Level Security, RPC functions, Realtime database changes, and Presence.
- **`public.games`** contains only room metadata and a revision counter, and RLS limits reads to room members.
- **`game_private`** holds the round bank, teams, players, assignments, rounds, answers, and votes. Its tables have RLS enabled and no client grants.
- **Public RPCs** (`game_action`, `game_start`, `game_team`, `game_state`) are `security invoker` wrappers around private functions. Those functions validate `auth.uid()`, membership, captain or host authority, phase, timer, team-name ownership, and vote targets. Every function pins its `search_path` and refuses unauthenticated callers.
- **The database owns the game.** It handles prompt selection, imposter rotation, answer order, timers, the 10-round limit, and scoring. Every room mutation locks the room row to serialize writes.
- **Sync.** Realtime broadcasts only public room metadata, and clients then fetch their own authorized snapshot. Five-second polling plus focus and network events handle recovery. Presence carries only user IDs and online status.

## Getting started

### Prerequisites

- Node.js 20 or newer
- A Supabase project with **Anonymous Sign-ins** enabled (Authentication → Sign In / Providers)

### 1. Install

```bash
git clone https://github.com/chow-stack/imposter-llm.git
cd imposter-llm
npm ci
```

### 2. Set up the database

Apply the migrations in `supabase/migrations/` in order:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Keep the `game_private` schema **unexposed** in the Data API settings. The app uses only the `public` schema.

### 3. Configure the environment

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | `https://<your-project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's **publishable** key (`sb_publishable_...`) |

The build rejects anything other than a publishable key and any other `VITE_SUPABASE_*` variable, so a service-role key can't end up in the browser by mistake.

### 4. Run

```bash
npm run dev
```

Open <http://localhost:5173>.

**Solo testing.** In an empty room, the host can create three test teams. Test mode fills in answers and votes, so one person can walk through every stage. A reset removes the synthetic players.

## Testing

```bash
npm run build     # secret scan + type check + production build
npm audit
npm test          # live integration suite (needs network and Anonymous Auth)
```

`npm test` runs against the project in `.env.local`. It creates five anonymous identities and a room, then checks the start path, positive and negative authorization, reconnection, Realtime, hidden data, early voting, voting, scoring, reset, and the solo test flow.

- `tests/scoring.sql` adds five scoring fixtures. Run it in the SQL editor as an administrator; its transaction rolls everything back.
- `node tests/preview-players.mjs CODE` joins three scripted captains to a room for visual QA.

## Deployment

1. Import the repository into [Vercel](https://vercel.com/new) as a Vite project (build `npm run build`, output `dist`).
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then redeploy whenever they change.
3. Before an event, run a test room on the public URL and check that the Supabase project hasn't been paused for inactivity.

`vercel.json` adds a strict Content Security Policy that limits scripts to the app's origin, connections to Supabase, and fonts to Google Fonts. It also disables framing, object embeds, the camera, the microphone, and geolocation.

## Security and privacy

- **No secret keys anywhere in the app.** The publishable key is meant to be public, and every data access is enforced by authentication, membership checks, and RLS. See [Supabase's API key docs](https://supabase.com/docs/guides/getting-started/api-keys).
- **The pre-build secret scan** (`npm run check:secrets`) rejects tracked private files and common credential formats. It reports file paths and credential types, never the matched values. It is a pattern-based guard, not a guarantee.
- **Hidden information stays hidden.** Secret contexts and the imposter's identity never appear in room snapshots before the reveal. Each team receives only its own context, a spectating host receives none, and the browser bundle contains no prompt or context pairs.
- **Expected advisor notices.** The Supabase Security Advisor flags anonymous access, which is intentional for this game (policies still check membership). Private tables use RLS with no policies, which means default-deny.
- **Data retention.** Rooms expire after 24 hours. Deleting a `public.games` row cascades to all of its game data. Anonymous Auth users need separate cleanup if you want to remove them.

To report a vulnerability, please open a private [security advisory](https://github.com/chow-stack/imposter-llm/security/advisories/new) rather than a public issue.

## Project structure

```
src/
├── main.tsx            React app: join, team picker, writing, voting, reveal, host stage
└── style.css           Party-game styles (responsive phone, tablet, and projector layouts)
supabase/migrations/    Schema, round bank, RPCs, and hardening (apply in order)
scripts/
└── check-secrets.mjs   Pre-build credential scanner
tests/                  Live integration suite, SQL scoring fixtures, preview helper
vercel.json             CSP, security headers, SPA rewrites
```

## License

Released under the [MIT License](LICENSE).
