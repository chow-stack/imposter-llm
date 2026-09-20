import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  Copy,
  Crown,
  Eye,
  Fingerprint,
  FlaskConical,
  HelpCircle,
  LockKeyhole,
  Menu,
  RotateCcw,
  Trophy,
  X,
} from "lucide-react";
import "./style.css";
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
type Team = {
  id: string;
  name: string;
  name_locked: boolean;
  position: number;
  score: number;
  captain_id: string;
};
type Player = { id: string; nickname: string; team_id: string | null };
type Answer = {
  id: string;
  body: string;
  is_mine: boolean;
  team_id?: string;
  is_imposter?: boolean;
  votes?: number;
};
type State = {
  game: {
    id: string;
    code: string;
    host_id: string;
    phase: string;
    round_number: number;
    revision: number;
    test_mode: boolean;
  };
  me: Player;
  players: Player[];
  teams: Team[];
  server_time: string;
  bank: { id: number; title: string; played: boolean }[];
  round?: {
    id: string;
    title: string;
    prompt: string;
    context: string | null;
    ends_at: string;
    my_answer: string;
    submitted: number;
    votes_cast: number;
    my_votes: Record<string, string>;
    answers: Answer[];
    normal_context?: string;
    imposter_context?: string;
    imposter_team?: string;
  };
};
function App() {
  const [state, setState] = useState<State | null>(null),
    [mode, setMode] = useState<"join" | "create">("join"),
    [nick, setNick] = useState(localStorage.getItem("imposter-nickname") || ""),
    [code, setCode] = useState(
      new URLSearchParams(location.search).get("room") || "",
    ),
    [teams, setTeams] = useState(4),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [panel, setPanel] = useState<null | "rules" | "menu" | "reset">(null),
    [secret, setSecret] = useState(false),
    [draft, setDraft] = useState(""),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [seconds, setSeconds] = useState(75),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState<string[]>([]),
    [copied, setCopied] = useState(false),
    [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const lastRound = useRef(""),
    current = useRef<State | null>(null),
    inflight = useRef(false);
  function accept(s: State) {
    if (
      current.current?.game.id === s.game.id &&
      current.current.game.revision > s.game.revision
    )
      return;
    current.current = s;
    setState(s);
    setOffset(Date.parse(s.server_time) - Date.now());
    localStorage.setItem("imposter-room", s.game.id);
    if (s.round?.id !== lastRound.current) {
      lastRound.current = s.round?.id || "";
      setSecret(false);
      setDraft(
        s.round
          ? localStorage.getItem("draft-" + s.round.id) ||
              s.round.my_answer ||
              ""
          : "",
      );
    }
  }
  async function auth() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error)
        throw new Error(
          error.message.includes("disabled")
            ? "Anonymous sign-ins need to be enabled in this game’s Supabase project."
            : error.message,
        );
    }
  }
  async function refresh(id: string) {
    const { data, error } = await supabase.rpc("game_state", { p_game_id: id });
    if (error) throw error;
    if (current.current?.game.id === id || !current.current) accept(data);
  }
  async function act(action: string, payload: Record<string, unknown> = {}) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setError("");
    try {
      await auth();
      const request = { game_id: state?.game.id, ...payload };
      const { data, error } =
        action === "team"
          ? await supabase.rpc("game_team", { payload: request })
          : action === "start"
            ? await supabase.rpc("game_start", { payload: request })
            : await supabase.rpc("game_action", { action, payload: request });
      if (error) throw error;
      accept(data);
      if (action === "create" || action === "join")
        localStorage.setItem("imposter-nickname", nick);
      if (action === "reset") setPanel(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : (e as { message: string }).message ||
              "Something went wrong. Try again.",
      );
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    const id = localStorage.getItem("imposter-room");
    if (id) {
      auth()
        .then(() => refresh(id))
        .catch((e) => {
          setError(e.message);
          localStorage.removeItem("imposter-room");
        });
    }
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!state) return;
    const id = state.game.id;
    let active = true;
    const channel = supabase
      .channel("room:" + id, { config: { presence: { key: state.me.id } } })
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: "id=eq." + id,
        },
        () => {
          refresh(id).catch(() => {});
        },
      )
      .on("presence", { event: "sync" }, () => {
        setOnline(Object.keys(channel.presenceState()));
      })
      .subscribe((status) => {
        if (!active) return;
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") channel.track({ online: true });
      });
    const timer = setInterval(
      () => refresh(id).catch(() => setConnected(false)),
      5000,
    );
    function focus() {
      refresh(id).catch(() => {});
    }
    window.addEventListener("online", focus);
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", focus);
      window.removeEventListener("focus", focus);
      supabase.removeChannel(channel);
    };
  }, [state?.game.id]);
  useEffect(() => {
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
      if (e.key === "Tab") {
        const dialog = document.querySelector("[role=dialog]");
        const nodes = dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a, input, select, textarea",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [panel]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state?.game.phase]);
  const host = state?.game.host_id === state?.me.id,
    phase = state?.game.phase,
    round = state?.round,
    myTeam = state?.teams.find((t) => t.id === state.me.team_id),
    captain = myTeam?.captain_id === state?.me.id,
    remaining = round
      ? Math.max(
          0,
          Math.ceil((Date.parse(round.ends_at) - now - offset) / 1000),
        )
      : 0,
    activeTeams =
      state?.teams.filter((t) =>
        state.players.some((p) => p.team_id === t.id),
      ) || [],
    gameComplete = (state?.game.round_number || 0) >= 10,
    topScore = Math.max(...activeTeams.map((t) => t.score), 0),
    winners = activeTeams.filter((t) => t.score === topScore),
    allSubmitted = Boolean(
      round && activeTeams.length > 0 && round.submitted === activeTeams.length,
    );
  function leave() {
    current.current = null;
    setState(null);
    localStorage.removeItem("imposter-room");
    setError("");
    history.replaceState(null, "", location.pathname);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        location.origin + "/?room=" + state?.game.code,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy this room code: " + state?.game.code);
    }
  }
  const TONES = 5,
    orderedTeams = [...(state?.teams || [])].sort(
      (a, b) => a.position - b.position,
    ),
    toneOf = (id?: string) =>
      Math.max(
        0,
        orderedTeams.findIndex((t) => t.id === id),
      ) % TONES,
    teamName = (id?: string) => state?.teams.find((t) => t.id === id)?.name,
    ranked = [...activeTeams].sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name),
    ),
    rankOf = (t: Team) => ranked.findIndex((x) => x.score === t.score) + 1,
    playerCount =
      state?.players.filter((p) => p.id !== state.game.host_id).length || 0,
    joinable = state?.players.filter(
      (p) => !p.team_id && p.id !== state.game.host_id,
    );

  const timer = (cls: string) => (
    <div
      role="img"
      aria-label={remaining ? `${remaining} seconds left` : "Time is up"}
      className={
        "timer " +
        cls +
        (remaining > 0 && remaining <= 10 ? " urgent" : "") +
        (remaining === 0 ? " done" : "")
      }
    >
      <strong>{remaining}</strong>
      <small>{remaining ? "seconds" : "pens down"}</small>
    </div>
  );

  function answerTile(a: Answer, i: number) {
    const reveal = phase === "reveal",
      chosen = round?.my_votes.imposter === a.id,
      tone = reveal && a.team_id ? toneOf(a.team_id) : i % TONES,
      canVote = phase === "voting" && captain && !a.is_mine && Boolean(a.body),
      cls =
        "tile answer tone-" +
        tone +
        (chosen ? " chosen" : "") +
        (a.is_mine ? " own" : "") +
        (reveal ? (a.is_imposter ? " culprit" : " innocent") : "");
    const inner = (
      <>
        <span className="answer-top">
          <span className="letter">{String.fromCharCode(65 + i)}</span>
          {reveal ? (
            <span className="tag">{teamName(a.team_id)}</span>
          ) : (
            a.is_mine && <span className="tag">Your team</span>
          )}
          {reveal && a.is_imposter && (
            <span className="tag tag-ink">
              <Fingerprint size={14} /> Imposter
            </span>
          )}
          {chosen && (
            <span className="tag tag-ink">
              <Check size={14} /> Your vote
            </span>
          )}
        </span>
        <span className="answer-body">{a.body || "No answer submitted."}</span>
        {reveal && (
          <span className="answer-votes">
            <Fingerprint size={18} /> {a.votes ?? 0}{" "}
            {a.votes === 1 ? "vote" : "votes"}
          </span>
        )}
      </>
    );
    return canVote ? (
      <button
        key={a.id}
        className={cls}
        aria-pressed={chosen}
        onClick={() => act("vote", { answer_id: a.id, kind: "imposter" })}
      >
        {inner}
      </button>
    ) : (
      <article key={a.id} className={cls}>
        {inner}
      </article>
    );
  }

  function verdict() {
    if (!round || !myTeam) return null;
    const culprit = round.answers.find((a) => a.is_imposter),
      voted = round.my_votes.imposter;
    if (culprit?.is_mine)
      return { kind: "was", text: "That was you. You were the imposter." };
    if (voted && voted === culprit?.id)
      return { kind: "win", text: "Your team spotted it. +1" };
    if (voted) return { kind: "miss", text: "Your team guessed wrong." };
    return { kind: "miss", text: "Your team didn’t vote." };
  }

  let info: ReactNode = null,
    actions: ReactNode = null;
  const testButton = (label: string, action: string) => (
    <button
      className="btn btn-ghost"
      disabled={busy}
      onClick={() => act(action)}
    >
      <FlaskConical size={16} /> {label}
    </button>
  );
  if (host && state) {
    if (phase === "lobby") {
      info =
        activeTeams.length < 3
          ? `${activeTeams.length} of 3 teams ready`
          : `${activeTeams.length} teams ready`;
      actions = (
        <>
          {!state.game.test_mode &&
            activeTeams.length === 0 &&
            testButton("Test teams", "test_setup")}
          {state.game.test_mode && (
            <span className="chip chip-test">
              <FlaskConical size={14} /> Test mode
            </span>
          )}
          <div
            className="segmented seg-light"
            role="radiogroup"
            aria-label="Time per round"
          >
            {[60, 75, 90].map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={seconds === s}
                className={seconds === s ? "on" : ""}
                onClick={() => setSeconds(s)}
              >
                {s}s
              </button>
            ))}
          </div>
          <button
            disabled={busy || activeTeams.length < 3}
            className="btn btn-light btn-lg"
            onClick={() => act("start", { seconds })}
          >
            Start game <ArrowRight size={20} />
          </button>
        </>
      );
    } else if (round && phase === "writing") {
      info = allSubmitted
        ? "Every team is in"
        : remaining
          ? `${round.submitted} of ${activeTeams.length} teams submitted`
          : "Time’s up. Missing answers stay blank.";
      actions = (
        <>
          {state.game.test_mode &&
            !allSubmitted &&
            testButton("Fill test answers", "test_answers")}
          <button
            className="btn btn-light btn-lg"
            disabled={busy || (remaining > 0 && !allSubmitted)}
            onClick={() => act("voting")}
          >
            Open voting <ArrowRight size={20} />
          </button>
        </>
      );
    } else if (round && phase === "voting") {
      info = `${round.votes_cast} of ${activeTeams.length} teams voted`;
      actions = (
        <>
          {state.game.test_mode && testButton("Cast test votes", "test_votes")}
          <button
            className="btn btn-light btn-lg"
            disabled={busy}
            onClick={() => act("reveal")}
          >
            Reveal the imposter <ArrowRight size={20} />
          </button>
        </>
      );
    } else if (round && phase === "reveal") {
      info = "Scores are in";
      actions = (
        <button
          className="btn btn-light btn-lg"
          disabled={busy}
          onClick={() => act("scoreboard")}
        >
          Scoreboard <ArrowRight size={20} />
        </button>
      );
    } else if (round && phase === "scoreboard") {
      info = gameComplete
        ? "Game complete · 10 rounds played"
        : `Round ${state.game.round_number} done`;
      actions = gameComplete ? (
        <button
          className="btn btn-light btn-lg"
          onClick={() => setPanel("reset")}
        >
          <RotateCcw size={18} /> Play again
        </button>
      ) : (
        <button
          className="btn btn-light btn-lg"
          disabled={busy}
          onClick={() => act("start")}
        >
          Start round {state.game.round_number + 1} <ArrowRight size={20} />
        </button>
      );
    }
  }

  const v = phase === "reveal" ? verdict() : null,
    culprit = round?.answers.find((a) => a.is_imposter),
    culpritName =
      teamName(culprit?.team_id) || teamName(round?.imposter_team) || "A team";

  return (
    <div
      className={
        "app " +
        (!state ? "is-landing" : host ? "is-host" : "is-player") +
        (phase ? " phase-" + phase : "")
      }
    >
      {state && (
        <header className="topbar">
          <div className="topbar-in">
            <span className="brand">
              <span className="brand-mark">
                <Fingerprint size={20} />
              </span>
              <span className="brand-word">
                imposter<i>/llm</i>
              </span>
            </span>
            {myTeam?.name_locked && (
              <span className={"chip team-chip tone-" + toneOf(myTeam.id)}>
                {myTeam.name}
              </span>
            )}
            {phase !== "lobby" && (
              <div
                className="pips"
                role="img"
                aria-label={`Round ${state.game.round_number} of 10`}
              >
                {Array.from({ length: 10 }, (_, i) => (
                  <i
                    key={i}
                    className={i < state.game.round_number ? "on" : ""}
                  />
                ))}
              </div>
            )}
            <span className="spacer" />
            {host && (
              <button
                className="code-chip"
                onClick={copy}
                aria-label={`Room code ${state.game.code}. Copy invite link`}
              >
                {state.game.code}
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            )}
            <span className={"live" + (connected ? "" : " off")} role="status">
              <i />
              <span>{connected ? "Live" : "Reconnecting…"}</span>
            </span>
            {phase === "writing" && round && timer("timer-bar")}
            <button
              className="icon-btn"
              aria-label="How to play"
              onClick={() => setPanel("rules")}
            >
              <HelpCircle size={22} />
            </button>
            <button
              className="icon-btn"
              aria-label="Menu"
              onClick={() => setPanel("menu")}
            >
              <Menu size={22} />
            </button>
          </div>
        </header>
      )}
      {error && (
        <div role="alert" className="toast">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={18} />
          </button>
        </div>
      )}
      {!state ? (
        <main className="landing">
          <div className="logo">
            <span className="brand-mark brand-mark-lg">
              <Fingerprint size={38} />
            </span>
            <h1 className="logo-word">
              imposter<i>/llm</i>
            </h1>
            <p className="tagline">
              Same prompt. Secret context. Spot the imposter.
            </p>
          </div>
          <form
            className="entry-card"
            aria-label={mode === "join" ? "Join a game" : "Host a game"}
            onSubmit={(e) => {
              e.preventDefault();
              act(mode === "join" ? "join" : "create", {
                nickname: nick,
                code,
                teams,
              });
            }}
          >
            {mode === "join" && (
              <label>
                <span className="sr-only">Room code</span>
                <input
                  className="field code-input"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  placeholder="Room code"
                  value={code}
                  minLength={6}
                  maxLength={6}
                  pattern="[A-Za-z0-9]{6}"
                  required
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
              </label>
            )}
            <label>
              <span className="sr-only">Your name</span>
              <input
                className="field"
                autoComplete="nickname"
                autoCapitalize="words"
                placeholder="Your name"
                value={nick}
                maxLength={24}
                required
                onChange={(e) => setNick(e.target.value)}
              />
            </label>
            {mode === "create" && (
              <fieldset className="teams-field">
                <legend>How many teams?</legend>
                <div className="segmented seg-dark" role="radiogroup">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={teams === n}
                      className={teams === n ? "on" : ""}
                      onClick={() => setTeams(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p>
                  {teams === 3
                    ? "Small group"
                    : teams === 4
                      ? "Club favorite"
                      : "Full house"}
                </p>
              </fieldset>
            )}
            <button className="btn btn-dark btn-xl btn-block" disabled={busy}>
              {busy
                ? "Connecting…"
                : mode === "join"
                  ? "Join game"
                  : "Create room"}
            </button>
          </form>
          <div className="landing-links">
            <button
              className="link"
              onClick={() => setMode(mode === "join" ? "create" : "join")}
            >
              {mode === "join" ? "Host a game" : "Join a game instead"}
            </button>
            <button className="link" onClick={() => setPanel("rules")}>
              How to play
            </button>
          </div>
          <p className="club">Gen AI at Indiana University</p>
        </main>
      ) : (
        <main className="screen" key={phase}>
          {phase === "lobby" && (
            <>
              {host ? (
                <section className="join-card" aria-label="Room code">
                  <p>
                    Join at <b>{location.host}</b> with the code
                  </p>
                  <button
                    className="join-code"
                    onClick={copy}
                    aria-label={`Room code ${state.game.code}. Copy invite link`}
                  >
                    {state.game.code}
                  </button>
                  <small>
                    {copied
                      ? "Invite link copied"
                      : "Tap the code to copy the invite link"}
                  </small>
                </section>
              ) : (
                <section className="lobby-head">
                  <h1>
                    {myTeam
                      ? `You’re in, ${state.me.nickname}!`
                      : "Pick your team"}
                  </h1>
                  <p>
                    {myTeam
                      ? "Waiting for the host to start the game."
                      : "The first player on a team names it and becomes captain."}
                  </p>
                </section>
              )}
              <p className="count-pill">
                {playerCount} {playerCount === 1 ? "player" : "players"} ·{" "}
                {activeTeams.length}{" "}
                {activeTeams.length === 1 ? "team" : "teams"}
              </p>
              <div className={"team-grid n-" + orderedTeams.length}>
                {orderedTeams.map((t, i) => {
                  const members = state.players.filter(
                      (p) => p.team_id === t.id,
                    ),
                    mine = myTeam?.id === t.id,
                    canName =
                      !t.name_locked &&
                      (members.length === 0 || (mine && captain)),
                    chosenName = teamNames[t.id] || "";
                  return (
                    <article
                      className={
                        "tile team tone-" + (i % TONES) + (mine ? " mine" : "")
                      }
                      key={t.id}
                    >
                      <h2>{t.name_locked ? t.name : `Team ${t.position}`}</h2>
                      {canName && (
                        <label>
                          <span className="sr-only">Team name</span>
                          <input
                            className="field field-sm"
                            autoCapitalize="words"
                            maxLength={24}
                            placeholder="Name your team"
                            value={chosenName}
                            onChange={(e) =>
                              setTeamNames((names) => ({
                                ...names,
                                [t.id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                      )}
                      {!t.name_locked && members.length > 0 && !canName && (
                        <p className="tile-note">
                          The captain is choosing a name…
                        </p>
                      )}
                      <div className="members">
                        {members.map((p) => (
                          <span className="pill" key={p.id}>
                            <i
                              className={online.includes(p.id) ? "here" : ""}
                            />
                            {p.nickname}
                            {p.id === t.captain_id && (
                              <>
                                <Crown size={14} aria-hidden="true" />
                                <span className="sr-only">captain</span>
                              </>
                            )}
                          </span>
                        ))}
                        {!members.length && !canName && (
                          <span className="tile-note">Open seat</span>
                        )}
                      </div>
                      <button
                        disabled={
                          busy ||
                          (mine && t.name_locked) ||
                          (!mine && members.length >= 4) ||
                          (!t.name_locked && (!canName || !chosenName.trim()))
                        }
                        className={
                          "btn btn-block tile-action " +
                          (host && !mine ? "btn-ghost" : "btn-light") +
                          (mine && t.name_locked ? " is-mine" : "")
                        }
                        onClick={() =>
                          act("team", {
                            team_id: t.id,
                            ...(!t.name_locked
                              ? { team_name: chosenName }
                              : {}),
                          })
                        }
                      >
                        {mine && t.name_locked ? (
                          <>
                            <Check size={18} /> Your team
                          </>
                        ) : mine ? (
                          "Save team name"
                        ) : !mine && members.length >= 4 ? (
                          "Team full"
                        ) : !t.name_locked ? (
                          "Name and join"
                        ) : (
                          "Join team"
                        )}
                      </button>
                    </article>
                  );
                })}
              </div>
              {!!joinable?.length && (
                <p className="lobby-note">
                  Choosing a team: {joinable.map((p) => p.nickname).join(", ")}
                </p>
              )}
              {host && myTeam && (
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => act("team", { team_id: null })}
                >
                  Host without a team
                </button>
              )}
            </>
          )}
          {phase !== "lobby" && !round && (
            <p className="lobby-note">Loading the round…</p>
          )}
          {round && phase === "writing" && (
            <>
              <section className="prompt-row">
                <h1 className="prompt">{round.prompt}</h1>
                {timer("timer-stage")}
              </section>
              {myTeam ? (
                <>
                  <div className="write-grid">
                    <button
                      className={"secret" + (secret ? " open" : "")}
                      aria-expanded={secret}
                      onClick={() => setSecret(!secret)}
                    >
                      <span className="secret-label">
                        <LockKeyhole size={18} /> Only your team sees this
                      </span>
                      {secret ? (
                        <>
                          <strong className="secret-text">
                            {round.context}
                          </strong>
                          <span className="secret-hint">
                            Use this context without naming it directly.
                          </span>
                        </>
                      ) : (
                        <span className="secret-cover">
                          <Eye size={24} /> Tap to reveal your context
                        </span>
                      )}
                    </button>
                    <div className="editor">
                      <label className="sr-only" htmlFor="answer">
                        Your answer
                      </label>
                      <textarea
                        id="answer"
                        placeholder={
                          captain
                            ? "One or two sentences. An entirely convincing story…"
                            : "Your captain types the team’s answer."
                        }
                        maxLength={320}
                        value={captain ? draft : round.my_answer || ""}
                        disabled={!captain || remaining === 0}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          localStorage.setItem(
                            "draft-" + round.id,
                            e.target.value,
                          );
                        }}
                      />
                      <div className="editor-meta">
                        <span>
                          {captain
                            ? draft.length
                            : (round.my_answer || "").length}
                          /320 · max two sentences
                        </span>
                        {round.my_answer && (
                          <span className="saved">
                            <Check size={14} /> Saved
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="dock">
                    {captain ? (
                      <button
                        className="btn btn-light btn-xl btn-block"
                        disabled={busy || !draft.trim() || remaining === 0}
                        onClick={() => act("answer", { body: draft })}
                      >
                        {round.my_answer ? "Update answer" : "Submit answer"}
                        <ArrowRight size={22} />
                      </button>
                    ) : (
                      <p className="dock-note">
                        Your captain submits for the team. Talk it through
                        together.
                      </p>
                    )}
                    <p className="dock-note">
                      {remaining
                        ? "You can revise until the timer ends."
                        : "Time is up. Waiting for the host to open voting."}
                    </p>
                  </div>
                </>
              ) : host ? (
                <section className="tracker" aria-label="Submissions">
                  <div className="dots">
                    {activeTeams.map((t, i) => (
                      <i
                        key={t.id}
                        className={i < round.submitted ? "on" : ""}
                      />
                    ))}
                  </div>
                  <p>
                    {allSubmitted
                      ? "Every team is in!"
                      : `${round.submitted} of ${activeTeams.length} teams have answered`}
                  </p>
                </section>
              ) : (
                <p className="lobby-note">
                  The teams are writing. Answers appear when voting opens.
                </p>
              )}
            </>
          )}
          {round && phase === "voting" && (
            <>
              <section className="vote-head">
                <h1>Spot the imposter</h1>
                <p className="recap">{round.prompt}</p>
                <p className="vote-hint">
                  {captain
                    ? "Tap the answer written from a different context."
                    : myTeam
                      ? "Your captain votes for the team."
                      : "Teams are voting."}
                </p>
              </section>
              <div className={"answers n-" + round.answers.length}>
                {round.answers.map(answerTile)}
              </div>
            </>
          )}
          {round && phase === "reveal" && (
            <>
              <section className="vote-head">
                <h1>The imposter was {culpritName}</h1>
                {v && <p className={"verdict verdict-" + v.kind}>{v.text}</p>}
              </section>
              <div className="contexts">
                <div className="ctx">
                  <span>Everyone else got</span>
                  <strong>{round.normal_context}</strong>
                </div>
                <div className="ctx ctx-imposter">
                  <span>
                    <Fingerprint size={16} /> The imposter got
                  </span>
                  <strong>{round.imposter_context}</strong>
                </div>
              </div>
              <div className={"answers n-" + round.answers.length}>
                {round.answers.map(answerTile)}
              </div>
            </>
          )}
          {round && phase === "scoreboard" && (
            <section className="board">
              {gameComplete && <Trophy className="board-trophy" size={56} />}
              <h1>
                {gameComplete
                  ? winners.length === 1
                    ? `${winners[0].name} wins!`
                    : `${winners.map((t) => t.name).join(" & ")} tie!`
                  : "Scoreboard"}
              </h1>
              {gameComplete && (
                <div className="podium">
                  {[ranked[1], ranked[0], ranked[2]]
                    .filter(Boolean)
                    .map((t) => (
                      <div
                        key={t.id}
                        className={
                          "step tone-" +
                          toneOf(t.id) +
                          " rank-" +
                          Math.min(rankOf(t), 3)
                        }
                      >
                        <span className="step-name">{t.name}</span>
                        <b className="step-score">{t.score}</b>
                        <span className="step-block">{rankOf(t)}</span>
                      </div>
                    ))}
                </div>
              )}
              <ol className="ranks">
                {(gameComplete ? ranked.slice(3) : ranked).map((t) => (
                  <li
                    key={t.id}
                    className={
                      "rank tone-" +
                      toneOf(t.id) +
                      (t.score === topScore && topScore > 0 ? " lead" : "")
                    }
                    style={
                      {
                        "--fill": topScore
                          ? (t.score / topScore) * 100 + "%"
                          : "0%",
                      } as CSSProperties
                    }
                  >
                    <span className="rank-n">{rankOf(t)}</span>
                    <strong className="rank-name">{t.name}</strong>
                    {t.score === topScore && topScore > 0 && (
                      <Trophy size={20} aria-label="Leading" />
                    )}
                    <b className="rank-score">{t.score}</b>
                  </li>
                ))}
              </ol>
              {!host && !gameComplete && (
                <p className="lobby-note">
                  Waiting for the host to start round{" "}
                  {state.game.round_number + 1}.
                </p>
              )}
            </section>
          )}
        </main>
      )}
      {host && state && (
        <footer className="hostbar">
          <div className="hostbar-in">
            <p className="hostbar-info" role="status">
              {info}
            </p>
            <div className="hostbar-actions">{actions}</div>
          </div>
        </footer>
      )}

      {panel === "rules" && (
        <div className="backdrop" onClick={() => setPanel(null)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="sheet-close"
              aria-label="Close rules"
              onClick={() => setPanel(null)}
              autoFocus
            >
              <X size={22} />
            </button>
            <h2 id="rules-title">How to play</h2>
            <ol className="steps">
              <li>
                Join a team. Its first player chooses the name and becomes
                captain.
              </li>
              <li>
                Read the shared prompt and your private context. One team
                secretly gets a different context.
              </li>
              <li>
                Write 1–2 sentences in 60–90 seconds. Your captain submits and
                can revise until time runs out.
              </li>
              <li>
                Vote as a team for the imposter. You can change your vote until
                the host reveals.
              </li>
              <li>
                Play 10 random prompts. The team with the highest final score
                wins.
              </li>
            </ol>
            <div className="points">
              <p>
                <b>+1</b> Correctly identify the imposter
              </p>
              <p>
                <b>+2</b> Imposter avoids the most votes
              </p>
              <p>
                <b>+1</b> Imposter leaves one other team with the most votes
              </p>
            </div>
            <p className="fine">
              A tie involving the imposter counts as detection. No votes means
              no escape points. An imposter must submit an answer to earn escape
              points.
            </p>
            <button
              className="btn btn-dark btn-lg btn-block"
              onClick={() => setPanel(null)}
            >
              I’m in <ArrowRight size={20} />
            </button>
          </section>
        </div>
      )}
      {panel === "menu" && (
        <div className="backdrop" onClick={() => setPanel(null)}>
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="sheet-close"
              aria-label="Close menu"
              onClick={() => setPanel(null)}
            >
              <X size={22} />
            </button>
            <h2 id="menu-title">Menu</h2>
            <div className="menu-list">
              <button className="menu-item" onClick={() => setPanel("rules")}>
                <HelpCircle size={20} /> How to play
              </button>
              <button className="menu-item" onClick={copy}>
                {copied ? <Check size={20} /> : <Copy size={20} />}
                {copied ? "Invite link copied" : "Copy invite link"}
              </button>
              {host && (
                <button className="menu-item" onClick={() => setPanel("reset")}>
                  <RotateCcw size={20} /> Reset game
                </button>
              )}
              <button
                className="menu-item"
                onClick={() => {
                  setPanel(null);
                  leave();
                }}
              >
                <X size={20} /> Leave room
              </button>
            </div>
            <p className="fine">
              Room lasts 24 hours. Rejoin on this device to keep your seat.
            </p>
          </section>
        </div>
      )}
      {panel === "reset" && (
        <div className="backdrop">
          <section
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <h2 id="reset-title">Start fresh?</h2>
            <p className="sheet-copy">
              This clears all rounds, answers, votes, and scores in this room.
              Players and teams stay. Test players are removed.
            </p>
            <div className="sheet-actions">
              <button
                className="btn btn-outline btn-lg"
                autoFocus
                onClick={() => setPanel(null)}
              >
                Keep playing
              </button>
              <button
                className="btn btn-dark btn-lg"
                disabled={busy}
                onClick={() => act("reset")}
              >
                Reset this game
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
