create schema if not exists game_private;
revoke all on schema game_private from public, anon;
grant usage on schema game_private to authenticated;
create table public.games (
 id uuid primary key default gen_random_uuid(), code text unique not null,
 host_id uuid not null, phase text not null default 'lobby' check(phase in ('lobby','writing','voting','reveal','scoreboard')),
 round_number int not null default 0, revision int not null default 0,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours'
);
create table game_private.teams(id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games on delete cascade, name text not null, score int not null default 0);
create table game_private.players(id uuid not null, game_id uuid not null references public.games on delete cascade, nickname text not null, team_id uuid references game_private.teams, joined_at timestamptz not null default clock_timestamp(), primary key(game_id,id));
create index on game_private.players(id);
create index on game_private.players(team_id);
create index on game_private.teams(game_id);
create table game_private.bank(id int primary key,title text not null,prompt text not null,normal text not null,imposter text not null);
insert into game_private.bank values
(1,'IU mascot','Pitch this animal as IU’s new mascot without naming the animal. Maximum two sentences.','Your animal is a squirrel.','Your animal is a raccoon.'),
(2,'AI dating profile','Write a dating-app bio for this object without naming it.','Your object is AirPods.','Your object is hearing aids.'),
(3,'One-star review','Write a dramatic one-star review of this place without naming it.','Your place is the library.','Your place is the gym.'),
(4,'Supervillain product pitch','Pitch this product as if it were part of an evil plan. Do not name the product.','Your product is a Stanley cup.','Your product is an air fryer.'),
(5,'Terrible startup','Turn this ordinary item into a ridiculous AI startup. Give it a name and a one-sentence pitch.','Your item is an umbrella.','Your item is sunscreen.'),
(6,'Movie review','Review this movie without using character names, locations, quotations, or major objects from the movie.','Your movie is Titanic.','Your movie is Jaws.'),
(7,'Apology text','Write the apology text this character would send after ruining a group project. Do not name the character.','Your character is Darth Vader.','Your character is Batman.'),
(8,'Kelley professor','Describe this person teaching an 8:00 a.m. Kelley class.','Your person is Gordon Ramsay.','Your person is Snoop Dogg.'),
(9,'Campus survival advice','Give one sentence of survival advice to a new IU student from this character’s perspective. Do not identify the character.','Your character is a squirrel.','Your character is a goose.');
create table game_private.rounds(id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games on delete cascade, number int not null, bank_id int not null references game_private.bank, imposter_team uuid not null references game_private.teams, ends_at timestamptz not null, scored bool not null default false, unique(game_id,number));
create table game_private.assignments(round_id uuid references game_private.rounds on delete cascade,team_id uuid references game_private.teams,context text not null,primary key(round_id,team_id));
create table game_private.answers(id uuid primary key default gen_random_uuid(), round_id uuid not null references game_private.rounds on delete cascade, team_id uuid not null references game_private.teams, body text not null default '', display_order float not null default random(), unique(round_id,team_id));
create table game_private.votes(round_id uuid references game_private.rounds on delete cascade,team_id uuid references game_private.teams,kind text check(kind in ('imposter','funniest')),answer_id uuid not null references game_private.answers,primary key(round_id,team_id,kind));
create index on game_private.votes(answer_id);
alter table public.games enable row level security;
alter table game_private.teams enable row level security;
alter table game_private.players enable row level security;
alter table game_private.bank enable row level security;
alter table game_private.rounds enable row level security;
alter table game_private.assignments enable row level security;
alter table game_private.answers enable row level security;
alter table game_private.votes enable row level security;
revoke all on all tables in schema game_private from public,anon,authenticated;
revoke all on public.games from anon,authenticated;
grant select on public.games to authenticated;
create function game_private.is_member(gid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from game_private.players where game_id=gid and id=auth.uid());$$;
revoke all on function game_private.is_member(uuid) from public,anon;
grant execute on function game_private.is_member(uuid) to authenticated;
create policy room_members on public.games for select to authenticated using(game_private.is_member(id));
alter publication supabase_realtime add table public.games;

