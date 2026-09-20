# Imposter LLM project index

Updated: 2026-09-20

- [Run, rules, architecture, deployment](README.md)
- [React interface](src/main.tsx)
- [Brand and responsive styles](src/style.css)
- [Database migrations](supabase/migrations/)
- [Custom team-name migration](supabase/migrations/20260920171213_customizable_team_names.sql)
- [Team-position compatibility migration](supabase/migrations/20260920171258_assign_team_positions.sql)
- [Round-bank replacement migration](supabase/migrations/20260920175410_replace_round_bank.sql)
- [Ten-round game and cascading-delete migration](supabase/migrations/20260920181811_ten_round_games_and_cascade_deletes.sql)
- [Live integration test](tests/integration.mjs)
- [Transactional scoring tests](tests/scoring.sql)
- [Vite development configuration](vite.config.ts)
- [Vercel deployment configuration](vercel.json)
- [Pre-build secret check](scripts/check-secrets.mjs)
- [Change log](log.md)
