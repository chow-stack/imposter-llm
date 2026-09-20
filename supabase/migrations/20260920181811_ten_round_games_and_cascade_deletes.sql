insert into game_private.bank(id, title, prompt, normal, imposter, active) values
(27, 'Bad cake', 'The worst thing to write on the cake:', 'Your event is a birthday party.', 'Your event is a retirement party.', true),
(28, 'Confiscated', 'The weirdest thing security confiscated here:', 'Your place is an airport.', 'Your place is a football stadium.', true),
(29, 'Wrong soundtrack', 'The worst song to play during this:', 'Your event is a wedding.', 'Your event is a graduation.', true),
(30, 'Do not touch', 'What happened to the last person who touched this:', 'Your object is a museum exhibit.', 'Your object is science-lab equipment.', true),
(31, 'Suspicious smell', 'A smell that should absolutely not be coming from this place:', 'Your place is a bakery.', 'Your place is a candle store.', true),
(32, 'Free sample', 'The one thing nobody wants as a free sample here:', 'Your place is a grocery store.', 'Your place is a pharmacy.', true),
(33, 'Forgot to pack', 'The worst thing to realize you forgot:', 'Your trip is a beach trip.', 'Your trip is a ski trip.', true),
(34, 'Waiting room', 'The weirdest thing to see in this waiting room:', 'Your waiting room is at a dentist.', 'Your waiting room is at an eye doctor.', true),
(35, 'Lost and found', 'The strangest thing in the lost and found:', 'Your place is a water park.', 'Your place is an amusement park.', true),
(36, 'Denied entry', 'The weirdest reason someone was not allowed inside:', 'Your place is a nightclub.', 'Your place is an amusement park.', true);

alter table public.games
  add column round_seconds integer not null default 75
  constraint games_round_seconds_check check (round_seconds between 60 and 90);

alter table game_private.players
  drop constraint if exists players_team_id_fkey,
  add constraint players_team_id_fkey
    foreign key (team_id) references game_private.teams(id) on delete set null;

alter table game_private.rounds
  drop constraint if exists rounds_imposter_team_fkey,
  add constraint rounds_imposter_team_fkey
    foreign key (imposter_team) references game_private.teams(id) on delete cascade;

alter table game_private.assignments
  drop constraint if exists assignments_team_id_fkey,
  add constraint assignments_team_id_fkey
    foreign key (team_id) references game_private.teams(id) on delete cascade;

alter table game_private.answers
  drop constraint if exists answers_team_id_fkey,
  add constraint answers_team_id_fkey
    foreign key (team_id) references game_private.teams(id) on delete cascade;

alter table game_private.votes
  drop constraint if exists votes_team_id_fkey,
  add constraint votes_team_id_fkey
    foreign key (team_id) references game_private.teams(id) on delete cascade,
  drop constraint if exists votes_answer_id_fkey,
  add constraint votes_answer_id_fkey
    foreign key (answer_id) references game_private.answers(id) on delete cascade;

create function game_private.require_random_round_start()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('game_private.random_round_start', true), '') <> 'on' then
    raise exception 'Rounds must be started through game_start';
  end if;
  return new;
end;
$$;

revoke all on function game_private.require_random_round_start()
from public, anon, authenticated;

create trigger require_random_round_start_before_insert
before insert on game_private.rounds
for each row execute function game_private.require_random_round_start();

create function game_private.start_round(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  gid uuid := (payload->>'game_id')::uuid;
  g public.games;
  p game_private.players;
  r game_private.rounds;
  b game_private.bank;
  tid uuid;
  previous_imposter uuid;
  seconds integer;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  select * into g from public.games where id = gid for update;
  select * into p from game_private.players where game_id = gid and id = uid;

  if g.id is null or p.id is null then raise exception 'Join this room first'; end if;
  if g.expires_at < now() then raise exception 'Room expired'; end if;
  if g.host_id <> uid then raise exception 'Only the host can control the game'; end if;
  if g.phase not in ('lobby', 'scoreboard') then raise exception 'Finish this round first'; end if;
  if g.round_number >= 10 then raise exception 'This game is complete'; end if;

  if (
    select count(distinct team_id)
    from game_private.players
    where game_id = gid
  ) < 3 then
    raise exception 'At least three teams need players';
  end if;

  if exists (
    select 1
    from game_private.players
    where game_id = gid and team_id is null and id <> g.host_id
  ) then
    raise exception 'Everyone must choose a team';
  end if;

  if g.phase = 'lobby' then
    seconds := coalesce((payload->>'seconds')::integer, 75);
    if seconds not between 60 and 90 then
      raise exception 'Choose a 60–90 second timer';
    end if;
  else
    seconds := g.round_seconds;
  end if;

  select bb.* into b
  from game_private.bank bb
  where bb.active
    and not exists (
      select 1
      from game_private.rounds played
      where played.game_id = gid and played.bank_id = bb.id
    )
  order by random()
  limit 1;

  if b.id is null then raise exception 'Not enough active rounds remain'; end if;

  select imposter_team into previous_imposter
  from game_private.rounds
  where game_id = gid and number = g.round_number;

  select team_id into tid
  from (
    select distinct team_id
    from game_private.players
    where game_id = gid and team_id is not null
  ) active_team
  where team_id is distinct from previous_imposter
  order by random()
  limit 1;

  perform set_config('game_private.random_round_start', 'on', true);

  insert into game_private.rounds(
    game_id,
    number,
    bank_id,
    imposter_team,
    ends_at
  ) values (
    gid,
    g.round_number + 1,
    b.id,
    tid,
    clock_timestamp() + make_interval(secs => seconds)
  )
  returning * into r;

  insert into game_private.assignments(round_id, team_id, context)
  select
    r.id,
    t.id,
    case when t.id = tid then b.imposter else b.normal end
  from game_private.teams t
  where t.game_id = gid
    and exists (
      select 1 from game_private.players where team_id = t.id
    );

  insert into game_private.answers(round_id, team_id)
  select round_id, team_id
  from game_private.assignments
  where round_id = r.id;

  update public.games
  set phase = 'writing',
      round_number = r.number,
      round_seconds = seconds,
      revision = revision + 1
  where id = gid;

  return game_private.state(gid);
end;
$$;

revoke all on function game_private.start_round(jsonb) from public, anon;
grant execute on function game_private.start_round(jsonb) to authenticated;

create function public.game_start(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select game_private.start_round(payload);
$$;

revoke all on function public.game_start(jsonb) from public, anon;
grant execute on function public.game_start(jsonb) to authenticated;