create function game_private.state(gid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.games; p game_private.players; r game_private.rounds; b game_private.bank; result jsonb; revealed bool;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into g from public.games where id=gid;
 select * into p from game_private.players where game_id=gid and id=auth.uid();
 if p.id is null then raise exception 'Join this room first'; end if;
 if g.expires_at<now() then raise exception 'This room has expired. Create a new room.'; end if;
 select * into r from game_private.rounds where game_id=gid and number=g.round_number;
 select * into b from game_private.bank where id=r.bank_id;
 revealed:=g.phase in ('reveal','scoreboard');
 result:=jsonb_build_object('game',to_jsonb(g),'me',to_jsonb(p),'server_time',clock_timestamp(),
 'teams',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('captain_id',(select id from game_private.players where team_id=t.id order by joined_at,id limit 1)) order by t.name) from game_private.teams t where game_id=gid),'[]'::jsonb),
 'players',coalesce((select jsonb_agg(to_jsonb(pl) order by joined_at) from game_private.players pl where game_id=gid),'[]'::jsonb),
 'bank',(select jsonb_agg(jsonb_build_object('id',id,'title',title,'played',exists(select 1 from game_private.rounds rr where rr.game_id=gid and rr.bank_id=bb.id)) order by id) from game_private.bank bb));
 if r.id is not null then
 result:=result||jsonb_build_object('round',jsonb_build_object('id',r.id,'title',b.title,'prompt',b.prompt,'ends_at',r.ends_at,
 'context',(select context from game_private.assignments where round_id=r.id and team_id=p.team_id),
 'my_answer',(select body from game_private.answers where round_id=r.id and team_id=p.team_id),
 'submitted',(select count(*) from game_private.answers where round_id=r.id and body<>''),
 'votes_cast',(select count(*) from game_private.votes where round_id=r.id and kind='imposter'),
 'funny_votes_cast',(select count(*) from game_private.votes where round_id=r.id and kind='funniest'),
 'my_votes',coalesce((select jsonb_object_agg(kind,answer_id) from game_private.votes where round_id=r.id and team_id=p.team_id),'{}'::jsonb),
 'answers',case when g.phase='writing' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'body',a.body,'is_mine',a.team_id=p.team_id)||case when revealed then jsonb_build_object('team_id',a.team_id,'is_imposter',a.team_id=r.imposter_team,'votes',(select count(*) from game_private.votes v where v.answer_id=a.id and kind='imposter'),'funny_votes',(select count(*) from game_private.votes v where v.answer_id=a.id and kind='funniest')) else '{}'::jsonb end order by display_order) from game_private.answers a where round_id=r.id),'[]'::jsonb) end
 )||case when revealed then jsonb_build_object('normal_context',b.normal,'imposter_context',b.imposter,'imposter_team',r.imposter_team) else '{}'::jsonb end);
 end if;
 return result;
end;$$;
revoke all on function game_private.state(uuid) from public,anon;
grant execute on function game_private.state(uuid) to authenticated;
create function public.game_state(p_game_id uuid) returns jsonb language sql security invoker set search_path='' as $$select game_private.state(p_game_id);$$;
revoke all on function public.game_state(uuid) from public,anon;
grant execute on function public.game_state(uuid) to authenticated;

