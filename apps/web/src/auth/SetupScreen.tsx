/**
 * SetupScreen — UX-01 first-run enrolment (UX Spec §7.1, ADR-017).
 *
 *   1 details   setup token (printed in the API console), username, password
 *   2 enrol     QR code drawn locally + the secret as text, confirm a code
 *   3 codes     10 recovery codes, shown once; copy / download; "I saved these"
 *
 * The TOTP secret and the recovery codes live only in component state: never
 * in storage, never in the URL, never logged. The QR is rendered in the
 * browser (no third-party QR service). Leaving step 3 before confirming
 * triggers the browser's "leave page?" prompt, because the codes cannot be
 * shown again. Pasting and password managers are allowed everywhere.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { USERNAME_PATTERN, type SessionInfo, type SetupStartResponse } from "@servrsit/contracts";
import { confirmSetup, startSetup, type AuthResult } from "../api/auth";
import { DEFAULT_OWNER_TIME_ZONE } from "../lib/time";
import { usePageTitle } from "../lib/pageTitle";
import { AuthFrame, Notice } from "./AuthFrame";
import { authError, groupSecret, isPasswordAcceptable, isTotpComplete, normaliseTotp, passwordHint, recoveryFileText, type ErrorView, type Step } from "./authText";
import { copyText, downloadText } from "./copy";
import { QrCode } from "./QrCode";
import styles from "./auth.module.css";

interface Props {
  onDone: (session: SessionInfo) => void;
  onBack: () => void;
}

type Phase = "details" | "enrol" | "codes";

export function SetupScreen({ onDone, onBack }: Props) {
  const [phase, setPhase] = useState<Phase>("details");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("owner");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [enrol, setEnrol] = useState<SetupStartResponse | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<readonly string[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [secretCopied, setSecretCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!first.current) titleRef.current?.focus();
    first.current = false;
  }, [phase]);

  // The recovery codes cannot be shown again: ask before the page is left.
  useEffect(() => {
    if (phase !== "codes" || saved) return;
    const h = (e: BeforeUnloadEvent): void => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [phase, saved]);

  const hint = passwordHint(password);
  const usernameOk = USERNAME_PATTERN.test(username);
  const detailsOk = token.trim().length >= 16 && usernameOk && isPasswordAcceptable(password);

  function fail<T>(r: Extract<AuthResult<T>, { ok: false }>, at: Step): void {
    const view = authError(r.error, at, new Date(), DEFAULT_OWNER_TIME_ZONE);
    setError(view);
    if (view.restart) { setPhase("details"); setEnrol(null); setCode(""); }
  }

  async function submitDetails(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || !detailsOk) return;
    setBusy(true);
    setError(null);
    const r = await startSetup(token.trim(), username, password);
    setBusy(false);
    if (!r.ok) return fail(r, "setup-token");
    setEnrol(r.data);
    setPassword("");
    setShowPw(false);
    setPhase("enrol");
  }

  async function submitCode(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || !isTotpComplete(code)) return;
    setBusy(true);
    setError(null);
    const r = await confirmSetup(normaliseTotp(code));
    setBusy(false);
    if (!r.ok) return fail(r, "enrol-confirm");
    setCodes(r.data.recoveryCodes);
    setSession(r.data.session);
    setEnrol(null); // the secret is no longer needed in memory
    setCode("");
    setPhase("codes");
  }

  async function copyCodes(): Promise<void> {
    setCopied((await copyText(codes.join("\n"))) ? "ok" : "failed");
  }

  async function copySecret(): Promise<void> {
    if (!enrol) return;
    setSecretCopied((await copyText(enrol.totpSecret)) ? "ok" : "failed");
  }

  usePageTitle(phase === "details" ? "Set up ServrSit: account" : phase === "enrol" ? "Set up ServrSit: authenticator" : "Set up ServrSit: recovery codes");
  const title = phase === "details" ? "Set up ServrSit" : phase === "enrol" ? "Add your authenticator" : "Save your recovery codes";

  return (
    <AuthFrame title={title} titleRef={titleRef}>
      <ol className={styles.steps} aria-label="Setup progress">
        {(["details", "enrol", "codes"] as const).map((p, i) => (
          <li key={p} aria-current={p === phase ? "step" : undefined} className={p === phase ? styles.stepOn : undefined}>
            <span aria-hidden="true">{i + 1}</span> {p === "details" ? "Account" : p === "enrol" ? "Authenticator" : "Recovery codes"}
          </li>
        ))}
      </ol>

      {phase === "details" && (
        <form className={styles.form} onSubmit={(e) => void submitDetails(e)} noValidate>
          <p className={styles.p}>Create the single owner account. Two-step sign-in is required, so you&rsquo;ll add an authenticator next.</p>
          <div className={styles.field}>
            <label htmlFor="su-token">Setup token</label>
            <input id="su-token" name="setup-token" className={styles.mono} type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} aria-describedby="su-token-help" />
            <p id="su-token-help" className={styles.help}>The API prints it in its console (stderr) when it starts. It works once; restarting the API prints a new one.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="su-user">Username</label>
            <input id="su-user" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-describedby="su-user-help" aria-invalid={username !== "" && !usernameOk ? true : undefined} />
            <p id="su-user-help" className={styles.help}>Letters, digits, dots, dashes and underscores.</p>
          </div>
          <div className={styles.field}>
            <label htmlFor="su-pass">Password</label>
            <div className={styles.inputRow}>
              <input id="su-pass" name="new-password" type={showPw ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="su-pass-hint" />
              <button type="button" className={styles.toggle} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>{showPw ? "Hide" : "Show"}</button>
            </div>
            <div className={styles.meter} data-level={hint.level} aria-hidden="true"><span /><span /><span /></div>
            <p id="su-pass-hint" className={styles.help}>{hint.text} Pasting and password managers work.</p>
          </div>
          {error && <Notice tone="failed" alert>{error.text}</Notice>}
          <button type="submit" className={styles.primary} disabled={busy || !detailsOk}>{busy ? "Checking" : "Continue to authenticator"}</button>
          <p className={styles.altRow}><button type="button" className={styles.link} onClick={onBack}>Back to sign in</button></p>
        </form>
      )}

      {phase === "enrol" && enrol && (
        <form className={styles.form} onSubmit={(e) => void submitCode(e)} noValidate>
          <ol className={styles.instructions}>
            <li>Open an authenticator app (such as one built into your password manager).</li>
            <li>Scan the code below, or enter the key by hand.</li>
            <li>Type the 6-digit code the app shows, then confirm.</li>
          </ol>
          <div className={styles.qrWrap}>
            <QrCode value={enrol.otpauthUri} label="QR code for your authenticator app. The key is also written out below." />
            <div className={styles.keyBlock}>
              <p className={styles.keyLabel}>Key, if you can&rsquo;t scan</p>
              <p className={styles.key}>{groupSecret(enrol.totpSecret)}</p>
              <div className={styles.row}>
                <button type="button" className={styles.secondary} onClick={() => void copySecret()}>Copy key</button>
                <a className={styles.secondaryLink} href={enrol.otpauthUri}>Open in authenticator app</a>
              </div>
              <p className={styles.help} role="status">{secretCopied === "ok" ? "Key copied." : secretCopied === "failed" ? "Couldn't copy. Select the key and copy it by hand." : "Account name: ServrSit. Time-based, 6 digits."}</p>
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="su-code">6-digit code from the app</label>
            <input id="su-code" name="code" className={styles.codeInput} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={error ? true : undefined} />
            <p className={styles.help}>This setup stays open for about {Math.max(1, Math.round(enrol.expiresInSeconds / 60))} minutes.</p>
          </div>
          {error && <Notice tone="failed" alert>{error.text}</Notice>}
          <button type="submit" className={styles.primary} disabled={busy || !isTotpComplete(code)}>{busy ? "Confirming" : "Confirm and create account"}</button>
        </form>
      )}

      {phase === "codes" && session && (
        <div className={styles.form}>
          <Notice tone="attention" title="Shown once">If you lose your authenticator, each code below signs you in one time. ServrSit can&rsquo;t show them again, so save them now.</Notice>
          <ul className={styles.codes} aria-label="Recovery codes">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={() => void copyCodes()}>Copy all</button>
            <button type="button" className={styles.secondary} onClick={() => downloadText("servrsit-recovery-codes.txt", recoveryFileText(codes, new Date()))}>Download .txt</button>
          </div>
          <p className={styles.help} role="status">{copied === "ok" ? "Copied. Paste them into your password manager." : copied === "failed" ? "Couldn't copy. Select the codes and copy them by hand, or download the file." : "Store them in a password manager or print them."}</p>
          <label className={styles.check}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I saved these recovery codes</span>
          </label>
          <button type="button" className={styles.primary} disabled={!saved} onClick={() => onDone(session)}>Continue to ServrSit</button>
        </div>
      )}
    </AuthFrame>
  );
}
