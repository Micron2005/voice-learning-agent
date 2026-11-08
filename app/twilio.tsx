"use client";
import { useCallback, useEffect, useState } from "react";
import type { TwilioSetupReport } from "../server/providers";

type Props = { request: (path: string, input?: unknown) => Promise<any> };

export function TwilioSetup({ request }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [report, setReport] = useState<TwilioSetupReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    setBusy(true);
    setReport(null);
    setConfigured(null);
    try {
      const setup = await request("twilio/setup");
      setConfigured(setup.configured);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup status unavailable.");
    } finally {
      setBusy(false);
    }
  }, [request]);
  useEffect(() => {
    void load();
  }, [load]);
  const inspect = async () => {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      setReport(await request("twilio/inspect", {}));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection check unavailable.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="card">
        <p className="eyebrow">TWILIO / READ-ONLY CONNECTION</p>
        <h2>Bring your phone account into this workspace.</h2>
        <p>
          Check your account and number setup here. This check only reads Twilio
          metadata; it cannot call, verify a phone, buy a number, change routing
          or upgrade your account.
        </p>
        <div className="info">
          <b>
            {configured === null
              ? "Server setup not checked"
              : configured
                ? "Server credentials configured"
                : "Server credentials missing"}
          </b>
          <p>
            The Account SID and Auth Token stay in the server’s private
            environment. They are never displayed, stored in browser storage or
            sent to MCP clients.
          </p>
          {configured === false && (
            <p>
              Set <code>TWILIO_ACCOUNT_SID</code> and{" "}
              <code>TWILIO_AUTH_TOKEN</code> on the server, then restart the
              app. Do not paste credentials into chat or this dashboard.
            </p>
          )}
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || configured !== true}
            onClick={inspect}
          >
            {busy ? "Checking…" : "Check Twilio connection"}
          </button>
          <button disabled={busy} onClick={load}>
            Reload server setup
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <p className="muted">
          Checks run only when you press the button. No automatic provider
          polling or dialing. A successful connection does not approve a call.
        </p>
      </section>
      {report && (
        <section
          className="card"
          aria-label="Twilio connection result"
          role="status"
        >
          <p className="eyebrow">PROVIDER RESPONSE / NOT CALL READINESS</p>
          <h2>Twilio connection verified</h2>
          <p>
            Account: <b>{report.account.type}</b> · Status:{" "}
            <b>{report.account.status}</b>
          </p>
          <p className="muted">
            Checked {new Date(report.checkedAt).toLocaleString()}. This result
            is not saved; check again after changing provider setup.
          </p>
          <div
            className={`banner ${report.trialAccountActive ? "success" : "error"}`}
          >
            {report.trialAccountActive
              ? "Active trial account detected. Free minutes and call eligibility are still unconfirmed."
              : "Trial-only setup blocked: this account is paid, suspended or closed. No calls or purchases are enabled."}
          </div>
          {report.resourcesChecked && (
            <div className="grid">
              <div>
                <h3>Twilio numbers returned by API</h3>
                {report.phoneNumbers.length ? (
                  <ul>
                    {report.phoneNumbers.map((n, i) => (
                      <li key={i}>
                        {n.numberMasked} ·{" "}
                        {n.voiceCapable
                          ? "Voice capable"
                          : "Voice not reported available"}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No numbers returned by the standard phone-number API.</p>
                )}
              </div>
              <div>
                <h3>Verified caller IDs returned by API</h3>
                {report.verifiedCallerIds.length ? (
                  <ul>
                    {report.verifiedCallerIds.map((n, i) => (
                      <li key={i}>{n.numberMasked}</li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    No caller IDs returned by the standard verification API.
                  </p>
                )}
              </div>
            </div>
          )}
          {report.listsTruncated && (
            <p>
              Only the first 50 entries per list were inspected. More entries
              exist; this is not a complete inventory.
            </p>
          )}
          <p>
            Newer Twilio trials can manage numbers separately in Try out Voice.
            Empty API lists do <b>not</b> prove that your signup phone is
            unverified.
          </p>
          <h3>Still required before any real call</h3>
          <ul className="blockers">
            {report.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="card">
        <p className="eyebrow">ZERO-SPEND BOUNDARY</p>
        <h2>Connected is not activated.</h2>
        <p>
          The app’s approved spend remains <b>$0</b>. All calls in the Calls tab
          remain simulations. There is no live-dial button, cloned speech or
          conversational phone agent in this connection milestone.
        </p>
        <p>
          Twilio must handle identity and phone verification. Use its trial
          screen only for those steps and the Voice free-units tracker. Do not
          upgrade, add payment details or purchase a number for this check.
        </p>
        <div className="actions">
          <a
            href="https://console.twilio.com/"
            target="_blank"
            rel="noreferrer"
          >
            Open Twilio Console ↗
          </a>
          <a
            href="https://www.twilio.com/docs/usage/trials/try-out-voice"
            target="_blank"
            rel="noreferrer"
          >
            Trial restrictions ↗
          </a>
        </div>
      </section>
    </>
  );
}