create function game_private.action(action text,payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); gid uuid; g public.games; p game_private.players; r game_private.rounds; b game_private.bank; tid uuid; aid uuid; captain uuid; n int; topvotes int; impvotes int; winners int; nick text; roomcode text; k text;
begin
 if uid is null then raise exception 'Sign in first'; end if;
 nick:=btrim(payload->>'nickname');
 if action='create' then
  if nick is null or length(nick) not between 1 and 24 then raise exception 'Use a nickname of 1–24 characters'; end if;
  if (select count(*) from public.games where host_id=uid and expires_at>now())>=5 then raise exception 'You already have five active rooms'; end if;
  loop
   roomcode:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
   begin insert into public.games(code,host_id) values(roomcode,uid) returning id into gid; exit; exception when unique_violation then null; end;
  end loop;
  insert into game_private.players(id,game_id,nickname) values(uid,gid,nick);
  n:=coalesce((payload->>'teams')::int,4);
  if n not between 3 and 5 then raise exception 'Choose 3–5 teams'; end if;
  for i in 1..n loop insert into game_private.teams(game_id,name) values(gid,(array['Token Titans','Context Crew','Neural Nomads','Prompt Society','Attention Please'])[i]); end loop;
  return game_private.state(gid);
 end if;
 if action='join' then
  select * into g from public.games where code=upper(btrim(payload->>'code')) for update;
  if g.id is null or g.expires_at<now() then raise exception 'Room not found or expired'; end if;
  if exists(select 1 from game_private.players where game_id=g.id and id=uid) then return game_private.state(g.id); end if;
  if g.phase<>'lobby' then raise exception 'This game has started. Ask the host to return to the lobby.'; end if;
  if nick is null or length(nick) not between 1 and 24 then raise exception 'Use a nickname of 1–24 characters'; end if;
  if (select count(*) from game_private.players where game_id=g.id)>=30 then raise exception 'Room is full'; end if;
  insert into game_private.players(id,game_id,nickname) values(uid,g.id,nick);
  update public.games set revision=revision+1 where id=g.id;
  return game_private.state(g.id);
 end if;
 gid:=(payload->>'game_id')::uuid;
 select * into g from public.games where id=gid for update;
 select * into p from game_private.players where game_id=gid and id=uid;
 if g.id is null or p.id is null then raise exception 'Join this room first'; end if;
 if g.expires_at<now() then raise exception 'Room expired'; end if;
 select * into r from game_private.rounds where game_id=gid and number=g.round_number;
 if action='team' then
  if g.phase<>'lobby' then raise exception 'Teams are locked during the game'; end if;
  tid:=(payload->>'team_id')::uuid;
  if tid is not null and not exists(select 1 from game_private.teams where id=tid and game_id=gid) then raise exception 'Invalid team'; end if;
  if tid is not null and (select count(*) from game_private.players where team_id=tid and id<>uid)>=4 then raise exception 'This team is full'; end if;
  update game_private.players set team_id=tid,joined_at=clock_timestamp() where game_id=gid and id=uid;
 elsif action in ('answer','vote') then
  select id into captain from game_private.players where team_id=p.team_id order by joined_at,id limit 1;
  if p.team_id is null or uid is distinct from captain then raise exception 'Your team captain submits for the team'; end if;
  if action='answer' then
   if g.phase<>'writing' or clock_timestamp()>=r.ends_at then raise exception 'Writing time is over'; end if;
   if length(btrim(payload->>'body')) not between 1 and 320 then raise exception 'Write 1–320 characters, in one or two sentences'; end if;
   update game_private.answers set body=btrim(payload->>'body') where round_id=r.id and team_id=p.team_id;
  else
   if g.phase<>'voting' then raise exception 'Voting is closed'; end if;
   aid:=(payload->>'answer_id')::uuid; k:=payload->>'kind';
   if k is null or k not in ('imposter','funniest') then raise exception 'Invalid vote type'; end if;
   if not exists(select 1 from game_private.answers where id=aid and round_id=r.id and team_id<>p.team_id and body<>'') then raise exception 'Choose another team’s submitted answer'; end if;
   insert into game_private.votes(round_id,team_id,kind,answer_id) values(r.id,p.team_id,k,aid) on conflict(round_id,team_id,kind) do update set answer_id=excluded.answer_id;
  end if;
 else
  if g.host_id<>uid then raise exception 'Only the host can control the game'; end if;
  if action='start' then
   if g.phase not in ('lobby','scoreboard') then raise exception 'Finish this round first'; end if;
   if (select count(distinct team_id) from game_private.players where game_id=gid)<3 then raise exception 'At least three teams need players'; end if;
   if exists(select 1 from game_private.players where game_id=gid and team_id is null and id<>g.host_id) then raise exception 'Everyone must choose a team'; end if;
   n:=coalesce((payload->>'seconds')::int,75);
   if n not between 60 and 90 then raise exception 'Choose a 60–90 second timer'; end if;
   select * into b from game_private.bank where id=(payload->>'bank_id')::int;
   if b.id is null then raise exception 'Choose a round'; end if;
   select team_id into tid from (select distinct team_id from game_private.players where game_id=gid and team_id is not null) t order by random() limit 1;
   insert into game_private.rounds(game_id,number,bank_id,imposter_team,ends_at) values(gid,g.round_number+1,b.id,tid,clock_timestamp()+make_interval(secs=>n)) returning * into r;
   insert into game_private.assignments select r.id,t.id,case when t.id=tid then b.imposter else b.normal end from game_private.teams t where t.game_id=gid and exists(select 1 from game_private.players where team_id=t.id);
   insert into game_private.answers(round_id,team_id) select round_id,team_id from game_private.assignments where round_id=r.id;
   update public.games set phase='writing',round_number=r.number where id=gid;
  elsif action='voting' then
   if g.phase<>'writing' then raise exception 'Not in writing phase'; end if;
   if clock_timestamp()<r.ends_at then raise exception 'Wait for the writing timer so teams can revise'; end if;
   update public.games set phase='voting' where id=gid;
  elsif action='reveal' then
   if g.phase<>'voting' or r.scored then raise exception 'This round cannot be scored again'; end if;
   update game_private.teams t set score=score+1 where t.game_id=gid and exists(select 1 from game_private.votes v join game_private.answers a on a.id=v.answer_id where v.round_id=r.id and v.team_id=t.id and v.kind='imposter' and a.team_id=r.imposter_team);
   select count(*) into impvotes from game_private.votes v join game_private.answers a on a.id=v.answer_id where v.round_id=r.id and v.kind='imposter' and a.team_id=r.imposter_team;
   select coalesce(max(c),0) into topvotes from (select count(*) c from game_private.votes where round_id=r.id and kind='imposter' group by answer_id) x;
   select count(*) into winners from (select answer_id from game_private.votes where round_id=r.id and kind='imposter' group by answer_id having count(*)=topvotes) x;
   -- Ties including the imposter count as detection. No votes means no escape points.
   if topvotes>0 and impvotes<topvotes and exists(select 1 from game_private.answers where round_id=r.id and team_id=r.imposter_team and body<>'') then
    update game_private.teams set score=score+2+case when winners=1 then 1 else 0 end where id=r.imposter_team;
   end if;
   select coalesce(max(c),0) into topvotes from (select count(*) c from game_private.votes where round_id=r.id and kind='funniest' group by answer_id) x;
   -- A funniest tie awards each tied team one point.
   if topvotes>0 then update game_private.teams t set score=score+1 where exists(select 1 from game_private.answers a join game_private.votes v on v.answer_id=a.id where a.team_id=t.id and v.round_id=r.id and v.kind='funniest' group by a.id having count(*)=topvotes); end if;
   update game_private.rounds set scored=true where id=r.id;
   update public.games set phase='reveal' where id=gid;
  elsif action='scoreboard' then
   if g.phase<>'reveal' then raise exception 'Reveal the round first'; end if;
   update public.games set phase='scoreboard' where id=gid;
  elsif action='reset' then
   delete from game_private.rounds where game_id=gid;
   update game_private.teams set score=0 where game_id=gid;
   update public.games set phase='lobby',round_number=0 where id=gid;
  else raise exception 'Unknown action'; end if;
 end if;
 update public.games set revision=revision+1 where id=gid;
 return game_private.state(gid);
end;$$;
revoke all on function game_private.action(text,jsonb) from public,anon;
grant execute on function game_private.action(text,jsonb) to authenticated;
create function public.game_action(action text,payload jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$select game_private.action(action,payload);$$;
revoke all on function public.game_action(text,jsonb) from public,anon;
grant execute on function public.game_action(text,jsonb) to authenticated;
