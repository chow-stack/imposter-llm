alter table game_private.teams
  add column if not exists name_locked boolean not null default false,
  add column if not exists position integer;

with ranked as (
  select id,
    row_number() over (
      partition by game_id
      order by
        case name
          when 'Token Titans' then 1
          when 'Context Crew' then 2
          when 'Neural Nomads' then 3
          when 'Prompt Society' then 4
          when 'Attention Please' then 5
          else 6
        end,
        name,
        id
    ) as position
  from game_private.teams
  where position is null
)
update game_private.teams t
set position = ranked.position
from ranked
where t.id = ranked.id;

alter table game_private.teams
  alter column position set not null;

alter table game_private.teams
  drop constraint if exists teams_position_check;
alter table game_private.teams
  add constraint teams_position_check check (position between 1 and 5);

create unique index if not exists teams_game_position_idx
  on game_private.teams(game_id, position);

create function game_private.require_named_team()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.team_id is not null
    and not (select name_locked from game_private.teams where id = new.team_id)
  then
    raise exception 'Choose a team name before joining';
  end if;
  return new;
end;
$$;

revoke all on function game_private.require_named_team() from public, anon, authenticated;

create trigger require_named_team_before_join
before insert or update of team_id on game_private.players
for each row execute function game_private.require_named_team();

create function game_private.choose_team(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  gid uuid := (payload->>'game_id')::uuid;
  tid uuid := (payload->>'team_id')::uuid;
  g public.games;
  p game_private.players;
  captain uuid;
  member_count integer;
  tname text;
begin
  if uid is null then raise exception 'Sign in first'; end if;

  select * into g from public.games where id = gid for update;
  select * into p from game_private.players where game_id = gid and id = uid;

  if g.id is null or p.id is null then raise exception 'Join this room first'; end if;
  if g.expires_at < now() then raise exception 'Room expired'; end if;
  if g.phase <> 'lobby' then raise exception 'Teams are locked during the game'; end if;

  if tid is null then
    update game_private.players
    set team_id = null, joined_at = clock_timestamp()
    where game_id = gid and id = uid;
  else
    if not exists (
      select 1 from game_private.teams where id = tid and game_id = gid
    ) then
      raise exception 'Invalid team';
    end if;

    if (
      select count(*) from game_private.players where team_id = tid and id <> uid
    ) >= 4 then
      raise exception 'This team is full';
    end if;

    if not (select name_locked from game_private.teams where id = tid) then
      select count(*) into member_count
      from game_private.players where team_id = tid;

      select id into captain
      from game_private.players
      where team_id = tid
      order by joined_at, id
      limit 1;

      if member_count > 0 and uid is distinct from captain then
        raise exception 'The first team member chooses the team name';
      end if;

      tname := btrim(payload->>'team_name');
      if tname is null or length(tname) not between 1 and 24 then
        raise exception 'Use a team name of 1–24 characters';
      end if;

      if exists (
        select 1
        from game_private.teams
        where game_id = gid
          and id <> tid
          and name_locked
          and lower(name) = lower(tname)
      ) then
        raise exception 'That team name is already taken';
      end if;

      update game_private.teams
      set name = tname, name_locked = true
      where id = tid;
    elsif payload ? 'team_name' then
      raise exception 'This team name is already set';
    end if;

    update game_private.players
    set team_id = tid, joined_at = clock_timestamp()
    where game_id = gid and id = uid;
  end if;

  update public.games set revision = revision + 1 where id = gid;
  return game_private.state(gid);
end;
$$;

revoke all on function game_private.choose_team(jsonb) from public, anon;
grant execute on function game_private.choose_team(jsonb) to authenticated;

create function public.game_team(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select game_private.choose_team(payload);
$$;

revoke all on function public.game_team(jsonb) from public, anon;
grant execute on function public.game_team(jsonb) to authenticated;
