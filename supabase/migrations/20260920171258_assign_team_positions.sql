create function game_private.assign_team_position()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1
    into new.position
    from game_private.teams
    where game_id = new.game_id;
  end if;
  return new;
end;
$$;

revoke all on function game_private.assign_team_position()
from public, anon, authenticated;

create trigger assign_team_position_before_insert
before insert on game_private.teams
for each row execute function game_private.assign_team_position();
