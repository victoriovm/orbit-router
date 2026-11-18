"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal } from "@/shared/components";

const BASE = "/api/oauth/openai-chatgpt";
const ACTIVE_STATUSES = ["starting", "waiting", "completing"];

async function request(path, options = {}) {
  const response = await fetch(`${BASE}/${path}`, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Pi request failed.");
  return data;
}

const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// Cancellation belongs to the attempt, never to the current session ref. A late
// pi-login response can therefore only cancel its own session, even after reopen.
function cancelAttempt(attempt) {
  attempt.active = false;
  clearTimeout(attempt.timer);
  attempt.controller.abort();
  if (attempt.sessionId && !attempt.cancelled && !attempt.done) {
    attempt.cancelled = true;
    void request("pi-cancel", { ...post({ sessionId: attempt.sessionId }), keepalive: true }).catch(() => {});
  }
}

export default function PiAuthModal({ isOpen, onSuccess, onClose }) {
  // Unmount the contents on close so each opening has independent state/refs.
  return (
    <Modal isOpen={isOpen} title="Connect OpenAI ChatGPT via Pi" onClose={onClose} size="lg">
      {isOpen && <PiAuthContent onSuccess={onSuccess} onClose={onClose} />}
    </Modal>
  );
}

function PiAuthContent({ onSuccess, onClose }) {
  const [pi, setPi] = useState(null);
  const [statusError, setStatusError] = useState("");
  const [phase, setPhase] = useState("idle");
  const [authUrl, setAuthUrl] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [authorization, setAuthorization] = useState("");
  const [paste, setPaste] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef(null);
  const mountedRef = useRef(false);
  const copyRef = useRef(0);
  const callbacksRef = useRef({ onSuccess, onClose });

  useEffect(() => { callbacksRef.current = { onSuccess, onClose }; }, [onSuccess, onClose]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    request("pi-status", { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setPi(data); })
      .catch((err) => { if (!controller.signal.aborted) setStatusError(err.message); });
    return () => {
      mountedRef.current = false;
      copyRef.current += 1;
      controller.abort();
      if (attemptRef.current) cancelAttempt(attemptRef.current);
    };
  }, []);

  const isCurrent = (attempt) => mountedRef.current && attempt.active && attemptRef.current === attempt;

  const finish = (attempt) => {
    if (!isCurrent(attempt)) return;
    attempt.done = true;
    cancelAttempt(attempt);
    setPhase("done");
    callbacksRef.current.onSuccess?.();
    callbacksRef.current.onClose?.();
  };

  const fail = (attempt, err) => {
    if (!isCurrent(attempt)) return;
    cancelAttempt(attempt);
    setPhase("error");
    setSubmitting(false);
    setAuthUrl("");
    setError(err.message);
  };

  const applyStatus = (attempt, data) => {
    if (!isCurrent(attempt)) return false;
    if (data.status === "done") {
      finish(attempt);
      return false;
    }
    if (data.status === "error") throw new Error(data.error || "Pi login failed. Please retry.");
    if (!ACTIVE_STATUSES.includes(data.status)) throw new Error("Unexpected Pi login status.");
    setPhase(data.status);
    if (data.authUrl) setAuthUrl(data.authUrl);
    return true;
  };

  const poll = async (attempt) => {
    if (!isCurrent(attempt)) return;
    try {
      const data = await request(`pi-poll?session_id=${encodeURIComponent(attempt.sessionId)}`, {
        signal: attempt.controller.signal,
      });
      if (applyStatus(attempt, data)) attempt.timer = setTimeout(() => poll(attempt), 1500);
    } catch (err) {
      fail(attempt, err);
    }
  };

  const start = async () => {
    if (attemptRef.current?.active) return;
    const attempt = { active: true, controller: new AbortController(), sessionId: null, done: false, cancelled: false };
    attemptRef.current = attempt;
    setError("");
    setAuthUrl("");
    setCallbackUrl("");
    setCopied(false);
    setSubmitting(false);
    setPhase("starting");
    try {
      // Do not abort start: its eventual sessionId must be recovered and cancelled
      // if the modal closed while the server was creating the session.
      const data = await request("pi-login", { method: "POST" });
      attempt.sessionId = data.sessionId;
      if (!isCurrent(attempt)) {
        cancelAttempt(attempt);
        return;
      }
      if (!data.sessionId) throw new Error("Pi did not return a login session.");
      if (applyStatus(attempt, data)) void poll(attempt);
    } catch (err) {
      fail(attempt, err);
    }
  };

  const complete = async (event) => {
    event.preventDefault();
    const attempt = attemptRef.current;
    if (!attempt?.sessionId || !isCurrent(attempt) || attempt.submitting || !callbackUrl.trim()) return;
    attempt.submitting = true;
    setSubmitting(true);
    setError("");
    try {
      await request("pi-complete", {
        ...post({ sessionId: attempt.sessionId, callbackUrl: callbackUrl.trim() }),
        signal: attempt.controller.signal,
      });
      // pi-poll is authoritative: completion may still be importing credentials.
      if (isCurrent(attempt)) {
        setCallbackUrl("");
        setPhase("completing");
      }
    } catch (err) {
      if (isCurrent(attempt)) setError(err.message);
    } finally {
      attempt.submitting = false;
      if (isCurrent(attempt)) setSubmitting(false);
    }
  };

  const importPi = async (event) => {
    event.preventDefault();
    if (!authorization.trim() || attemptRef.current?.active) return;
    const attempt = { active: true, controller: new AbortController(), done: false };
    attemptRef.current = attempt;
    setPhase("importing");
    setError("");
    try {
      await request("import-pi", { ...post({ authorization: authorization.trim() }), signal: attempt.controller.signal });
      finish(attempt);
    } catch (err) {
      fail(attempt, err);
    }
  };

  const copyUrl = async () => {
    const generation = ++copyRef.current;
    try {
      await navigator.clipboard.writeText(authUrl);
      if (mountedRef.current && copyRef.current === generation) setCopied(true);
    } catch {
      if (mountedRef.current && copyRef.current === generation) setError("Could not copy. Select and copy the authorization URL manually.");
    }
  };

  const busy = ACTIVE_STATUSES.includes(phase) || phase === "importing" || phase === "done";
  let safeAuthUrl = "";
  try {
    const url = new URL(authUrl);
    if (url.protocol === "https:" || url.protocol === "http:") safeAuthUrl = url.href;
  } catch { /* A malformed URL is still visible and copyable, but never opened. */ }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">Sign in using an isolated Pi session. Credentials are imported automatically when login completes.</p>
      <p role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
        Refresh tokens are shared with the source Pi credentials. Refreshing or signing in elsewhere can invalidate the shared session; avoid using the same credentials in multiple clients.
      </p>
      <p className="text-xs text-text-muted" role="status">
        {statusError ? `Pi status unavailable: ${statusError}` : pi ? (pi.installed ? `Pi installed${pi.version ? ` (${pi.version})` : ""}` : "Pi is not installed. Use Update Pi on the provider page before signing in.") : "Checking Pi installation..."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant={paste ? "secondary" : "primary"} size="sm" disabled={busy} onClick={() => { setPaste(false); setError(""); }}>Sign in with Pi</Button>
        <Button variant={paste ? "primary" : "secondary"} size="sm" disabled={busy} onClick={() => { setPaste(true); setError(""); }}>Paste Pi JSON</Button>
      </div>
      {paste ? (
        <form onSubmit={importPi} className="flex flex-col gap-3">
          <label htmlFor="pi-authorization" className="text-sm font-medium">Pi authorization JSON</label>
          <textarea id="pi-authorization" value={authorization} onChange={(event) => setAuthorization(event.target.value)} disabled={busy} rows={6} required spellCheck={false} autoComplete="off" className="w-full rounded-lg border border-border bg-surface-2 p-3 text-sm font-mono" placeholder={'{"openai":{"type":"oauth","access":"...","refresh":"...","expires":0,"clientId":"..."}}'} />
          <p className="text-xs text-text-muted">Paste the Pi auth.json entry, including clientId (not client_id). Treat this JSON as a password.</p>
          <Button type="submit" loading={phase === "importing"} disabled={busy || !authorization.trim()}>Import Pi JSON</Button>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {!busy && <Button onClick={start} disabled={pi?.installed === false}>{phase === "error" ? "Retry Pi login" : "Start Pi login"}</Button>}
          {ACTIVE_STATUSES.includes(phase) && <p role="status" className="text-sm text-text-muted">{phase === "starting" ? "Starting isolated Pi login..." : phase === "completing" ? "Completing login and importing credentials..." : "Waiting for Pi authorization..."}</p>}
          {authUrl && <>
            <Input id="pi-auth-url" label="Authorization URL" value={authUrl} readOnly />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={copyUrl}>{copied ? "Copied" : "Copy URL"}</Button>
              <Button size="sm" variant="secondary" icon="open_in_new" disabled={!safeAuthUrl} onClick={() => window.open(safeAuthUrl, "_blank", "noopener,noreferrer")}>Open login page</Button>
            </div>
          </>}
          {(phase === "waiting" || phase === "completing") && <form onSubmit={complete} className="flex flex-col gap-3">
            <Input id="pi-callback-url" type="password" label="Full response URL" value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="http://127.0.0.1:1455/auth/callback?code=...&state=...&client_id=..." hint="After signing in, paste the entire browser response URL, including code and state, even if the page cannot load." autoComplete="off" required disabled={submitting || phase === "completing"} />
            <Button type="submit" loading={submitting} disabled={phase === "completing" || !callbackUrl.trim()}>Submit response URL</Button>
          </form>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {(phase === "error" || statusError) && <p className="text-xs text-text-muted">If Pi is missing or login cannot start, close this modal and click Update Pi on the provider page, then retry. Pi is never updated automatically.</p>}
      <Button variant="ghost" onClick={() => { if (attemptRef.current) cancelAttempt(attemptRef.current); onClose(); }}>Cancel</Button>
    </div>
  );
}
