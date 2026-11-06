"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Audition } from "./audition";

type Row = { id: string; [key: string]: any };
const sections = [
  "Overview",
  "Voice studio",
  "Quality lab",
  "Agent knowledge",
  "Permissions",
  "Calls",
  "MCP connection",
];
const icons = ["◈", "◉", "≋", "▤", "◇", "↗", "⌘"];
const money = (n: number) => `$${(n / 100).toFixed(2)}`;
const short = (id: string) => id?.slice(0, 8);

export default function Dashboard() {
  const [auth, setAuth] = useState<any>(null),
    [state, setState] = useState<any>(null);
  const [tab, setTab] = useState("Overview"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [oauth, setOauth] = useState<any>(null),
    [oauthId, setOauthId] = useState("");
  const csrf = useRef("");
  const request = useCallback(async (path: string, input?: any) => {
    const response = await fetch(
      `/api/${path}`,
      input === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-csrf-token": csrf.current,
            },
            body: JSON.stringify(input),
          },
    );
    const result = await response.json();
    if (response.status === 401) {
      csrf.current = "";
      setAuth({ signedIn: false });
      setState(null);
    }
    if (!response.ok)
      throw new Error(result.error?.message ?? "Request unavailable.");
    return result;
  }, []);
  const refresh = useCallback(async () => {
    setState(await request("state"));
  }, [request]);
  useEffect(() => {
    request("session")
      .then((s) => {
        csrf.current = s.csrf ?? "";
        setAuth(s);
      })
      .catch((e) => setError(e.message));
  }, [request]);
  useEffect(() => {
    if (!auth?.signedIn) return;
    refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [auth, refresh]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("oauth");
    if (id && auth?.signedIn) {
      setOauthId(id);
      request(`oauth/request?request=${encodeURIComponent(id)}`)
        .then(setOauth)
        .catch((e) => setError(e.message));
    }
  }, [auth, request]);
  const act = async (path: string, input: any, success?: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await request(path, input);
      if (path !== "logout") await refresh();
      if (success) setNotice(success);
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  if (!auth)
    return (
      <main className="login">
        <p role="status">Opening private workspace…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if (!auth.signedIn)
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand-mark">V</div>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>Vultrix Voice</h1>
          <p className="muted">
            Your voice. Your decisions.
            <br />
            An AI assistant, always identified as AI.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setError("");
              setBusy(true);
              try {
                const s = await request(auth.canSetup ? "setup" : "login", {
                  email: f.get("email"),
                  password: f.get("password"),
                });
                csrf.current = s.csrf;
                setAuth(s);
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>
              {auth.canSetup
                ? "Create your private owner account"
                : "Welcome back"}
            </h2>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={auth.canSetup ? 16 : 1}
                autoComplete={
                  auth.canSetup ? "new-password" : "current-password"
                }
                required
              />
            </label>
            {auth.canSetup && (
              <small>
                At least 16 characters. Stored locally as a salted password
                hash.
              </small>
            )}
            <button disabled={busy} className="primary">
              {auth.canSetup ? "Create account" : "Sign in"} <span>→</span>
            </button>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </form>
          <div className="pill amber">
            DRY RUN · External calling disabled · $0 cap
          </div>
        </div>
      </main>
    );
  if (!state)
    return (
      <main className="login">
        <p role="status">Loading your workspace…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const active = state.call.filter((c: Row) =>
    ["queued", "dialing", "connected", "unknown"].includes(c.state),
  );
  const workerAlive = state.worker && Date.now() - state.worker.at < 10_000;
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/" aria-label="Vultrix Voice home">
          <span className="brand-mark">V</span>
          <span>
            Vultrix <b>Voice</b>
            <small>PRIVATE CONTROL ROOM</small>
          </span>
        </a>
        <nav aria-label="Workspace">
          {sections.map((s, i) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={tab === s ? "selected" : ""}
              aria-current={tab === s ? "page" : undefined}
            >
              <span aria-hidden>{icons[i]}</span>
              {s}
              {s === "Calls" && active.length > 0 && <b className="dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pill amber">SIMULATION ONLY</div>
          <p>
            No external calls.
            <br />
            No provider spend.
          </p>
          <button
            onClick={async () => {
              const result = await act("logout", {});
              if (!result) return;
              csrf.current = "";
              setAuth({ signedIn: false });
              setState(null);
              setError("");
              setNotice("");
            }}
          >
            Sign out ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div>
            <span className={`status-dot ${workerAlive ? "" : "offline"}`} />
            {workerAlive
              ? "Worker online"
              : "Worker offline — run npm run worker"}
          </div>
          <div className="header-right">
            <span className="muted">Private owner workspace</span>
            <button
              className={state.budget[0].killSwitch ? "danger" : "stop"}
              onClick={() =>
                act(
                  "kill",
                  { enabled: !state.budget[0].killSwitch },
                  state.budget[0].killSwitch
                    ? "Kill switch cleared. Calls still require individual authorization."
                    : "Kill switch enabled. All simulations stopped.",
                )
              }
            >
              {state.budget[0].killSwitch ? "Resume workspace" : "Stop all"}
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-title">
            <div>
              <p className="eyebrow">VULTRIX VOICE / {tab.toUpperCase()}</p>
              <h1>
                {tab === "Overview" ? "Your voice, under your control." : tab}
              </h1>
              <p className="muted">
                {tab === "Overview"
                  ? "Build confidence in your voice before a single call leaves this room."
                  : "Private by default. Every action stays within your authorization."}
              </p>
            </div>
            <span className="pill amber">DRY RUN</span>
          </div>
          <div className="feedback">
            {error && (
              <div role="alert" className="banner error">
                {error}
                <button onClick={() => setError("")} aria-label="Dismiss error">
                  ×
                </button>
              </div>
            )}
            {notice && (
              <div role="status" className="banner success">
                {notice}
                <button
                  onClick={() => setNotice("")}
                  aria-label="Dismiss notice"
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {oauth && (
            <section className="card oauth">
              <h2>Authorize MCP connection?</h2>
              <p>
                <b>{oauth.clientName}</b> requests: {oauth.scopes.join(", ")}
              </p>
              <p className="mono">Redirect: {oauth.redirectUri}</p>
              <p>{oauth.warning}</p>
              <div className="actions">
                <button
                  className="primary"
                  onClick={async () => {
                    const r = await act("oauth/approve", {
                      request: oauthId,
                      approve: true,
                    });
                    if (r) location.assign(r.redirect);
                  }}
                >
                  Allow this client
                </button>
                <button
                  onClick={async () => {
                    const r = await act("oauth/approve", {
                      request: oauthId,
                      approve: false,
                    });
                    if (r) location.assign(r.redirect);
                  }}
                >
                  Deny
                </button>
              </div>
            </section>
          )}
          {tab === "Overview" && (
            <>
              <section className="hero card">
                <div>
                  <p className="eyebrow">A SAFE PLACE TO START</p>
                  <h2>First, get the whole flow right.</h2>
                  <p>
                    Set up a private voice profile, practice the quality review,
                    <br className="desktop" /> and authorize a simulated
                    conversation.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setTab("Voice studio")}
                  >
                    Open voice studio <span>↗</span>
                  </button>
                </div>
                <div className="wave" aria-hidden>
                  {Array.from({ length: 31 }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${14 + Math.abs(Math.sin(i * 2.3)) * (80 - Math.abs(i - 15) * 3)}%`,
                      }}
                    />
                  ))}
                </div>
                <div className="hero-foot">
                  MOCK MODE{" "}
                  <span>
                    No clone has been trained. No businesses are contacted.
                  </span>
                </div>
              </section>
              <div className="stats">
                <Stat
                  label="VOICE PROFILES"
                  value={state.voice.length}
                  detail="Private to this owner"
                />
                <Stat
                  label="REAL VOICES APPROVED"
                  value={0}
                  detail="Requires your quality acceptance"
                />
                <Stat
                  label="SIMULATED CALLS"
                  value={state.call.length}
                  detail="Never counted as real outreach"
                />
                <Stat
                  label="APPROVED SPEND"
                  value="$0.00"
                  detail="External calling locked"
                />
              </div>
              <div className="grid">
                <section className="card">
                  <h2>
                    Setup checklist <small>LOCAL VERTICAL SLICE</small>
                  </h2>
                  {[
                    [
                      "Private sign-in",
                      true,
                      "Owner authentication and scoped records",
                    ],
                    [
                      "Voice ownership consent",
                      state.voice.some(
                        (v: Row) => v.consentId && v.state !== "revoked",
                      ),
                      "Only your own voice; provider upload is separate",
                    ],
                    [
                      "Simulation configuration reviewed",
                      state.version.some((v: Row) => v.approved),
                      "Does not approve a real clone",
                    ],
                    [
                      "Recipient permission recorded",
                      state.permission.some((v: Row) => !v.revoked),
                      "Purpose-specific, revocable pilot allowlist",
                    ],
                    [
                      "MCP tools connected",
                      false,
                      "Inspector and actual ChatGPT/Codex are separate checks",
                    ],
                  ].map(([title, done, detail]) => (
                    <div className="check-row" key={String(title)}>
                      <span className={done ? "check done" : "check"}>
                        {done ? "✓" : "○"}
                      </span>
                      <div>
                        <b>{title}</b>
                        <p>{detail}</p>
                      </div>
                    </div>
                  ))}
                </section>
                <section className="card">
                  <p className="eyebrow">BEFORE GOING LIVE</p>
                  <h2>Real readiness, not a green animation.</h2>
                  <p className="muted">
                    Your voice must be verified, trained, tested in the actual
                    agent model and accepted by you.
                  </p>
                  <ul className="blockers">
                    {state.liveBlockers.slice(1, 5).map((s: string) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  <button onClick={() => setTab("MCP connection")}>
                    Review connection & activation →
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === "Voice studio" && (
            <Studio
              state={state}
              act={act}
              csrf={csrf.current}
              refresh={refresh}
              setError={setError}
              busy={busy}
            />
          )}
          {tab === "Quality lab" && (
            <Quality state={state} act={act} request={request} busy={busy} />
          )}
          {tab === "Agent knowledge" && <Knowledge state={state} act={act} />}
          {tab === "Permissions" && <Permissions state={state} act={act} />}
          {tab === "Calls" && <Calls state={state} act={act} busy={busy} />}
          {tab === "MCP connection" && (
            <section className="card">
              <p className="eyebrow">CHATGPT + CODEX</p>
              <h2>A real tool server. A separate voice session.</h2>
              <p>
                ChatGPT or Codex prepares and inspects the call through MCP. The
                ElevenAgents phone session handles live speech; the current chat
                does not become a phone call.
              </p>
              <div className="info">
                <b>Current MCP endpoint</b>
                <code>
                  {typeof location === "undefined" ? "" : location.origin}/mcp
                </code>
                <p>
                  Streamable HTTP · OAuth authorization code + S256 PKCE ·
                  scoped one-hour tokens · operator approval in this UI
                </p>
              </div>
              <p>
                Local endpoint is not reachable from ChatGPT's cloud. A private
                authenticated HTTPS deployment and a supported ChatGPT custom
                MCP app connection are required. Availability depends on your
                ChatGPT account/workspace.
              </p>
              <h3>Available tools</h3>
              <div className="tool-list">
                {[
                  "account_get_profile",
                  "voice_list_profiles",
                  "voice_preview",
                  "voice_get_preview",
                  "consent_get_status",
                  "call_prepare",
                  "call_get_draft",
                  "call_place_approved",
                  "call_status",
                  "call_summary",
                  "call_stop",
                  "usage_get_budget",
                ].map((t) => (
                  <code key={t}>{t}</code>
                ))}
              </div>
              <p className="muted">
                No tool can authorize a call, enroll a voice, raise spend or
                access vendor credentials.
              </p>
              <p>
                Local operator ID: <code>{auth.owner}</code>
              </p>
              <button
                onClick={() =>
                  act("oauth/revoke-all", {}, "All MCP access tokens revoked.")
                }
              >
                Disconnect all MCP clients
              </button>
              <h3>Live activation remains blocked</h3>
              <ul className="blockers">
                {state.liveBlockers.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              <a
                href="https://elevenlabs.io/pricing"
                target="_blank"
                rel="noreferrer"
              >
                Review current ElevenLabs plans ↗
              </a>
              <p className="muted">
                Professional cloning requires eligible paid access.
                Account-specific ElevenAgents, model and Twilio rates are not
                verified; no estimated live cost is invented. Current allowed
                cost is exactly $0.
              </p>
            </section>
          )}
          {tab === "MCP connection" && (
            <ProviderSettings state={state} act={act} />
          )}
        </main>
        <footer>
          VULTRIX VOICE{" "}
          <span>
            Owner-authorized. AI-disclosed. Never unattended outreach.
          </span>
          <span>v0.1 · Local dry-run milestone</span>
        </footer>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: any) {
  return (
    <div className="stat card">
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Audio({ src, label }: { src: string; label: string }) {
  return (
    <div className="audio">
      <small>{label}</small>
      <audio controls preload="none" src={src} />
    </div>
  );
}

function Studio({ state, act, csrf, refresh, setError, busy }: any) {
  const [voiceId, setVoiceId] = useState(state.voice[0]?.id ?? ""),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState(""),
    [recording, setRecording] = useState(false),
    [level, setLevel] = useState(0),
    [seconds, setSeconds] = useState(0),
    [blob, setBlob] = useState<Blob | null>(null),
    [url, setUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    frame = useRef(0);
  const v = state.voice.find((x: Row) => x.id === voiceId),
    assets = state.asset.filter(
      (a: Row) => a.voiceId === voiceId && a.role === "reference",
    );
  const cleanup = () => {
    cancelAnimationFrame(frame.current);
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    context.current?.close();
    setLevel(0);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (timer.current) clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
      context.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  const prepare = async () => {
    const s = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: device ? { exact: device } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    stream.current = s;
    setDevices(
      (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "audioinput",
      ),
    );
    return s;
  };
  const start = async () => {
    try {
      const s = await prepare();
      context.current = new AudioContext();
      const source = context.current.createMediaStreamSource(s),
        analyser = context.current.createAnalyser();
      source.connect(analyser);
      analyser.fftSize = 256;
      const values = new Uint8Array(analyser.fftSize);
      const meter = () => {
        analyser.getByteTimeDomainData(values);
        setLevel(
          Math.max(...Array.from(values, (x) => Math.abs(x - 128))) / 128,
        );
        frame.current = requestAnimationFrame(meter);
      };
      meter();
      const r = new MediaRecorder(s);
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        setBlob(new Blob(chunks, { type: r.mimeType }));
        cleanup();
      };
      r.start();
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => setSeconds((n) => n + 1), 1000);
    } catch (e: any) {
      cleanup();
      setError(
        `Microphone unavailable: ${e.message}. Use an uploaded recording instead.`,
      );
    }
  };
  const upload = async (file: Blob, filename: string) => {
    try {
      const data = new FormData();
      data.set("voiceId", voiceId);
      data.set("audio", file, filename);
      const res = await fetch("/api/recording", {
          method: "POST",
          headers: { "x-csrf-token": csrf },
          body: data,
        }),
        r = await res.json();
      if (!res.ok) throw new Error(r.error?.message);
      await refresh();
      setBlob(null);
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <>
      <div className="grid">
        <section className="card">
          <h2>Your private profiles</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get("name");
              const r = await act("voice", { name });
              if (r) setVoiceId(r.id);
            }}
          >
            <label>
              Profile name
              <input
                name="name"
                placeholder="Mukarram · natural conversation"
                maxLength={99}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              Create voice profile
            </button>
          </form>
          <label>
            Selected profile
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
            >
              <option value="">Select a profile</option>
              {state.voice.map((x: Row) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {v && (
            <>
              <div className="info">
                <b>{v.name}</b>
                <span className="pill">{v.state.replaceAll("_", " ")}</span>
                <p>
                  {v.readinessEvidence ??
                    "No enrollment or verification has occurred."}
                </p>
              </div>
              {!v.consentId && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(
                      "voice/consent",
                      { voiceId, own: true, providerUpload: false },
                      "Ownership consent recorded. Nothing has been uploaded to ElevenLabs.",
                    );
                  }}
                >
                  <label className="checkbox">
                    <input type="checkbox" required />I am the speaker and own
                    this voice. I authorize private local storage of my
                    recordings.
                  </label>
                  <p className="muted">
                    Intended provider: ElevenLabs. Provider verification must be
                    completed by you personally. Provider upload requires
                    separate explicit authorization and eligible paid access.
                  </p>
                  <button>Save ownership consent</button>
                </form>
              )}
              {v.consentId && v.state !== "revoked" && (
                <>
                  <button
                    disabled={busy || ["processing", "ready"].includes(v.state)}
                    onClick={() =>
                      act(
                        "voice/enroll-simulation",
                        { voiceId },
                        "Simulation queued. This is not voice training.",
                      )
                    }
                  >
                    Run mock enrollment
                  </button>
                  <button
                    className="danger subtle"
                    onClick={() => {
                      if (
                        confirm(
                          "Revoke voice consent and stop every call using this profile? Recordings remain until separately deleted.",
                        )
                      )
                        act("voice/revoke", { voiceId, confirm: "REVOKE" });
                    }}
                  >
                    Revoke voice consent
                  </button>
                </>
              )}
            </>
          )}
        </section>
        <section className="card">
          <p className="eyebrow">RECORDING GUIDE</p>
          <h2>Sound like yourself.</h2>
          <p>
            Use a quiet room, one speaker and consistent microphone placement.
            Choose the natural delivery you actually want.
          </p>
          <div className="duration">
            <strong>
              {Math.floor(
                assets
                  .filter((a: Row) => a.report?.usable)
                  .reduce((n: number, a: Row) => n + a.report.duration, 0) / 60,
              )}
              <small> min</small>
            </strong>
            <span>
              Heuristically usable material
              <br />
              PVC guide: 30–180 minutes
            </span>
          </div>
          <p className="muted">
            ElevenLabs recommends 30 minutes minimum and preferably 2–3 hours.
            Heuristics cannot verify speaker identity or speech. Listen to every
            take.
          </p>
          <details>
            <summary>Varied reading prompts</summary>
            <ol>
              {state.prompts.map((p: string) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </details>
          <a
            href="https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning"
            target="_blank"
            rel="noreferrer"
          >
            Provider recording guidance ↗
          </a>
        </section>
      </div>
      <section className="card">
        <h2>
          Recording studio <small>ORIGINALS PRESERVED</small>
        </h2>
        <fieldset disabled={!v?.consentId || v?.state === "revoked"}>
          <div className="record-controls">
            <label>
              Input device
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value)}
                disabled={recording}
              >
                <option value="">System default</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              onClick={async () => {
                try {
                  await prepare();
                  stream.current?.getTracks().forEach((t) => t.stop());
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Find microphones
            </button>
            <button
              className={recording ? "danger" : "primary"}
              onClick={() =>
                recording
                  ? (recorder.current?.stop(), setRecording(false))
                  : start()
              }
            >
              {recording ? "Stop recording" : "Record a take"}
            </button>
            <span className="mono" aria-live="off">
              {seconds}s
            </span>
          </div>
          <label>
            Input level
            <meter
              min={0}
              max={1}
              value={level}
              aria-label="Microphone input level"
            />
          </label>
          {url && (
            <>
              <Audio src={url} label="Unsaved take · listen before keeping" />
              <div className="actions">
                <button onClick={() => upload(blob!, "microphone-take.webm")}>
                  Keep & inspect take
                </button>
                <button
                  onClick={() => {
                    setBlob(null);
                    setSeconds(0);
                  }}
                >
                  Discard / retake
                </button>
              </div>
            </>
          )}
          <label className="upload">
            Or upload an original recording
            <input
              type="file"
              accept="audio/*,.flac,.m4a,.webm"
              onChange={(e) => {
                if (e.target.files?.[0])
                  upload(e.target.files[0], e.target.files[0].name);
                e.target.value = "";
              }}
            />
          </label>
          <small>
            WAV, FLAC, MP3, M4A, Ogg or WebM · max 50 MB per file · split into
            clips shorter than 30 minutes. Do not use generated synthetic speech
            as enrollment material.
          </small>
        </fieldset>
      </section>
      {assets.map((a: Row) => (
        <section className="card" key={a.id}>
          <div className="split">
            <h3>{a.filename}</h3>
            <span className="pill">
              {a.report.duration.toFixed(1)}s ·{" "}
              {a.report.usable ? "Heuristic checks passed" : "Review suggested"}
            </span>
          </div>
          <Audio
            src={`/api/audio/${a.id}`}
            label="Private original · not normalized or cleaned"
          />
          <div className="metrics">
            <span>Clipping {(a.report.clippedFraction * 100).toFixed(2)}%</span>
            <span>
              Low-level samples {(a.report.silenceFraction * 100).toFixed(0)}%
            </span>
            <span>RMS {a.report.rms.toFixed(3)}</span>
          </div>
          {a.report.warnings.map((w: string) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
          <p className="muted">{a.report.limitations}</p>
          <button
            className="danger subtle"
            onClick={() => {
              if (
                confirm(
                  "Permanently delete this local original? No provider copy is deleted.",
                )
              )
                act("asset/delete", { id: a.id, confirm: "DELETE" });
            }}
          >
            Delete original
          </button>
        </section>
      ))}
    </>
  );
}

function Quality({ state, act, request, busy }: any) {
  const [version, setVersion] = useState(state.version.at(-1)?.id ?? ""),
    [sentence, setSentence] = useState(0),
    [preset, setPreset] = useState("studio"),
    [preview, setPreview] = useState<Row | null>(null),
    [dictionary, setDictionary] = useState("");
  const v = state.version.find((r: Row) => r.id === version),
    previews = state.preview.filter((p: Row) => p.versionId === version),
    originals = state.asset.filter(
      (a: Row) => a.role === "reference" && a.voiceId === v?.voiceId,
    );
  useEffect(() => {
    setDictionary(v?.dictionary ?? "");
  }, [v?.dictionary]);
  useEffect(() => {
    if (!preview?.id) return;
    const p = state.preview.find((p: Row) => p.id === preview.id);
    if (p?.state === "ready" && !preview.privateAudioUrl)
      request(`preview/${p.id}`).then(setPreview);
  }, [state.preview, preview, request]);
  return (
    <>
      <section className="card">
        <h2>Owner acceptance, never inferred</h2>
        <p>
          Target: your likeness and naturalness ratings ≥4/5 on all{" "}
          {state.heldOut.length} held-out sentences, without material errors in
          names, numbers or prices. Compare studio and telephone-quality speech
          before accepting a real version.
        </p>
        <div className="banner warning">
          Mock previews are calibration tones, not speech and not your clone.
          Practice ratings are excluded from real acceptance. No real audio
          quality or telephone latency has been measured.
        </div>
        <div className="form-grid">
          <label>
            Voice/configuration version
            <select
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Select version</option>
              {state.version.map((r: Row) => (
                <option key={r.id} value={r.id}>
                  {short(r.id)} · {r.provider} ·{" "}
                  {r.approved ? "approved config" : "unapproved"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Playback configuration
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="studio">Studio · Multilingual v2 candidate</option>
              <option value="conversation">
                Conversation · Flash v2.5 candidate
              </option>
            </select>
          </label>
        </div>
        <p className="muted">
          Candidate models only. Exact PVC compatibility, quality and latency
          must be checked against your account and actual ElevenAgents runtime;
          no silent voice substitution.
        </p>
        <label>
          Held-out sentence
          <select
            value={sentence}
            onChange={(e) => setSentence(Number(e.target.value))}
          >
            {state.heldOut.map((s: string, i: number) => (
              <option key={s} value={i}>
                {i + 1}. {s}
              </option>
            ))}
          </select>
        </label>
        <blockquote>{state.heldOut[sentence]}</blockquote>
        <button
          className="primary"
          disabled={!version || busy}
          onClick={async () => {
            const p = await act("preview", {
              versionId: version,
              sentence,
              preset,
            });
            if (p) setPreview(p);
          }}
        >
          Generate mock preview · $0
        </button>
        {preview && (
          <div className="info">
            <b>{preview.label}</b>
            <p>Status: {preview.state}</p>
            {preview.privateAudioUrl && (
              <Audio
                src={preview.privateAudioUrl}
                label="Mock tone · expiring private audio link"
              />
            )}
          </div>
        )}
        {originals[0] && (
          <Audio
            src={`/api/audio/${originals[0].id}`}
            label="Reference original · levels are not automatically matched"
          />
        )}
        <Audition
          original={originals[0] ? `/api/audio/${originals[0].id}` : undefined}
          preview={preview?.privateAudioUrl}
        />
        {preview?.state === "ready" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(
                "rating",
                {
                  previewId: preview.id,
                  ...Object.fromEntries(
                    [
                      "likeness",
                      "naturalness",
                      "pronunciation",
                      "consistency",
                    ].map((k) => [k, Number(f.get(k))]),
                  ),
                  materialError: f.has("materialError"),
                  notes: String(f.get("notes")),
                  telephone: f.has("telephone"),
                },
                "Practice rating saved; not counted as real voice acceptance.",
              );
            }}
          >
            <h3>Practice owner rating</h3>
            <div className="form-grid">
              {["likeness", "naturalness", "pronunciation", "consistency"].map(
                (k) => (
                  <label key={k}>
                    {k}
                    <select name={k} defaultValue="" required>
                      <option value="" disabled>
                        Choose your own rating
                      </option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                ),
              )}
            </div>
            <label className="checkbox">
              <input name="materialError" type="checkbox" />
              Material error in prices, numbers or names
            </label>
            <label className="checkbox">
              <input name="telephone" type="checkbox" />
              Telephone audition (practice label only; no telephone speech
              available)
            </label>
            <label>
              Notes
              <textarea name="notes" maxLength={1000} />
            </label>
            <button>Save my practice ratings</button>
          </form>
        )}
        {v && (
          <>
            <h3>Pronunciation dictionary & versioning</h3>
            <textarea
              aria-label="Pronunciation dictionary"
              value={dictionary}
              maxLength={4000}
              onChange={(e) => setDictionary(e.target.value)}
            />
            <div className="actions">
              <button
                onClick={async () => {
                  const n = await act("voice/version", {
                    versionId: version,
                    dictionary,
                  });
                  if (n) setVersion(n.id);
                }}
              >
                Save as new unapproved version
              </button>
              <button
                onClick={() =>
                  act(
                    "voice/approve",
                    { versionId: version },
                    "Simulation configuration approved. No real voice has been accepted.",
                  )
                }
              >
                Approve simulation configuration only
              </button>
              {v.approved && (
                <button
                  onClick={() =>
                    act(
                      "voice/rollback",
                      { versionId: version },
                      "Profile restored to selected approved configuration.",
                    )
                  }
                >
                  Restore this approved version
                </button>
              )}
            </div>
            <p className="muted">
              {v.acceptance ?? "Not approved"}. Each preview saves its exact
              model/settings/dictionary snapshot.
            </p>
          </>
        )}
      </section>
      <section className="card">
        <h2>Preview history</h2>
        {!previews.length && <p className="muted">No previews yet.</p>}
        {previews.map((p: Row) => (
          <div className="list-row" key={p.id}>
            <div>
              <b>{p.text}</b>
              <p>
                {p.preset} · {p.settings.model} · {p.state} · SIMULATION
              </p>
            </div>
            <button
              onClick={async () => setPreview(await request(`preview/${p.id}`))}
            >
              Inspect
            </button>
            {p.audioId && (
              <button
                onClick={() => {
                  if (confirm("Delete this generated local preview?"))
                    act("asset/delete", { id: p.audioId, confirm: "DELETE" });
                }}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

function Knowledge({ state, act }: any) {
  const current = state.knowledge.at(-1),
    [text, setText] = useState(current?.text ?? "");
  return (
    <>
      <section className="card">
        <p className="eyebrow">VERSIONED PRODUCT FACTS</p>
        <h2>Keep the agent grounded.</h2>
        <p>
          These are the owner-supplied draft facts, not yet confirmed for live
          activation. Future edits create a new snapshot; prepared calls retain
          the exact original version.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(
              "knowledge",
              { text },
              "New knowledge version saved. Existing drafts remain unchanged.",
            );
          }}
        >
          <label>
            Approved-source knowledge
            <textarea
              className="knowledge"
              value={text}
              onChange={(e) => setText(e.target.value)}
              minLength={50}
              maxLength={12000}
              required
            />
          </label>
          <button className="primary">Save new version</button>
        </form>
        <h3>Mandatory AI disclosure</h3>
        <blockquote>{current.disclosure}</blockquote>
        <p>
          Opening is followed by permission to continue, workflow discovery,
          relevant answers, a demo or human follow-up, and specific feedback.
          Caller speech cannot authorize tools or alter instructions.
        </p>
      </section>
      <section className="card">
        <h2>Conversation rehearsal · text only</h2>
        <p>
          <b>Assistant:</b> {current.disclosure}
        </p>
        <p>
          <b>Example caller:</b> How do you handle inspections?
        </p>
        <p>
          <b>Suggested safe response:</b> Vultrix includes a specialized
          repair-job and inspection workflow on the Auto Repair Shop plan. How
          do you currently document your inspections? For details not in the
          approved facts, I can offer a human follow-up.
        </p>
        <p className="muted">
          Static script preview, not a live AI conversation, measured latency
          test or outbound call. No mailbox or personal account data is
          ingested.
        </p>
        <h3>Version history</h3>
        {state.knowledge.map((k: Row) => (
          <details key={k.id}>
            <summary>
              Version {k.version} · {short(k.id)} · not confirmed for live
            </summary>
            <pre>{k.text}</pre>
          </details>
        ))}
      </section>
    </>
  );
}

function Permissions({ state, act }: any) {
  return (
    <>
      <div className="banner warning">
        Pilot allowlist for all destinations. A public business listing is not
        recorded permission. Real provider verification and current
        jurisdiction/provider-policy review remain required. Outbound caller ID
        does not enable inbound AI answering.
      </div>
      <div className="grid">
        <section className="card">
          <h2>Caller identity</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act("caller", {
                number: new FormData(e.currentTarget).get("number"),
              });
            }}
          >
            <label>
              Your test caller number
              <input
                name="number"
                type="tel"
                placeholder="+12025550123"
                pattern="\+[1-9][0-9]{7,14}"
                required
              />
            </label>
            <button>Add simulation-only caller ID</button>
          </form>
          {state.caller.map((c: Row) => (
            <div className="list-row" key={c.id}>
              <div>
                <b>{c.number}</b>
                <p>
                  Not provider-verified · outbound simulation only · no inbound
                  routing
                </p>
              </div>
            </div>
          ))}
        </section>
        <section className="card">
          <h2>Record recipient permission</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              act(
                "permission",
                Object.fromEntries(f),
                "Permission recorded for simulation only.",
              );
            }}
          >
            <label>
              Destination
              <input
                name="number"
                type="tel"
                placeholder="+12025550124"
                required
              />
            </label>
            <label>
              Purpose
              <select name="purpose">
                <option value="owner-test">Owner test destination</option>
                <option value="requested-callback">Requested callback</option>
              </select>
            </label>
            <label>
              Exact consent wording
              <textarea
                name="wording"
                minLength={10}
                maxLength={2000}
                required
              />
            </label>
            <label>
              Permission source
              <input
                name="source"
                placeholder="Where and how permission was requested"
                minLength={3}
                maxLength={300}
                required
              />
            </label>
            <button className="primary">Record permission</button>
          </form>
        </section>
      </div>
      <section className="card">
        <h2>Permissions & suppression</h2>
        {state.permission.map((p: Row) => (
          <div className="list-row" key={p.id}>
            <div>
              <b>{p.number}</b>
              <p>
                {p.purpose} · {p.revoked ? "revoked" : "locally recorded"} ·{" "}
                {new Date(p.recordedAt).toLocaleString()}
              </p>
              <small>
                {p.wording} · Source: {p.source}
              </small>
            </div>
            <button
              disabled={p.revoked}
              onClick={() => act("permission/revoke", { id: p.id })}
            >
              Revoke
            </button>
          </div>
        ))}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            act("suppression", {
              number: new FormData(e.currentTarget).get("number"),
            });
          }}
        >
          <label>
            Suppress a number
            <input
              name="number"
              type="tel"
              placeholder="+12025550124"
              required
            />
          </label>
          <button className="danger">Suppress & stop</button>
        </form>
        {state.suppression.map((s: Row) => (
          <p key={s.id}>
            {s.number} · suppressed · {s.reason}
          </p>
        ))}
      </section>
    </>
  );
}

function Calls({ state, act, busy }: any) {
  const [draft, setDraft] = useState<Row | null>(null),
    [authorized, setAuthorized] = useState(false),
    [reviewed, setReviewed] = useState(false);
  const [key, setKey] = useState("");
  return (
    <>
      <section className="card">
        <div className="split">
          <h2>Prepare a call</h2>
          <span className="pill amber">SIMULATION · $0.00</span>
        </div>
        <p>
          No real number will be dialed. The same review boundaries are used for
          MCP requests.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const d = await act("call/prepare", {
              recipient: f.get("recipient"),
              callerId: f.get("callerId"),
              voiceVersion: f.get("voiceVersion"),
              knowledgeVersion: f.get("knowledgeVersion"),
              purpose: f.get("purpose"),
              duration: Number(f.get("duration")),
              costCapCents: 0,
            });
            if (d) {
              setDraft(d);
              setAuthorized(false);
              setReviewed(false);
              setKey(crypto.randomUUID());
            }
          }}
        >
          <div className="form-grid">
            <label>
              Recipient
              <select name="recipient" required>
                <option value="">Choose an allowed destination</option>
                {state.permission
                  .filter(
                    (p: Row) =>
                      !p.revoked &&
                      !state.suppression.some(
                        (s: Row) => s.number === p.number,
                      ),
                  )
                  .map((p: Row) => (
                    <option key={p.id} value={p.number}>
                      {p.number} · {p.purpose}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Caller ID
              <select name="callerId" required>
                <option value="">Select simulation identity</option>
                {state.caller.map((c: Row) => (
                  <option key={c.id} value={c.id}>
                    {c.number} · SIMULATED
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approved voice configuration
              <select name="voiceVersion" required>
                <option value="">Select an approved version</option>
                {state.version
                  .filter((v: Row) => v.approved)
                  .map((v: Row) => (
                    <option key={v.id} value={v.id}>
                      {short(v.id)} · simulation only
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Knowledge version
              <select name="knowledgeVersion" required>
                {state.knowledge.map((k: Row) => (
                  <option key={k.id} value={k.id}>
                    Version {k.version} · {short(k.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Purpose
              <select name="purpose">
                <option value="owner-test">Owner test</option>
                <option value="requested-callback">Requested callback</option>
              </select>
            </label>
            <label>
              Maximum duration (seconds)
              <input
                name="duration"
                type="number"
                min={10}
                max={180}
                defaultValue={30}
                required
              />
            </label>
          </div>
          <button className="primary" disabled={busy}>
            Prepare immutable draft
          </button>
        </form>
      </section>
      {draft && (
        <section className="card">
          <h2>
            Review exact call draft <small>{short(draft.id)}</small>
          </h2>
          <div className="info">
            <p>
              <b>Recipient:</b> {draft.snapshot.recipient}
              <br />
              <b>Caller:</b> {draft.snapshot.callerNumber} (simulation)
              <br />
              <b>Voice:</b> {draft.snapshot.voice.id}
              <br />
              <b>Purpose:</b> {draft.snapshot.purpose}
              <br />
              <b>Limit:</b> {draft.snapshot.duration}s ·{" "}
              {money(draft.snapshot.costCapCents)}
              <br />
              <b>Recording / transcript:</b> Off / off
            </p>
            <blockquote>{draft.snapshot.knowledge.disclosure}</blockquote>
            <details>
              <summary>Exact knowledge, voice settings and fingerprint</summary>
              <pre>{JSON.stringify(draft.snapshot, null, 2)}</pre>
              <p className="mono">{draft.fingerprint}</p>
            </details>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I authorize this exact simulated call, destination, caller, voice,
            knowledge, duration and $0 cost.
          </label>
          <div className="actions">
            <button
              disabled={!reviewed || busy || authorized}
              onClick={async () => {
                const g = await act(
                  "call/authorize",
                  { draftId: draft.id, confirm: true },
                  "Single-use authorization granted for 2 minutes.",
                );
                if (g) setAuthorized(true);
              }}
            >
              Authorize exact draft
            </button>
            <button
              className="primary"
              disabled={!authorized || busy}
              onClick={() =>
                act(
                  "call/place",
                  { draftId: draft.id, idempotencyKey: key },
                  "Simulation queued. No real call was placed.",
                )
              }
            >
              Start authorized simulation
            </button>
          </div>
        </section>
      )}
      <section className="card">
        <h2>Call history & live state</h2>
        {!state.call.length && (
          <div className="empty">
            No calls yet.
            <p>Prepare a draft above, then review and authorize it.</p>
          </div>
        )}
        {[...state.call].reverse().map((c: Row) => (
          <div className="call-row" key={c.id}>
            <div className="split">
              <h3>{c.number}</h3>
              <span className="pill">SIMULATION · {c.state}</span>
            </div>
            <p>{c.summary}</p>
            <div className="timeline">
              {c.timeline.map((t: any, i: number) => (
                <span key={i}>
                  {t.state} <small>{new Date(t.at).toLocaleTimeString()}</small>
                </span>
              ))}
            </div>
            <div className="actions">
              <button
                className="danger"
                disabled={
                  !["queued", "dialing", "connected", "unknown"].includes(
                    c.state,
                  )
                }
                onClick={() =>
                  act("call/stop", { callId: c.id }, "Simulation stopped.")
                }
              >
                Stop call
              </button>
              <button
                disabled={!["queued", "dialing", "connected"].includes(c.state)}
                onClick={() =>
                  act(
                    "call/optout",
                    { callId: c.id },
                    "Simulated refusal recorded; destination suppressed across future calls.",
                  )
                }
              >
                Simulate “stop calling” / keypad 9
              </button>
            </div>
            <small>
              No recording, persistent transcript, real business feedback or
              measured telephone latency.
            </small>
          </div>
        ))}
      </section>
      {state.draft.length > 0 && (
        <section className="card">
          <h2>Prepared drafts, including MCP requests</h2>
          {[...state.draft].reverse().map((d: Row) => (
            <div className="list-row" key={d.id}>
              <div>
                <b>{d.snapshot.recipient}</b>
                <p>
                  {d.snapshot.purpose} · {d.snapshot.duration}s · $0 ·{" "}
                  {short(d.id)}
                </p>
              </div>
              <button
                onClick={() => {
                  setDraft(d);
                  setReviewed(false);
                  setAuthorized(false);
                  setKey(crypto.randomUUID());
                }}
              >
                Review draft
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function ProviderSettings({ state, act }: any) {
  const [inspection, setInspection] = useState<any>(null);
  return (
    <section className="card">
      <h2>Provider inspection & local retention</h2>
      <p>
        Optional, read-only inspection of server-configured ElevenLabs voice and
        agent IDs. This does not train, upload, generate speech, place calls or
        verify a paid entitlement.
      </p>
      <button
        onClick={async () => {
          const r = await act("provider/inspect", {});
          if (r) setInspection(r);
        }}
      >
        Inspect configured provider
      </button>
      {inspection && <pre>{JSON.stringify(inspection, null, 2)}</pre>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const days = Number(new FormData(e.currentTarget).get("audioDays"));
          if (
            confirm(
              `Automatically delete local originals and previews older than ${days} days? This can remove enrollment material. Provider copies are not affected.`,
            )
          )
            act(
              "retention",
              { audioDays: days },
              "Local audio retention updated. Provider retention is separate.",
            );
        }}
      >
        <label>
          Auto-delete local audio after (days)
          <input
            type="number"
            name="audioDays"
            defaultValue={state.retention[0]?.audioDays ?? 30}
            min={1}
            max={365}
            required
          />
        </label>
        <button>Save retention with confirmation</button>
      </form>
      <p className="muted">
        Audio originals and previews expire after 30 days by default. Consent,
        audit, versions, summaries and suppression remain. Provider deletion and
        provider recording/transcript retention are separate and remain
        unverified. Suppression cannot be removed from this pilot UI.
      </p>
    </section>
  );
}
