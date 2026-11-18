/**
 * SignInScreen — UX-01 sign-in (UX Spec §7.1). Password, then the 6-digit
 * authenticator code, or a recovery code instead. There is no skip path.
 *
 * Errors use fixed wording (authText.ts): they never say whether an account
 * exists. A lockout shows when to retry and disables the form until then.
 * Labels are real <label>s, not placeholders. Password managers work
 * (autocomplete username / current-password / one-time-code); pasting is
 * never blocked. Nothing takes focus on first load; focus moves to the step
 * heading when the step changes.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { login, verifySecondFactor, type AuthResult } from "../api/auth";
import type { SessionInfo } from "@servrsit/contracts";
import { DEFAULT_OWNER_TIME_ZONE } from "../lib/time";
import { usePageTitle } from "../lib/pageTitle";
import { AuthFrame, Notice, ReasonButton } from "./AuthFrame";
import { authError, codeStepReason, isTotpComplete, normaliseRecovery, normaliseTotp, passwordStepReason, recoveryStepReason, type ErrorView, type Step } from "./authText";
import styles from "./auth.module.css";

export type SignInNotice = "signed-out" | "expired" | null;

interface Props {
  notice: SignInNotice;
  onSignedIn: (session: SessionInfo) => void;
  onSetup: () => void;
}

export function SignInScreen({ notice, onSignedIn, onSetup }: Props) {
  const [step, setStep] = useState<Extract<Step, "password" | "totp" | "recovery">>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const [lockedUntil, setLockedUntil] = useState<Date | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const shownStep = useRef(step); // compares with the previous value, so a StrictMode double run never focuses on load

  useEffect(() => {
    // Focus moves to the heading on every step change, and on arrival after sign-out or an ended session (D-U5),
    // so keyboard focus is not left on <body> and the notice is read first. A cold load takes no focus.
    if (shownStep.current !== step || notice !== null) titleRef.current?.focus();
    shownStep.current = step;
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!lockedUntil) return;
    const ms = lockedUntil.getTime() - Date.now();
    if (ms <= 0) { setLockedUntil(null); return; }
    const t = globalThis.setTimeout(() => setLockedUntil(null), ms);
    return () => globalThis.clearTimeout(t);
  }, [lockedUntil]);

  const locked = lockedUntil !== null;

  function fail<T>(r: Extract<AuthResult<T>, { ok: false }>, at: Step): void {
    const view = authError(r.error, at, new Date(), DEFAULT_OWNER_TIME_ZONE);
    setError(view);
    setLockedUntil(view.retryAt);
    if (view.restart) { setStep("password"); setCode(""); setRecovery(""); }
  }

  async function submitPassword(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || locked || username.trim() === "" || password === "") return;
    setBusy(true);
    setError(null);
    const r = await login(username.trim(), password);
    setBusy(false);
    if (!r.ok) return fail(r, "password");
    setPassword("");
    setShowPw(false);
    setStep("totp");
  }

  async function submitSecond(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy || locked) return;
    const recoveryCode = normaliseRecovery(recovery);
    const totp = normaliseTotp(code);
    if (step === "recovery" ? recoveryCode.length < 8 : !isTotpComplete(totp)) return;
    setBusy(true);
    setError(null);
    const r = await verifySecondFactor(step === "recovery" ? { recoveryCode } : { code: totp });
    setBusy(false);
    if (!r.ok) return fail(r, step);
    onSignedIn(r.data);
  }

  function go(next: "password" | "totp" | "recovery"): void {
    setError(null);
    setStep(next);
  }

  const title = step === "password" ? "Sign in" : step === "totp" ? "Enter your code" : "Use a recovery code";
  usePageTitle(step === "password" ? (notice === "expired" ? "Session ended, sign in" : notice === "signed-out" ? "Signed out, sign in" : "Sign in") : step === "totp" ? "Sign in: enter your code" : "Sign in: recovery code");

  return (
    <AuthFrame title={title} titleRef={titleRef}>
      {step === "password" && notice === "signed-out" && (
        <Notice tone="passed">You&rsquo;re signed out. Your servers have a sitter either way.</Notice>
      )}
      {step === "password" && notice === "expired" && (
        <Notice tone="attention" title="Your session ended">
          It ended after an hour without activity, or at the 8-hour limit. Nothing was changed on your servers. Sign in again and you&rsquo;ll return to the page you were on.
        </Notice>
      )}

      {step === "password" && (
        <form className={styles.form} onSubmit={(e) => void submitPassword(e)} noValidate>
          <div className={styles.field}>
            <label htmlFor="si-user">Username</label>
            <input id="si-user" name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "si-error" : undefined} />
          </div>
          <div className={styles.field}>
            <label htmlFor="si-pass">Password</label>
            <div className={styles.inputRow}>
              <input id="si-pass" name="password" type={showPw ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "si-error" : undefined} />
              <button type="button" className={styles.toggle} aria-pressed={showPw} aria-label="Show password" onClick={() => setShowPw((v) => !v)}>Show</button>
            </div>
          </div>
          {error && <Notice id="si-error" tone="failed" alert>{error.text}</Notice>}
          <ReasonButton id="si-go" type="submit" className={styles.primary} busy={busy} reason={passwordStepReason(username, password, locked)}>{busy ? "Signing in" : "Continue"}</ReasonButton>
          <p className={styles.help}>Next you&rsquo;ll enter a code from your authenticator app.</p>
          <p className={styles.altRow}>First time here? <button type="button" className={styles.link} onClick={onSetup}>Set up the owner account</button></p>
        </form>
      )}

      {step === "totp" && (
        <form className={styles.form} onSubmit={(e) => void submitSecond(e)} noValidate>
          <p className={styles.p}>Password accepted. Open your authenticator app and enter the 6-digit code for ServrSit.</p>
          <div className={styles.field}>
            <label htmlFor="si-code">6-digit code</label>
            <input id="si-code" name="code" className={styles.codeInput} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "si-error" : undefined} />
          </div>
          {error && <Notice id="si-error" tone="failed" alert>{error.text}</Notice>}
          <ReasonButton id="si-go2" type="submit" className={styles.primary} busy={busy} reason={codeStepReason(code, locked)}>{busy ? "Signing in" : "Sign in"}</ReasonButton>
          <p className={styles.altRow}>
            <button type="button" className={styles.link} onClick={() => { setCode(""); go("recovery"); }}>Use a recovery code instead</button>
            {" · "}
            <button type="button" className={styles.link} onClick={() => { setCode(""); go("password"); }}>Start over</button>
          </p>
        </form>
      )}

      {step === "recovery" && (
        <form className={styles.form} onSubmit={(e) => void submitSecond(e)} noValidate>
          <p className={styles.p}>Enter one of the recovery codes you saved when you set up. Each code works once.</p>
          <div className={styles.field}>
            <label htmlFor="si-rec">Recovery code</label>
            <input id="si-rec" name="recovery" className={styles.codeInput} type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={recovery} onChange={(e) => setRecovery(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "si-error" : undefined} />
          </div>
          {error && <Notice id="si-error" tone="failed" alert>{error.text}</Notice>}
          <ReasonButton id="si-go3" type="submit" className={styles.primary} busy={busy} reason={recoveryStepReason(recovery, locked)}>{busy ? "Signing in" : "Sign in with recovery code"}</ReasonButton>
          <p className={styles.altRow}>
            <button type="button" className={styles.link} onClick={() => { setRecovery(""); go("totp"); }}>Use the authenticator code instead</button>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
