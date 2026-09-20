-- Applied to the linked Supabase project as migration 20260920203036.
alter table public.games
  add column test_mode boolean not null default false;

alter table game_private.players
  add column is_test boolean not null default false;

delete from game_private.votes where kind = 'funniest';

alter table game_private.votes
  drop constraint if exists votes_kind_check,
  add constraint votes_kind_check check (kind = 'imposter');

create or replace function game_private.state(gid uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.games;
  p game_private.players;
  r game_private.rounds;
  b game_private.bank;
  result jsonb;
  revealed boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into g from public.games where id = gid;
  select * into p from game_private.players where game_id = gid and id = auth.uid();
  if p.id is null then raise exception 'Join this room first'; end if;
  if g.expires_at < now() then raise exception 'This room has expired. Create a new room.'; end if;

  select * into r
  from game_private.rounds
  where game_id = gid and number = g.round_number;

  select * into b from game_private.bank where id = r.bank_id;
  revealed := g.phase in ('reveal', 'scoreboard');

  result := jsonb_build_object(
    'game', to_jsonb(g),
    'me', to_jsonb(p),
    'server_time', clock_timestamp(),
    'teams', coalesce((
      select jsonb_agg(
        to_jsonb(t) || jsonb_build_object(
          'captain_id', (
            select id
            from game_private.players
            where team_id = t.id
            order by joined_at, id
            limit 1
          )
        )
        order by t.position
      )
      from game_private.teams t
      where game_id = gid
    ), '[]'::jsonb),
    'players', coalesce((
      select jsonb_agg(to_jsonb(pl) order by joined_at)
      from game_private.players pl
      where game_id = gid
    ), '[]'::jsonb),
    'bank', (
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'title', title,
          'played', exists(
            select 1
            from game_private.rounds rr
            where rr.game_id = gid and rr.bank_id = bb.id
          )
        )
        order by id
      )
      from game_private.bank bb
      where bb.active
    )
  );

  if r.id is not null then
    result := result || jsonb_build_object(
      'round', jsonb_build_object(
        'id', r.id,
        'title', b.title,
        'prompt', b.prompt,
        'ends_at', r.ends_at,
        'context', (
          select context
          from game_private.assignments
          where round_id = r.id and team_id = p.team_id
        ),
        'my_answer', (
          select body
          from game_private.answers
          where round_id = r.id and team_id = p.team_id
        ),
        'submitted', (
          select count(*)
          from game_private.answers
          where round_id = r.id and body <> ''
        ),
        'votes_cast', (
          select count(*)
          from game_private.votes
          where round_id = r.id
        ),
        'my_votes', coalesce((
          select jsonb_object_agg(kind, answer_id)
          from game_private.votes
          where round_id = r.id and team_id = p.team_id
        ), '{}'::jsonb),
        'answers', case
          when g.phase = 'writing' then '[]'::jsonb
          else coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', a.id,
                'body', a.body,
                'is_mine', a.team_id = p.team_id
              ) || case
                when revealed then jsonb_build_object(
                  'team_id', a.team_id,
                  'is_imposter', a.team_id = r.imposter_team,
                  'votes', (
                    select count(*)
                    from game_private.votes v
                    where v.answer_id = a.id
                  )
                )
                else '{}'::jsonb
              end
              order by display_order
            )
            from game_private.answers a
            where round_id = r.id
          ), '[]'::jsonb)
        end
      ) || case
        when revealed then jsonb_build_object(
          'normal_context', b.normal,
          'imposter_context', b.imposter,
          'imposter_team', r.imposter_team
        )
        else '{}'::jsonb
      end
    );
  end if;

  return result;
end;
$$;

