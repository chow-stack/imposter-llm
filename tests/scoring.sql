begin;
do $$
declare g uuid; h uuid; t uuid[]; a uuid[]; rid uuid; imp uuid; got int; s jsonb;
begin
 for scenario in 1..5 loop
  h:=gen_random_uuid(); perform set_config('request.jwt.claim.sub',h::text,true);
  s:=public.game_action('create',jsonb_build_object('nickname','Scoring fixture','teams',4));g:=(s->'game'->>'id')::uuid;
  select array_agg(id order by name) into t from game_private.teams where game_id=g;
  for i in 1..4 loop insert into game_private.players(id,game_id,nickname,team_id) values(gen_random_uuid(),g,'Fixture '||i,t[i]); end loop;
  s:=public.game_action('start',jsonb_build_object('game_id',g,'bank_id',1,'seconds',60));rid:=(s->'round'->>'id')::uuid;
  update game_private.rounds set imposter_team=t[1] where id=rid;
  select array_agg(id order by array_position(t,team_id)) into a from game_private.answers where round_id=rid;
  update game_private.answers set body='Fixture answer.' where round_id=rid;
  update public.games set phase='voting' where id=g;
  if scenario=1 then -- Escape with unique scapegoat = 3.
   insert into game_private.votes values(rid,t[1],'imposter',a[2]),(rid,t[3],'imposter',a[2]),(rid,t[4],'imposter',a[2]),(rid,t[2],'imposter',a[1]);
  elsif scenario=2 then -- Escape with tied innocent teams = 2.
   insert into game_private.votes values(rid,t[1],'imposter',a[2]),(rid,t[3],'imposter',a[2]),(rid,t[2],'imposter',a[3]),(rid,t[4],'imposter',a[3]);
  elsif scenario=3 then -- Imposter tied for top is detected = 0.
   insert into game_private.votes values(rid,t[2],'imposter',a[1]),(rid,t[3],'imposter',a[1]),(rid,t[1],'imposter',a[2]),(rid,t[4],'imposter',a[2]);
  elsif scenario=4 then -- No votes = no awards.
   null;
  else -- No imposter answer = no escape; funniest tie gives 1 to both.
   update game_private.answers set body='' where id=a[1];
   insert into game_private.votes values(rid,t[1],'imposter',a[2]),(rid,t[3],'imposter',a[2]),(rid,t[1],'funniest',a[2]),(rid,t[2],'funniest',a[3]);
  end if;
  s:=public.game_action('reveal',jsonb_build_object('game_id',g));
  select score into got from game_private.teams where id=t[1];
  if got<>(case scenario when 1 then 3 when 2 then 2 else 0 end) then raise exception 'Scenario %: imposter got %',scenario,got; end if;
  if scenario=3 and (select count(*) from game_private.teams where id=any(t[2:3]) and score=1)<>2 then raise exception 'Detection awards incorrect'; end if;
  if scenario=5 and (select count(*) from game_private.teams where id=any(t[2:3]) and score=1)<>2 then raise exception 'Funniest tie incorrect'; end if;
 end loop;
end $$;
rollback;
