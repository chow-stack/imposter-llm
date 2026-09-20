create index answers_team_id_idx on game_private.answers(team_id);
create index assignments_team_id_idx on game_private.assignments(team_id);
create index rounds_bank_id_idx on game_private.rounds(bank_id);
create index rounds_imposter_team_idx on game_private.rounds(imposter_team);
create index votes_team_id_idx on game_private.votes(team_id);
create index games_expires_at_idx on public.games(expires_at);