create or replace function game_private.action(action text, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  g public.games;
  p game_private.players;
  r game_private.rounds;
  tid uuid;
  aid uuid;
  captain uuid;
  n integer;
  topvotes integer;
  impvotes integer;
  winners integer;
  nick text;
  roomcode text;
  k text;
  tname text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  nick := btrim(payload->>'nickname');

  if action = 'create' then
    if nick is null or length(nick) not between 1 and 24 then raise exception 'Use a nickname of 1–24 characters'; end if;
    if (select count(*) from public.games where host_id = uid and expires_at > now()) >= 5 then raise exception 'You already have five active rooms'; end if;
    loop
      roomcode := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        insert into public.games(code, host_id) values(roomcode, uid) returning id into gid;
        exit;
      exception when unique_violation then null;
      end;
    end loop;
    insert into game_private.players(id, game_id, nickname) values(uid, gid, nick);
    n := coalesce((payload->>'teams')::integer, 4);
    if n not between 3 and 5 then raise exception 'Choose 3–5 teams'; end if;
    for i in 1..n loop
      insert into game_private.teams(game_id, name, position)
      values(gid, 'Team ' || i, i);
    end loop;
    return game_private.state(gid);
  end if;

  if action = 'join' then
    select * into g from public.games where code = upper(btrim(payload->>'code')) for update;
    if g.id is null or g.expires_at < now() then raise exception 'Room not found or expired'; end if;
    if exists(select 1 from game_private.players where game_id = g.id and id = uid) then return game_private.state(g.id); end if;
    if g.phase <> 'lobby' then raise exception 'This game has started. Ask the host to return to the lobby.'; end if;
    if nick is null or length(nick) not between 1 and 24 then raise exception 'Use a nickname of 1–24 characters'; end if;
    if (select count(*) from game_private.players where game_id = g.id) >= 30 then raise exception 'Room is full'; end if;
    insert into game_private.players(id, game_id, nickname) values(uid, g.id, nick);
    update public.games set revision = revision + 1 where id = g.id;
    return game_private.state(g.id);
  end if;

  gid := (payload->>'game_id')::uuid;
  select * into g from public.games where id = gid for update;
  select * into p from game_private.players where game_id = gid and id = uid;
  if g.id is null or p.id is null then raise exception 'Join this room first'; end if;
  if g.expires_at < now() then raise exception 'Room expired'; end if;
  select * into r from game_private.rounds where game_id = gid and number = g.round_number;

  if action = 'team' then
    if g.phase <> 'lobby' then raise exception 'Teams are locked during the game'; end if;
    tid := (payload->>'team_id')::uuid;
    if tid is not null and not exists(select 1 from game_private.teams where id = tid and game_id = gid) then raise exception 'Invalid team'; end if;
    if tid is not null and (select count(*) from game_private.players where team_id = tid and id <> uid) >= 4 then raise exception 'This team is full'; end if;
    if tid is not null and not (select name_locked from game_private.teams where id = tid) then
      select count(*) into n from game_private.players where team_id = tid;
      select id into captain from game_private.players where team_id = tid order by joined_at, id limit 1;
      if n > 0 and uid is distinct from captain then raise exception 'The first team member chooses the team name'; end if;
      tname := btrim(payload->>'team_name');
      if tname is null or length(tname) not between 1 and 24 then raise exception 'Use a team name of 1–24 characters'; end if;
      if exists(select 1 from game_private.teams where game_id = gid and id <> tid and name_locked and lower(name) = lower(tname)) then raise exception 'That team name is already taken'; end if;
      update game_private.teams set name = tname, name_locked = true where id = tid;
    elsif tid is not null and payload ? 'team_name' then
      raise exception 'This team name is already set';
    end if;
    update game_private.players set team_id = tid, joined_at = clock_timestamp() where game_id = gid and id = uid;

  elsif action in ('answer', 'vote') then
    select id into captain from game_private.players where team_id = p.team_id order by joined_at, id limit 1;
    if p.team_id is null or uid is distinct from captain then raise exception 'Your team captain submits for the team'; end if;
    if action = 'answer' then
      if g.phase <> 'writing' or clock_timestamp() >= r.ends_at then raise exception 'Writing time is over'; end if;
      if length(btrim(payload->>'body')) not between 1 and 320 then raise exception 'Write 1–320 characters, in one or two sentences'; end if;
      update game_private.answers set body = btrim(payload->>'body') where round_id = r.id and team_id = p.team_id;
    else
      if g.phase <> 'voting' then raise exception 'Voting is closed'; end if;
      aid := (payload->>'answer_id')::uuid;
      k := payload->>'kind';
      if k is distinct from 'imposter' then raise exception 'Invalid vote type'; end if;
      if not exists(select 1 from game_private.answers where id = aid and round_id = r.id and team_id <> p.team_id and body <> '') then raise exception 'Choose another team’s submitted answer'; end if;
      insert into game_private.votes(round_id, team_id, kind, answer_id)
      values(r.id, p.team_id, 'imposter', aid)
      on conflict(round_id, team_id, kind) do update set answer_id = excluded.answer_id;
    end if;

  else
    if g.host_id <> uid then raise exception 'Only the host can control the game'; end if;

    if action = 'test_setup' then
      if g.phase <> 'lobby' or g.round_number <> 0 then raise exception 'Test teams can only be created in a fresh lobby'; end if;
      if exists(select 1 from game_private.players where game_id = gid and id <> uid and not is_test) then raise exception 'Test mode is only available before other players join'; end if;
      delete from game_private.players where game_id = gid and is_test;
      update game_private.players set team_id = null where game_id = gid and id = uid;
      update game_private.teams
      set name = 'Test Team ' || position,
          name_locked = true
      where game_id = gid and position <= 3;
      insert into game_private.players(id, game_id, nickname, team_id, is_test, joined_at)
      select gen_random_uuid(), gid, 'Test player ' || position, id, true,
             clock_timestamp() + make_interval(secs => position)
      from game_private.teams
      where game_id = gid and position <= 3
      order by position;
      update public.games set test_mode = true where id = gid;

    elsif action = 'test_answers' then
      if not g.test_mode or g.phase <> 'writing' then raise exception 'Test answers are only available during a test round'; end if;
      update game_private.answers a
      set body = 'Test answer from ' || t.name || ': suspiciously specific, but completely plausible.'
      from game_private.teams t
      where a.round_id = r.id and a.team_id = t.id;

    elsif action = 'test_votes' then
      if not g.test_mode or g.phase <> 'voting' then raise exception 'Test votes are only available during test voting'; end if;
      insert into game_private.votes(round_id, team_id, kind, answer_id)
      select
        r.id,
        voter.team_id,
        'imposter',
        coalesce(
          (select id from game_private.answers where round_id = r.id and team_id = r.imposter_team and team_id <> voter.team_id and body <> '' limit 1),
          (select id from game_private.answers where round_id = r.id and team_id <> voter.team_id and body <> '' order by display_order limit 1)
        )
      from (
        select distinct team_id
        from game_private.players
        where game_id = gid and team_id is not null and is_test
      ) voter
      on conflict(round_id, team_id, kind) do update set answer_id = excluded.answer_id;

    elsif action = 'voting' then
      if g.phase <> 'writing' then raise exception 'Not in writing phase'; end if;
      if clock_timestamp() < r.ends_at and exists(
        select 1 from game_private.answers where round_id = r.id and body = ''
      ) then
        raise exception 'Wait for the timer or for every team to submit';
      end if;
      update public.games set phase = 'voting' where id = gid;

    elsif action = 'reveal' then
      if g.phase <> 'voting' or r.scored then raise exception 'This round cannot be scored again'; end if;
      update game_private.teams t
      set score = score + 1
      where t.game_id = gid and exists(
        select 1
        from game_private.votes v
        join game_private.answers a on a.id = v.answer_id
        where v.round_id = r.id and v.team_id = t.id and a.team_id = r.imposter_team
      );
      select count(*) into impvotes
      from game_private.votes v
      join game_private.answers a on a.id = v.answer_id
      where v.round_id = r.id and a.team_id = r.imposter_team;
      select coalesce(max(c), 0) into topvotes
      from (select count(*) c from game_private.votes where round_id = r.id group by answer_id) x;
      select count(*) into winners
      from (
        select answer_id
        from game_private.votes
        where round_id = r.id
        group by answer_id
        having count(*) = topvotes
      ) x;
      if topvotes > 0 and impvotes < topvotes and exists(
        select 1 from game_private.answers where round_id = r.id and team_id = r.imposter_team and body <> ''
      ) then
        update game_private.teams
        set score = score + 2 + case when winners = 1 then 1 else 0 end
        where id = r.imposter_team;
      end if;
      update game_private.rounds set scored = true where id = r.id;
      update public.games set phase = 'reveal' where id = gid;

    elsif action = 'scoreboard' then
      if g.phase <> 'reveal' then raise exception 'Reveal the round first'; end if;
      update public.games set phase = 'scoreboard' where id = gid;

    elsif action = 'reset' then
      delete from game_private.rounds where game_id = gid;
      delete from game_private.players where game_id = gid and is_test;
      if g.test_mode then
        update game_private.teams
        set name = 'Team ' || position,
            name_locked = false
        where game_id = gid;
      end if;
      update game_private.teams set score = 0 where game_id = gid;
      update public.games set phase = 'lobby', round_number = 0, test_mode = false where id = gid;

    else
      raise exception 'Unknown action';
    end if;
  end if;

  update public.games set revision = revision + 1 where id = gid;
  return game_private.state(gid);
end;
$$;
