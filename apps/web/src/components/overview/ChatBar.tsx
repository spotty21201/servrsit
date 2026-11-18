/**
 * ChatBar — "Ask ServrSit" console at the bottom of the Overview (T-045)
 *
 * Usable: Enter sends, Shift+Enter inserts a newline (IME composition is
 * respected). Send is disabled only while the message is empty or a request
 * is in flight ("Sending…").
 *
 * The answer appears in a compact panel just above the console:
 *   - max ~6 lines, scrolls internally, keyboard reachable (tabIndex 0)
 *   - announced politely (aria-live="polite")
 *   - shows the answer, an "AI" / "Deterministic" label from `source`,
 *     the scope it answered for, evidence (server + observed time), notice
 * Errors are shown inline (role="alert"), never as a toast. The draft is kept
 * on error so nothing is lost.
 *
 * Answer and notice text are untrusted and rendered as plain text only.
 * A suggestion or an answer never approves anything (UX Spec §9).
 *
 * Imports the client only via ../../api/assistantClient (one-line swap from
 * the stub to Coder's real client).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  askAssistant,
  AssistantError,
  type AssistantResponse,
  type AssistantScope,
} from "../../api/assistantClient.js";
import { formatClockWithAge, parseIso } from "../../lib/time";
import styles from "./ChatBar.module.css";

const MAX_MESSAGE_LENGTH = 2000;

interface ChatServer {
  id: string;
  name: string;
}

interface ChatBarProps {
  /** Servers available as a scope. */
  servers: ChatServer[];
  /** Owner time zone (IANA) for evidence times. */
  timeZone: string;
}

type Answered = { seq: number; response: AssistantResponse; scope: AssistantScope; question: string };

function errorText(err: unknown): string {
  if (err instanceof AssistantError) {
    switch (err.code) {
      case "INVALID_INPUT":
        return `That question can't be sent. Use 1–${MAX_MESSAGE_LENGTH} characters.`;
      case "RATE_LIMITED":
        return "Too many questions right now. Wait a moment, then try again.";
      case "NETWORK":
        return "ServrSit couldn't be reached. Your question is kept; try again.";
      default:
        return "ServrSit couldn't answer that. Your question is kept; try again.";
    }
  }
  return "ServrSit couldn't answer that. Your question is kept; try again.";
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function formatObserved(iso: string, tz: string): string {
  const d = parseIso(iso);
  return d ? formatClockWithAge(d, new Date(), tz) : iso;
}

export function ChatBar({ servers, timeZone }: ChatBarProps) {
  const ids = useId();
  const inputId = `${ids}-input`;
  const labelId = `${ids}-label`;
  const scopeId = `${ids}-scope`;
  const errorId = `${ids}-error`;

  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<AssistantScope>("all");
  const [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  // Abort an in-flight request if the component goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const nameFor = (id: string) => servers.find((s) => s.id === id)?.name ?? id;
  const scopeName = (s: AssistantScope) => (s === "all" ? "All servers" : nameFor(s));

  const canSend = message.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const question = message;
    const askedScope = scope;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setSending(true);
    setError(null);
    try {
      const response = await askAssistant(question, askedScope, controller.signal);
      setAnswered((prev) => ({ seq: (prev?.seq ?? 0) + 1, response, scope: askedScope, question }));
      setMessage(""); // clear only on success; the draft survives errors
    } catch (err) {
      if (!isAbort(err)) setError(errorText(err));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setSending(false);
      }
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a newline; never send mid IME composition.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const r = answered?.response;

  return (
    <section className={styles.wrap} aria-labelledby={labelId}>
      {/* Response + error slot. The live region is always mounted so the
          first answer is announced too. */}
      <div aria-live="polite" className={styles.liveSlot}>
        {r && answered && (
          <div
            key={answered.seq}
            className={styles.panel}
            role="region"
            aria-label="ServrSit answer"
            tabIndex={0}
          >
            <div className={styles.panelMeta}>
              <span className={`${styles.sourceTag} ${r.source === "ai" ? styles.sourceAi : styles.sourceDet}`}>
                {r.source === "ai" ? "AI" : "Deterministic"}
              </span>
              {r.source === "ai" && r.model && <span className={styles.model}>{r.model}</span>}
              <span className={styles.panelScope}>
                <span className="sr-only">Scope: </span>{scopeName(answered.scope)}
              </span>
            </div>

            <p className={styles.answer}>{r.answer}</p>

            {r.evidence.length > 0 ? (
              <p className={styles.evidence}>
                <span className={styles.evidenceLabel}>Based on</span>{" "}
                {r.evidence.map((ev, i) => (
                  <span key={`${ev.serverId}-${ev.observedAt}`} className={styles.evidenceItem}>
                    {nameFor(ev.serverId)} · observed{" "}
                    <time dateTime={ev.observedAt}>{formatObserved(ev.observedAt, timeZone)}</time>
                    {i < r.evidence.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
            ) : (
              <p className={styles.evidence}>No server observations were used.</p>
            )}

            {r.notice && (
              <p className={styles.notice}>
                <span className={styles.noticeLabel}>Note:</span> {r.notice}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.header}>
          <label id={labelId} htmlFor={inputId} className={styles.label}>
            Ask ServrSit
          </label>
          <label htmlFor={scopeId} className="sr-only">
            Scope
          </label>
          <select
            id={scopeId}
            className={styles.scope}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All servers</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className={styles.note}>Enter to send · Shift+Enter for a new line</span>
        </div>

        <div className={styles.console}>
          <textarea
            id={inputId}
            className={styles.input}
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder="What needs attention? Explain Nabire's updates…"
            autoComplete="off"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <button
            type="submit"
            className={`${styles.send} ${sending ? styles.sending : ""}`}
            disabled={!canSend}
            aria-busy={sending || undefined}
          >
            {sending ? (
              <span className={styles.sendingText}>Sending…</span>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
                  {/* pixel arrow */}
                  <rect x="2" y="7" width="9" height="2" fill="currentColor" />
                  <rect x="9" y="5" width="2" height="2" fill="currentColor" />
                  <rect x="11" y="7" width="2" height="2" fill="currentColor" />
                  <rect x="9" y="9" width="2" height="2" fill="currentColor" />
                  <rect x="7" y="3" width="2" height="2" fill="currentColor" />
                  <rect x="7" y="11" width="2" height="2" fill="currentColor" />
                </svg>
                <span className="sr-only">Send question to ServrSit</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
