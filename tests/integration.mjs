import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const url = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const clients = Array.from({ length: 5 }, () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);
const call = async (c, action, payload = {}) => {
  const { data, error } = await c.rpc("game_action", { action, payload });
  assert.equal(error, null, error?.message);
  return data;
};
const denied = async (c, action, payload) => {
  const { error } = await c.rpc("game_action", { action, payload });
  assert.ok(error, action + " must be denied");
};
const snapshot = async (c) => {
  const { data, error } = await c.rpc("game_state", { p_game_id: gid });
  assert.equal(error, null, error?.message);
  return data;
};
for (const c of clients) {
  const { error } = await c.auth.signInAnonymously();
  assert.equal(error, null, error?.message);
}
const [host, a, b, c, outsider] = clients;
let s = await call(host, "create", { nickname: "Integration host", teams: 3 });
const gid = s.game.id;
console.log("Test room:", s.game.code, "id:", gid);
const players = [a, b, c];
for (let i = 0; i < 3; i++) {
  await call(players[i], "join", {
    nickname: "Test captain " + i,
    code: s.game.code,
  });
  await call(players[i], "team", { game_id: gid, team_id: s.teams[i].id });
}
assert.equal((await outsider.rpc("game_state", { p_game_id: gid })).data, null);
assert.deepEqual(
  (await outsider.from("games").select("*").eq("id", gid)).data,
  [],
);
assert.ok(
  (await a.from("games").update({ phase: "reveal" }).eq("id", gid)).error,
);
assert.ok((await a.schema("game_private").from("rounds").select("*")).error);
await denied(a, "start", { game_id: gid, bank_id: 1, seconds: 60 });
let changes = 0;
const channel = a
  .channel("integration:" + gid)
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "games",
      filter: "id=eq." + gid,
    },
    () => changes++,
  );
await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(Error("Realtime subscribe timeout")),
    15000,
  );
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timeout);
      resolve();
    }
  });
});
s = await call(host, "start", { game_id: gid, bank_id: 1, seconds: 60 });
assert.equal(s.round.context, null);
assert.equal(s.round.imposter_team, undefined);
assert.equal(s.round.normal_context, undefined);
assert.deepEqual(s.round.answers, []);
const writing = await Promise.all(players.map(snapshot));
const imposters = writing
  .map((x, i) => (x.round.context.includes("raccoon") ? i : -1))
  .filter((i) => i >= 0);
assert.equal(imposters.length, 1);
for (let i = 0; i < 3; i++) {
  assert.equal(writing[i].round.imposter_team, undefined);
  await call(players[i], "answer", {
    game_id: gid,
    body: "Convincing answer " + i + ".",
  });
}
await call(a, "answer", { game_id: gid, body: "Revised answer zero." });
await denied(a, "team", { game_id: gid, team_id: s.teams[1].id });
await denied(host, "voting", { game_id: gid });
await denied(outsider, "join", { nickname: "Late", code: s.game.code });
const {
  data: { session },
} = await a.auth.getSession();
const reconnected = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
await reconnected.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
assert.equal((await snapshot(reconnected)).me.id, writing[0].me.id);
console.log(
  "PASS auth, room membership, host authority, private context, answer revision, team lock, reconnect. Waiting for server timer…",
);
await new Promise((r) =>
  setTimeout(r, Math.max(0, Date.parse(s.round.ends_at) - Date.now() + 500)),
);
await denied(a, "answer", { game_id: gid, body: "Too late." });
s = await call(host, "voting", { game_id: gid });
assert.equal(s.round.answers.length, 3);
for (const ans of s.round.answers) {
  assert.equal(ans.team_id, undefined);
  assert.equal(ans.is_imposter, undefined);
  assert.equal(ans.votes, undefined);
}
const votes = await Promise.all(players.map(snapshot));
const imp = imposters[0],
  normal = [0, 1, 2].filter((i) => i !== imp),
  impAnswer = votes[imp].round.answers.find((x) => x.is_mine).id;
for (let i = 0; i < 3; i++)
  await denied(players[i], "vote", {
    game_id: gid,
    kind: "imposter",
    answer_id: votes[i].round.answers.find((x) => x.is_mine).id,
  });
// Two normal teams identify the imposter; imposter votes for a normal team.
for (let i = 0; i < 3; i++) {
  const other = votes[i].round.answers.find((x) => !x.is_mine);
  await call(players[i], "vote", {
    game_id: gid,
    kind: "imposter",
    answer_id: i === imp ? other.id : impAnswer,
  });
  await call(players[i], "vote", {
    game_id: gid,
    kind: "funniest",
    answer_id: other.id,
  });
}
await denied(a, "reveal", { game_id: gid });
s = await call(host, "reveal", { game_id: gid });
assert.equal(s.round.imposter_team, writing[imp].me.team_id);
assert.ok(s.round.normal_context);
assert.ok(s.round.imposter_context);
const topFunny = Math.max(...s.round.answers.map((x) => x.funny_votes));
for (let i = 0; i < 3; i++) {
  const answer = s.round.answers.find(
    (x) => x.team_id === writing[i].me.team_id,
  );
  const expected =
    (normal.includes(i) ? 1 : 0) + (answer.funny_votes === topFunny ? 1 : 0);
  assert.equal(s.teams.find((x) => x.id === answer.team_id).score, expected);
}
await denied(host, "reveal", { game_id: gid });
await denied(a, "vote", {
  game_id: gid,
  kind: "funniest",
  answer_id: impAnswer,
});
s = await call(host, "scoreboard", { game_id: gid });
assert.equal(s.game.phase, "scoreboard");
s = await call(host, "reset", { game_id: gid });
assert.equal(s.game.phase, "lobby");
assert.equal(s.game.round_number, 0);
assert.ok(s.teams.every((x) => x.score === 0));
assert.equal(s.round, undefined);
assert.ok(changes > 0, "Realtime delivered room updates");
await a.removeChannel(channel);
for (const client of [...clients, reconnected]) await client.auth.signOut();
console.log(
  "PASS timer enforcement, anonymous answer ordering, self-vote prevention, scoring, duplicate reveal protection, reset, Realtime (" +
    changes +
    " updates).",
);

for (const client of [...clients, reconnected]) client.realtime.disconnect();
process.exit(0);
