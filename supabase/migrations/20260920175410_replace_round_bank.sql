alter table game_private.bank
  add column active boolean not null default true;

update game_private.bank set active = false;

insert into game_private.bank(id, title, prompt, normal, imposter, active) values
(10, 'Bad ride', 'The worst thing to hear halfway through this ride:', 'Your ride is an elevator.', 'Your ride is a ski lift.', true),
(11, 'Useless warning', 'The least helpful warning sign at this place:', 'Your place is a zoo.', 'Your place is an aquarium.', true),
(12, 'Terrible update', 'A terrible new feature for this app:', 'Your app is Spotify.', 'Your app is TikTok.', true),
(13, 'Silent judgment', 'What this animal is secretly thinking while staring at you:', 'Your animal is a cat.', 'Your animal is an owl.', true),
(14, 'Bag surprise', 'The worst thing to find at the bottom of this:', 'Your bag is a backpack.', 'Your bag is a gym bag.', true),
(15, 'Worst seatmate', 'The worst person to sit next to here:', 'Your place is an airplane.', 'Your place is a lecture hall.', true),
(16, 'Secret menu', 'The secret menu item nobody should order here:', 'Your place is Starbucks.', 'Your place is Smoothie King.', true),
(17, 'Name that ride', 'A terrible name for this ride:', 'Your ride is a roller coaster.', 'Your ride is a campus bus.', true),
(18, 'Suspicious item', 'The most suspicious thing to bring to this:', 'Your event is an exam.', 'Your event is a job interview.', true),
(19, '2 a.m. smell', 'What this place smells like at 2:00 a.m.:', 'Your place is a dorm hallway.', 'Your place is a hotel hallway.', true),
(20, 'Worst flavor', 'The worst possible flavor of this:', 'Your item is toothpaste.', 'Your item is protein powder.', true),
(21, 'Strange announcement', 'The strangest thing to hear over the speakers here:', 'Your place is an airport.', 'Your place is a grocery store.', true),
(22, 'Final boss', 'The hidden final boss of this place:', 'Your place is a gym.', 'Your place is IKEA.', true),
(23, 'Kicked out', 'Why this object was kicked out of the house:', 'Your object is a smart speaker.', 'Your object is a smoke detector.', true),
(24, 'Embarrassing defeat', 'The most embarrassing way to lose here:', 'Your activity is an escape room.', 'Your activity is laser tag.', true),
(25, 'Employee-only secret', 'What they are hiding in the employee-only room:', 'Your place is an arcade.', 'Your place is a bowling alley.', true),
(26, 'Under the bed', 'The weirdest thing to discover under this bed:', 'Your bed is in a dorm.', 'Your bed is in a hotel.', true);

create function game_private.require_active_round_bank()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from game_private.bank
    where id = new.bank_id and active
  ) then
    raise exception 'Choose an active round';
  end if;
  return new;
end;
$$;

revoke all on function game_private.require_active_round_bank()
from public, anon, authenticated;

create trigger require_active_round_bank_before_write
before insert or update of bank_id on game_private.rounds
for each row execute function game_private.require_active_round_bank();

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
          where round_id = r.id and kind = 'imposter'
        ),
        'funny_votes_cast', (
          select count(*)
          from game_private.votes
          where round_id = r.id and kind = 'funniest'
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
                    where v.answer_id = a.id and kind = 'imposter'
                  ),
                  'funny_votes', (
                    select count(*)
                    from game_private.votes v
                    where v.answer_id = a.id and kind = 'funniest'
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
