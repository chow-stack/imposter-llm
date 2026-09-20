import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Fingerprint,
  HelpCircle,
  LockKeyhole,
  RotateCcw,
  Smile,
  Timer,
  Trophy,
  Users,
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
  funny_votes?: number;
};
type State = {
  game: {
    id: string;
    code: string;
    host_id: string;
    phase: string;
    round_number: number;
    revision: number;
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
    funny_votes_cast: number;
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
    [rules, setRules] = useState(false),
    [secret, setSecret] = useState(false),
    [draft, setDraft] = useState(""),
    [now, setNow] = useState(Date.now()),
    [offset, setOffset] = useState(0),
    [bank, setBank] = useState(1),
    [seconds, setSeconds] = useState(75),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState<string[]>([]),
    [copied, setCopied] = useState(false),
    [reset, setReset] = useState(false),
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
          : await supabase.rpc("game_action", { action, payload: request });
      if (error) throw error;
      accept(data);
      if (action === "create" || action === "join")
        localStorage.setItem("imposter-nickname", nick);
      if (action === "reset") setReset(false);
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
    if (!rules && !reset) return;
    const previous = document.activeElement as HTMLElement | null;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRules(false);
        setReset(false);
      }
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
  }, [rules, reset]);
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
      ) || [];
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
  const startControls = (
    <div className="start-controls">
      <label>
        Round
        <select value={bank} onChange={(e) => setBank(+e.target.value)}>
          {state?.bank.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
              {b.played ? " · played" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Writing time
        <select value={seconds} onChange={(e) => setSeconds(+e.target.value)}>
          {[60, 75, 90].map((s) => (
            <option key={s} value={s}>
              {s} seconds
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || activeTeams.length < 3}
        className="primary"
        onClick={() => act("start", { bank_id: bank, seconds })}
      >
        Start round <ArrowRight size={18} />
      </button>
    </div>
  );
  return (
    <>
      <header className={state ? "" : "landing-header"}>
        <div className="nav">
          <a className="brand" href="/" aria-label="Imposter LLM home">
            <span className="brand-mark">
              <Fingerprint size={25} />
            </span>
            <span>
              imposter<span className="brand-llm"> / llm</span>
            </span>
          </a>
          <span className="club-label">
            GEN AI <span>AT INDIANA UNIVERSITY</span>
          </span>
          {state && (
            <button className="text-button" onClick={() => setRules(true)}>
              <HelpCircle size={17} /> How to play
            </button>
          )}
        </div>
      </header>
      <main>
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {!state ? (
          <div className="landing">
            <section className="entry-card" aria-label="Join or host a game">
              <div className="tabs">
                <button
                  className={mode === "join" ? "active" : ""}
                  aria-pressed={mode === "join"}
                  onClick={() => setMode("join")}
                >
                  Join a room
                </button>
                <button
                  className={mode === "create" ? "active" : ""}
                  aria-pressed={mode === "create"}
                  onClick={() => setMode("create")}
                >
                  Host a game
                </button>
              </div>
              <div className="entry-body">
                <h1>{mode === "join" ? "Join a room" : "Host a game"}</h1>
                <p>
                  {mode === "join"
                    ? "Enter your name and the code from your host."
                    : "Create a room and invite your teams."}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(mode === "join" ? "join" : "create", {
                      nickname: nick,
                      code,
                      teams,
                    });
                  }}
                >
                  <label>
                    Your name
                    <input
                      autoComplete="nickname"
                      autoCapitalize="words"
                      placeholder="Your name"
                      value={nick}
                      maxLength={24}
                      required
                      onChange={(e) => setNick(e.target.value)}
                    />
                  </label>
                  {mode === "join" ? (
                    <label>
                      Room code
                      <input
                        className="code-input"
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="ABC123"
                        value={code}
                        minLength={6}
                        maxLength={6}
                        pattern="[A-Za-z0-9]{6}"
                        required
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                      />
                    </label>
                  ) : (
                    <label>
                      Number of teams
                      <select
                        value={teams}
                        onChange={(e) => setTeams(+e.target.value)}
                      >
                        <option value="3">3 teams · small group</option>
                        <option value="4">4 teams · club favorite</option>
                        <option value="5">5 teams · full house</option>
                      </select>
                    </label>
                  )}
                  <button className="primary wide" disabled={busy}>
                    {busy
                      ? "Connecting…"
                      : mode === "join"
                        ? "Join the game"
                        : "Create a room"}
                    <ArrowRight size={18} />
                  </button>
                </form>
              </div>
            </section>
          </div>
        ) : (
          <div className="game-page">
            <div className="room-top">
              <div>
                <div className="eyebrow">
                  {host ? "HOST DESK" : myTeam?.name || "WELCOME TO THE ROOM"}
                </div>
                <h1>
                  {phase === "lobby"
                    ? "Assemble your suspects."
                    : phase === "writing"
                      ? "Make it believable."
                      : phase === "voting"
                        ? "Who’s hiding something?"
                        : phase === "reveal"
                          ? "The context is out."
                          : "A little friendly competition."}
                </h1>
              </div>
              <button className="room-code" onClick={copy}>
                <span>ROOM CODE</span>
                <strong>{state.game.code}</strong>
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <div className="phase-bar">
              {["lobby", "writing", "voting", "reveal", "scoreboard"].map(
                (p, i) => (
                  <span key={p} className={p === phase ? "current" : ""}>
                    <b>{i + 1}</b>
                    {p}
                    <ChevronRight size={14} />
                  </span>
                ),
              )}
              <small
                className={connected ? "connection" : "connection offline"}
              >
                <span className="live-dot" />
                {connected ? "Live" : "Reconnecting…"}
              </small>
            </div>
            {phase === "lobby" ? (
              <>
                <div className="section-title">
                  <div>
                    <h2>Find your people.</h2>
                    <p>
                      Up to four players per team. The first to join becomes
                      captain.
                    </p>
                  </div>
                  <span className="badge">
                    {state.players.length} players · {activeTeams.length} teams
                    ready
                  </span>
                </div>
                <div className="team-grid">
                  {[...state.teams]
                    .sort((a, b) => a.position - b.position)
                    .map((t, i) => {
                      const members = state.players.filter(
                          (p) => p.team_id === t.id,
                        ),
                        canName =
                          !t.name_locked &&
                          (members.length === 0 ||
                            (myTeam?.id === t.id && captain)),
                        chosenName = teamNames[t.id] || "";
                      return (
                        <article
                          className={
                            "team-card " +
                            (myTeam?.id === t.id ? "selected" : "")
                          }
                          key={t.id}
                        >
                          <span className={"team-symbol tone-" + i}>
                            <Users size={24} />
                          </span>
                          <h3>
                            {t.name_locked ? t.name : `Team ${t.position}`}
                          </h3>
                          {canName && (
                            <label>
                              Team name
                              <input
                                autoCapitalize="words"
                                maxLength={24}
                                placeholder="The Context Bandits"
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
                            <p className="muted">
                              The captain is choosing this team’s name.
                            </p>
                          )}
                          <div className="member-list">
                            {members.map((p) => (
                              <div key={p.id}>
                                <span
                                  className={
                                    "presence " +
                                    (online.includes(p.id) ? "here" : "")
                                  }
                                />
                                {p.nickname}
                                {p.id === t.captain_id && (
                                  <span className="small">captain</span>
                                )}
                              </div>
                            ))}
                            {!members.length && (
                              <p className="muted">A fresh set of suspects.</p>
                            )}
                          </div>
                          <button
                            disabled={
                              busy ||
                              (myTeam?.id === t.id && t.name_locked) ||
                              members.length >= 4 ||
                              (!t.name_locked &&
                                (!canName || !chosenName.trim()))
                            }
                            className={
                              myTeam?.id === t.id
                                ? "outline selected-button"
                                : "outline"
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
                            {myTeam?.id === t.id && t.name_locked ? (
                              <>
                                <Check size={16} /> Your team
                              </>
                            ) : myTeam?.id === t.id ? (
                              "Save team name"
                            ) : !t.name_locked ? (
                              "Name and join team"
                            ) : (
                              "Join team"
                            )}
                          </button>
                        </article>
                      );
                    })}
                </div>
                {state.players.some((p) => !p.team_id) && (
                  <p className="small">
                    In the room:{" "}
                    {state.players
                      .filter((p) => !p.team_id)
                      .map(
                        (p) =>
                          p.nickname +
                          (p.id === state.game.host_id
                            ? " (host)"
                            : " (choosing a team)"),
                      )
                      .join(", ")}
                  </p>
                )}
                <div className="host-panel">
                  <div>
                    <h3>
                      {host
                        ? "You set the scene."
                        : "Make yourselves comfortable."}
                    </h3>
                    <p>
                      {host
                        ? "Stay off a team to host on a shared screen. At least three teams must join."
                        : "Your host will start the round when everyone is ready."}
                    </p>
                  </div>
                  {host && myTeam && (
                    <button
                      className="outline"
                      disabled={busy}
                      onClick={() => act("team", { team_id: null })}
                    >
                      Host without a team
                    </button>
                  )}
                  {host && startControls}
                </div>
              </>
            ) : (
              <>
                {round && (
                  <>
                    <div className="prompt-panel">
                      <div>
                        <span className="eyebrow">
                          ROUND {state.game.round_number} · {round.title}
                        </span>
                        <h2>{round.prompt}</h2>
                      </div>
                      {phase === "writing" && (
                        <div
                          className={
                            "timer " + (remaining <= 10 ? "urgent" : "")
                          }
                        >
                          <Timer size={20} />
                          <strong>
                            {Math.floor(remaining / 60)}:
                            {String(remaining % 60).padStart(2, "0")}
                          </strong>
                          <small>
                            {remaining ? "time to write" : "pens down"}
                          </small>
                        </div>
                      )}
                    </div>
                    {phase === "writing" && (
                      <>
                        <div className="writing-grid">
                          <section className="private-card">
                            <LockKeyhole size={24} />
                            <span className="eyebrow">
                              FOR YOUR TEAM’S EYES ONLY
                            </span>
                            <h2>
                              {myTeam
                                ? "A little inside information."
                                : "You’re running the show."}
                            </h2>
                            {myTeam ? (
                              <>
                                <button
                                  className="outline"
                                  onClick={() => setSecret(!secret)}
                                >
                                  {secret ? (
                                    <EyeOff size={16} />
                                  ) : (
                                    <Eye size={16} />
                                  )}{" "}
                                  {secret ? "Hide context" : "Show my context"}
                                </button>
                                {secret && (
                                  <p className="secret-text">{round.context}</p>
                                )}
                                <p>
                                  Follow your context without naming it
                                  directly. Make the answer fit. Make it fun.
                                </p>
                              </>
                            ) : (
                              <p>
                                Keep this screen visible. Team contexts stay on
                                their own devices.
                              </p>
                            )}
                          </section>
                          <section className="answer-editor">
                            <div className="section-title">
                              <h3>Your team’s answer</h3>
                              <span className="badge">
                                {round.submitted}/{activeTeams.length} submitted
                              </span>
                            </div>
                            {myTeam ? (
                              <>
                                <label className="sr-only" htmlFor="answer">
                                  Your answer
                                </label>
                                <textarea
                                  id="answer"
                                  placeholder="One or two sentences. An entirely convincing story…"
                                  maxLength={320}
                                  value={
                                    captain ? draft : round.my_answer || ""
                                  }
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
                                    /320 · maximum two sentences
                                  </span>
                                  {round.my_answer && (
                                    <span>
                                      <Check size={14} /> Answer saved
                                    </span>
                                  )}
                                </div>
                                {captain ? (
                                  <button
                                    className="primary"
                                    disabled={
                                      busy || !draft.trim() || remaining === 0
                                    }
                                    onClick={() =>
                                      act("answer", { body: draft })
                                    }
                                  >
                                    {round.my_answer
                                      ? "Update answer"
                                      : "Submit answer"}
                                    <ArrowRight size={17} />
                                  </button>
                                ) : (
                                  <p>
                                    Your captain submits for the team. Talk
                                    through your answer together.
                                  </p>
                                )}
                                <p className="small">
                                  {remaining
                                    ? "You can revise your submission until the timer ends."
                                    : "Time is up. Waiting for the host to open voting."}
                                </p>
                              </>
                            ) : (
                              <p className="spectator-note">
                                The teams are writing. Answers will appear here
                                when you open voting.
                              </p>
                            )}
                          </section>
                        </div>
                        {host && (
                          <div className="host-panel">
                            <p>
                              {remaining
                                ? "Let the ideas cook. Voting opens after the timer."
                                : "Writing is closed. Missing answers will be marked as not submitted."}
                            </p>
                            <button
                              className="primary"
                              disabled={busy || remaining > 0}
                              onClick={() => act("voting")}
                            >
                              Open voting <ArrowRight size={17} />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {(phase === "voting" || phase === "reveal") && (
                      <>
                        <div className="section-title">
                          <div>
                            <h2>
                              {phase === "voting"
                                ? "A lineup of very convincing answers."
                                : "Meet the minds behind the answers."}
                            </h2>
                            <p>
                              {phase === "voting"
                                ? "One team vote for the imposter. One for the funniest. No voting for yourselves."
                                : "The same prompt. Two different realities."}
                            </p>
                          </div>
                          <span className="badge">
                            {round.votes_cast}/{activeTeams.length} detective
                            votes · {round.funny_votes_cast}/
                            {activeTeams.length} funny votes
                          </span>
                        </div>
                        <div className="answers-grid">
                          {round.answers.map((a, i) => (
                            <article
                              className={
                                "answer-card " +
                                (a.is_imposter ? "imposter-card" : "")
                              }
                              key={a.id}
                            >
                              <div className="answer-header">
                                <span className="answer-letter">
                                  {String.fromCharCode(65 + i)}
                                </span>
                                <span>
                                  {phase === "reveal"
                                    ? state.teams.find(
                                        (t) => t.id === a.team_id,
                                      )?.name
                                    : a.is_mine
                                      ? "Your team"
                                      : "Anonymous answer"}
                                </span>
                                {a.is_imposter && (
                                  <span className="badge crimson">
                                    IMPOSTER
                                  </span>
                                )}
                              </div>
                              <p className="answer-body">
                                {a.body || "No answer submitted."}
                              </p>
                              {phase === "voting" ? (
                                <div className="vote-buttons">
                                  <button
                                    className={
                                      round.my_votes.imposter === a.id
                                        ? "vote chosen"
                                        : "vote"
                                    }
                                    disabled={
                                      busy || !captain || a.is_mine || !a.body
                                    }
                                    onClick={() =>
                                      act("vote", {
                                        answer_id: a.id,
                                        kind: "imposter",
                                      })
                                    }
                                  >
                                    <Fingerprint size={17} />
                                    {round.my_votes.imposter === a.id
                                      ? "Suspect selected"
                                      : "The imposter"}
                                  </button>
                                  <button
                                    className={
                                      round.my_votes.funniest === a.id
                                        ? "vote chosen"
                                        : "vote"
                                    }
                                    disabled={
                                      busy || !captain || a.is_mine || !a.body
                                    }
                                    onClick={() =>
                                      act("vote", {
                                        answer_id: a.id,
                                        kind: "funniest",
                                      })
                                    }
                                  >
                                    <Smile size={17} />
                                    {round.my_votes.funniest === a.id
                                      ? "Funny vote saved"
                                      : "Funniest"}
                                  </button>
                                </div>
                              ) : (
                                <div className="answer-results">
                                  <span>
                                    <Fingerprint size={16} />
                                    {a.votes} suspect votes
                                  </span>
                                  <span>
                                    <Smile size={16} />
                                    {a.funny_votes} funny votes
                                  </span>
                                </div>
                              )}
                            </article>
                          ))}
                        </div>
                        {phase === "reveal" && (
                          <div className="context-reveal">
                            <div>
                              <span className="eyebrow">
                                THE NORMAL CONTEXT
                              </span>
                              <h3>{round.normal_context}</h3>
                            </div>
                            <div>
                              <span className="eyebrow">
                                THE IMPOSTER CONTEXT
                              </span>
                              <h3>{round.imposter_context}</h3>
                            </div>
                          </div>
                        )}
                        {host && (
                          <div className="host-panel">
                            <p>
                              {phase === "voting"
                                ? "Wait for both votes from every team, or reveal with the votes already cast."
                                : "Scores are in. Give the teams a moment to enjoy the reveal."}
                            </p>
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  phase === "voting" ? "reveal" : "scoreboard",
                                )
                              }
                            >
                              {phase === "voting"
                                ? "Reveal the imposter"
                                : "See the scoreboard"}
                              <ArrowRight size={17} />
                            </button>
                          </div>
                        )}
                      </>
                    )}
                    {phase === "scoreboard" && (
                      <>
                        <div className="scoreboard">
                          <Trophy size={36} />
                          <span className="eyebrow">
                            THE STANDINGS · ROUND {state.game.round_number}
                          </span>
                          <h2>Award-winning suspicion.</h2>
                          {[...state.teams]
                            .sort(
                              (a, b) =>
                                b.score - a.score ||
                                a.name.localeCompare(b.name),
                            )
                            .map((t, i, arr) => (
                              <div className="score-row" key={t.id}>
                                <span>
                                  {arr.findIndex((x) => x.score === t.score) +
                                    1}
                                </span>
                                <strong>{t.name}</strong>
                                <b>
                                  {t.score}
                                  <small>pts</small>
                                </b>
                                {i === 0 && <Trophy size={20} />}
                              </div>
                            ))}
                        </div>
                        <div className="reflection">
                          <h3>Same prompt. Different context.</h3>
                          <p>
                            Which hidden context changed the answer most? Could
                            confidence tell you who had different information?
                          </p>
                        </div>
                        {host && (
                          <div className="host-panel">
                            <div>
                              <h3>Another round?</h3>
                              <p>
                                Try AI dating profile, movie review, then campus
                                survival advice.
                              </p>
                            </div>
                            {startControls}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
            <div className="room-footer">
              <button className="text-button" onClick={leave}>
                Back to home
              </button>
              <span className="small">
                Room lasts 24 hours · Rejoin on this device to keep your seat
              </span>
              {host && (
                <button className="text-button" onClick={() => setReset(true)}>
                  <RotateCcw size={14} /> Reset game
                </button>
              )}
            </div>
          </div>
        )}
      </main>

      {rules && (
        <div className="modal-backdrop" onClick={() => setRules(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label="Close rules"
              onClick={() => setRules(false)}
              autoFocus
            >
              <X />
            </button>
            <span className="eyebrow">IMPOSTER LLM / FIELD GUIDE</span>
            <h2 id="rules-title">Keep your context close.</h2>
            <ol>
              <li>Join a team. Your first player is your captain.</li>
              <li>
                Read the shared prompt and your private context. One team
                secretly gets a different context.
              </li>
              <li>
                Write 1–2 sentences in 60–90 seconds. Your captain submits and
                can revise until time runs out.
              </li>
              <li>
                Vote as a team for the imposter and the funniest answer. You can
                change votes until the host reveals.
              </li>
            </ol>
            <div className="rules-scores">
              <p>
                <b>+1</b> Correctly identify the imposter
              </p>
              <p>
                <b>+2</b> Imposter avoids the most votes
              </p>
              <p>
                <b>+1</b> Imposter leaves one other team with the most votes
              </p>
              <p>
                <b>+1</b> Audience-voted funniest answer
              </p>
            </div>
            <p className="small">
              A tie involving the imposter counts as detection. A tied funniest
              vote awards one point to each winner. No deduction votes means no
              escape points. An imposter must submit an answer to earn escape
              points.
            </p>
            <button className="primary wide" onClick={() => setRules(false)}>
              I’m in <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}
      {reset && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <h2 id="reset-title">Start fresh?</h2>
            <p>
              This clears all rounds, answers, votes, and scores in this room.
              Players and teams stay.
            </p>
            <div className="vote-buttons">
              <button
                className="outline"
                autoFocus
                onClick={() => setReset(false)}
              >
                Keep playing
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => act("reset")}
              >
                Reset this game
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
