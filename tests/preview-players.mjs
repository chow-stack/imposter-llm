import { createClient } from "@supabase/supabase-js";
const clients = Array.from({ length: 3 }, () =>
  createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false } },
  ),
);
const call = async (c, action, payload) => {
  const { data, error } = await c.rpc("game_action", { action, payload });
  if (error) throw error;
  return data;
};
let gid;
for (let i = 0; i < 3; i++) {
  await clients[i].auth.signInAnonymously();
  const s = await call(clients[i], "join", {
    code: process.argv[2],
    nickname: ["Ada", "Grace", "Alan"][i],
  });
  gid = s.game.id;
  await call(clients[i], "team", { game_id: gid, team_id: s.teams[i].id });
}
console.log("Preview teams ready");
let answered = false,
  voted = false;
const timer = setInterval(async () => {
  try {
    const { data: s } = await clients[0].rpc("game_state", { p_game_id: gid });
    if (s.game.phase === "writing" && !answered) {
      answered = true;
      for (let i = 0; i < 3; i++)
        await call(clients[i], "answer", {
          game_id: gid,
          body: [
            "Fast, fearless, and already owns half the campus trees.",
            "A resourceful night operator with absolutely no respect for trash-can security.",
            "Small enough to sneak into class, bold enough to demand your lunch.",
          ][i],
        });
      console.log("Preview answers submitted");
    }
    if (s.game.phase === "voting" && !voted) {
      voted = true;
      for (const c of clients) {
        const { data: p } = await c.rpc("game_state", { p_game_id: gid });
        const a = p.round.answers.find((a) => !a.is_mine);
        for (const kind of ["imposter", "funniest"])
          await call(c, "vote", { game_id: gid, kind, answer_id: a.id });
      }
      console.log("Preview votes submitted");
    }
    if (s.game.phase === "scoreboard") {
      clearInterval(timer);
      for (const c of clients) {
        await c.auth.signOut();
        c.realtime.disconnect();
      }
      process.exit(0);
    }
  } catch (e) {
    console.error(e.message);
    clearInterval(timer);
    process.exit(1);
  }
}, 2000);
