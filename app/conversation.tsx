"use client";
import { useEffect, useState } from "react";

type Props = {
  state: any;
  request: (path: string, input?: any) => Promise<any>;
};
export function ConversationLab({ state, request }: Props) {
  const calls = state.call.filter((c: any) => c.conversation === "codex");
  const [callId, setCallId] = useState("");
  const [text, setText] = useState(
    "What does Vultrix cost for an auto repair shop?",
  );
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!callId) {
      setReport(null);
      return;
    }
    let active = true;
    const poll = async () => {
      try {
        const r = await request(`fixture/${callId}`);
        if (active) {
          setReport(r);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [callId, request]);
  return (
    <section className="card">
      <div className="split">
        <h2>Codex conversation lab</h2>
        <span className="pill amber">FICTIONAL CALLER · $0</span>
      </div>
      <p>
        Codex decides every reply. This service captures its exact submitted
        text; it does not generate replies, synthesize your voice or dial
        anyone. Fictional fixture text is encrypted locally and follows audio
        retention.
      </p>
      <p>
        In Calls, prepare a <b>Codex fixture</b>, authorize its exact draft and
        start it. Connect Codex with <code>calls:listen</code> and{" "}
        <code>calls:speak</code>. Send a caller utterance here after it
        connects. Codex has 15 seconds per turn before the approved fixed
        fallback and end.
      </p>
      <label>
        Authorized fixture call
        <select
          value={callId}
          onChange={(e) => {
            setReport(null);
            setCallId(e.target.value);
          }}
        >
          <option value="">Select a Codex fixture call</option>
          {calls.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.id.slice(0, 8)} · {c.state}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button
          onClick={() =>
            setText("What does Vultrix cost for an auto repair shop?")
          }
        >
          Price question
        </button>
        <button
          onClick={() =>
            setText("Can Vultrix help track brake repairs and oil changes?")
          }
        >
          Repair question
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await request("fixture/utterance", { callId, text });
            if (r.status !== "queued") setError(`Not sent: ${r.status}`);
            setReport(await request(`fixture/${callId}`));
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Fictional caller transcript
          <textarea
            value={text}
            maxLength={2000}
            required
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button
          className="primary"
          disabled={!callId || report?.state !== "connected" || busy}
        >
          Send caller utterance
        </button>
        <button
          type="button"
          className="danger"
          disabled={!callId}
          onClick={async () => {
            try {
              await request("call/stop", { callId });
              setReport(await request(`fixture/${callId}`));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Stop fixture
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {report && (
        <>
          <p>
            State: <b>{report.state}</b>{" "}
            {report.endReason && `· ${report.endReason}`}
          </p>
          {report.turns.map((t: any) => (
            <div className="info" key={t.turnId}>
              <p>
                <b>Caller · {t.state}</b>
              </p>
              <blockquote style={{ whiteSpace: "pre-wrap" }}>
                {t.transcript}
              </blockquote>
              <p>
                <b>Exact reply submitted by connected client</b>
              </p>
              <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {t.submittedText ?? "Awaiting client reply"}
              </pre>
              {t.fallbackText && (
                <p>Fixed timeout fallback (not Codex): {t.fallbackText}</p>
              )}
              <p>
                End of caller turn → reply captured:{" "}
                {t.codexWaitMs == null ? "not measured" : `${t.codexWaitMs} ms`}
                . First audio: not measured (text-only capture).
              </p>
              <small className="mono">
                Turn: {t.turnId}
                <br />
                Reply SHA-256: {t.replyHash ?? "none"}
              </small>
            </div>
          ))}
          <p className="muted">{report.evidence}</p>
        </>
      )}
    </section>
  );
}
