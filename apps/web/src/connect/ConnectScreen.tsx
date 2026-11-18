/**
 * ConnectScreen — UX-03 Connect a server at /servers/new (UX Spec §7.3).
 *
 *   1 Meet the server    name, address, port, user, purpose, classification
 *   2 Set up access      inspect only (maintenance: not available yet), the
 *                        public key line to add; NO private key or password input
 *   3 Verify identity    the owner enters the fingerprint they got from the
 *                        server's own console FIRST; ServrSit then shows what
 *                        it sees and compares. Seeing a key on first connect is
 *                        not independent proof, so nothing is trusted by default
 *   4 First check        progress, partial results, schedule
 *
 * Every response comes from the [FIXTURE] stub (api/stubs/servers.ts), so the
 * [FIXTURE DATA] banner is always shown and nothing is saved anywhere.
 * The draft in localStorage holds non-secret fields only (connectLogic.ts).
 * Back navigation is always available and clears later-step state.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { copyText } from "../auth/copy";
import { CareShell } from "../care/CareShell";
import { createFixtureServersClient, type AccessInfo, type FirstCheckSnapshot, type HostKeyResult, type PrecheckResult, type ServersClient } from "../api/stubs/servers";
import { serverPath } from "../lib/router";
import {
  compareFingerprint, DRAFT_KEY, EMPTY_DRAFT, hasErrors, NOT_SURE_NOTE, parseDraft, serializeDraft, STEPS, treatedAsProduction,
  validateMeet, type Classification, type ConnectDraft, type FieldErrors,
} from "./connectLogic";
import c from "../care/care.module.css";
import s from "../servers/servers.module.css";

const STATE_TEXT = { waiting: "Waiting", running: "In progress", done: "Done", unavailable: "Not available", failed: "Failed" } as const;
const CLASS_LABEL: Record<Classification, string> = { production: "Production", "non-production": "Non-production", "not-sure": "Not sure" };

function readDraft(): { step: number; draft: ConnectDraft } | null {
  try { return parseDraft(globalThis.localStorage?.getItem(DRAFT_KEY) ?? null); } catch { return null; }
}

export function ConnectScreen({ client: injected }: { client?: ServersClient }) {
  const client = useMemo(() => injected ?? createFixtureServersClient(), [injected]);
  const restored = useMemo(readDraft, []);
  const [step, setStep] = useState<number>(restored?.step ?? 0);
  const [draft, setDraft] = useState<ConnectDraft>(restored?.draft ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [pre, setPre] = useState<PrecheckResult | null>(null);
  const [access, setAccess] = useState<AccessInfo | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [entered, setEntered] = useState("");
  const [hostKey, setHostKey] = useState<HostKeyResult | null>(null);
  const [independent, setIndependent] = useState(false);
  const [hostKeyFailed, setHostKeyFailed] = useState(false);
  const [snap, setSnap] = useState<FirstCheckSnapshot | null>(null);
  const [checkState, setCheckState] = useState<"idle" | "running" | "finished">("idle");
  const [finished, setFinished] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);
  const cancelCheck = useRef(false);
  const ids = useId();

  const port = Number(draft.port);
  const req = { address: draft.address.trim(), port };
  const comparison = hostKey ? compareFingerprint(hostKey.fingerprint, entered) : "empty";

  // Non-secret draft, saved on every change. Nothing else is ever written.
  useEffect(() => {
    try { globalThis.localStorage?.setItem(DRAFT_KEY, serializeDraft(Math.min(step, 1), draft)); } catch { /* storage unavailable: no draft */ }
  }, [draft, step]);

  useEffect(() => {
    if (!first.current) titleRef.current?.focus();
    first.current = false;
  }, [step]);

  useEffect(() => { if (step === 1 && !access) void client.getAccessInfo().then(setAccess); }, [step, access, client]);
  useEffect(() => () => { cancelCheck.current = true; }, []);

  const set = <K extends keyof ConnectDraft>(k: K, v: ConnectDraft[K]): void => setDraft((d) => ({ ...d, [k]: v }));

  function go(n: number): void {
    cancelCheck.current = true;
    if (n < 2) { setEntered(""); setHostKey(null); setIndependent(false); setHostKeyFailed(false); }
    if (n < 3) { setSnap(null); setCheckState("idle"); setFinished(false); }
    setStep(n);
  }

  async function submitMeet(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const errs = validateMeet(draft);
    setErrors(errs);
    if (hasErrors(errs)) {
      globalThis.setTimeout(() => (document.querySelector("[aria-invalid=true]") as HTMLElement | null)?.focus(), 0);
      return;
    }
    setBusy(true);
    const r = await client.precheck(req);
    setBusy(false);
    setPre(r);
    if (r.duplicateOf === null && r.reachability.reachable) go(1);
  }

  async function copyLine(text: string): Promise<void> { setCopied((await copyText(text)) ? "ok" : "failed"); }

  async function compare(): Promise<void> {
    setBusy(true);
    setHostKeyFailed(false);
    try { setHostKey(await client.getHostKey(req)); } catch { setHostKeyFailed(true); }
    setBusy(false);
  }

  const runCheck = useCallback(async (): Promise<void> => {
    if (!hostKey) return;
    cancelCheck.current = false;
    setCheckState("running");
    try {
      const handle = await client.startFirstCheck({ ...req, fingerprint: hostKey.fingerprint });
      for (;;) {
        const snapshot = await handle.poll();
        if (cancelCheck.current) return;
        setSnap(snapshot);
        if (snapshot.finished) break;
      }
      setCheckState("finished");
    } catch {
      setCheckState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, hostKey, draft.address, draft.port]);

  function clearDraft(): void {
    try { globalThis.localStorage?.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
    setDraft(EMPTY_DRAFT); setErrors({}); setPre(null); go(0);
  }

  const production = treatedAsProduction(draft.classification);
  const line = access ? `restrict,from="${access.controllerAddress}" ${access.publicKey}` : "";
  const title = STEPS[step] ?? STEPS[0];
  const unavailableCount = snap?.steps.filter((x) => x.state === "unavailable" || x.state === "failed").length ?? 0;

  return (
    <CareShell fixture section="Connect a server">
      <header className={c.header}>
        <h1 className={c.title} ref={titleRef} tabIndex={-1}>Connect a server</h1>
        <p className={c.small}>Step {step + 1} of 4: {title}. ServrSit only looks at the server. It cannot change anything yet.</p>
      </header>

      <ol className={s.stepper} aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} data-state={i < step ? "done" : i === step ? "current" : "todo"} aria-current={i === step ? "step" : undefined}>
            <span className={s.stepNum}>{i < step ? `${i + 1} ✓` : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      <section className={c.panel} aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} className={c.h2}>{title}</h2>

        {step === 0 && (
          <form className={s.form} onSubmit={(e) => void submitMeet(e)} noValidate>
            {restored && <p className={c.small}>Your earlier answers were restored. Only the fields below are saved on this device, never a key or password.</p>}
            <div className={s.field}>
              <label htmlFor={`${ids}-name`}>Name</label>
              <input id={`${ids}-name`} type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} autoComplete="off" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${ids}-name-e` : undefined} />
              {errors.name && <p id={`${ids}-name-e`} className={s.errorText}>{errors.name}</p>}
            </div>
            <div className={s.two}>
              <div className={s.field}>
                <label htmlFor={`${ids}-addr`}>Address</label>
                <input id={`${ids}-addr`} type="text" value={draft.address} onChange={(e) => set("address", e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={errors.address ? true : undefined} aria-describedby={`${ids}-addr-h${errors.address ? ` ${ids}-addr-e` : ""}`} />
                <p id={`${ids}-addr-h`} className={c.small}>A hostname or IP address, such as 100.64.0.20 or web.example.org.</p>
                {errors.address && <p id={`${ids}-addr-e`} className={s.errorText}>{errors.address}</p>}
              </div>
              <div className={s.field}>
                <label htmlFor={`${ids}-port`}>Port</label>
                <input id={`${ids}-port`} type="text" inputMode="numeric" value={draft.port} onChange={(e) => set("port", e.target.value)} autoComplete="off" aria-invalid={errors.port ? true : undefined} aria-describedby={errors.port ? `${ids}-port-e` : undefined} />
                {errors.port && <p id={`${ids}-port-e`} className={s.errorText}>{errors.port}</p>}
              </div>
            </div>
            <div className={s.field}>
              <label htmlFor={`${ids}-user`}>SSH user name</label>
              <input id={`${ids}-user`} type="text" value={draft.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={errors.username ? true : undefined} aria-describedby={`${ids}-user-h${errors.username ? ` ${ids}-user-e` : ""}`} />
              <p id={`${ids}-user-h`} className={c.small}>Use a normal user. Root works but gives the key far more power than inspection needs.</p>
              {errors.username && <p id={`${ids}-user-e`} className={s.errorText}>{errors.username}</p>}
            </div>
            <div className={s.field}>
              <label htmlFor={`${ids}-purpose`}>What is this server for? (optional)</label>
              <textarea id={`${ids}-purpose`} value={draft.purpose} onChange={(e) => set("purpose", e.target.value)} maxLength={300} />
            </div>
            <fieldset className={s.fieldset} aria-describedby={errors.classification ? `${ids}-cls-e` : undefined}>
              <legend className={s.legend}>Is it production?</legend>
              {(["production", "non-production", "not-sure"] as const).map((v) => (
                <label key={v} className={s.choice}>
                  <input type="radio" name={`${ids}-cls`} checked={draft.classification === v} onChange={() => set("classification", v)} aria-invalid={errors.classification ? true : undefined} />
                  <span><span className={s.choiceTitle}>{CLASS_LABEL[v]}</span>
                    {v === "production" && "Customers or your work depend on it."}
                    {v === "non-production" && "A development, test or personal machine."}
                    {v === "not-sure" && "ServrSit treats it as production until you decide."}
                  </span>
                </label>
              ))}
              {errors.classification && <p id={`${ids}-cls-e`} className={s.errorText}>{errors.classification}</p>}
              {draft.classification === "not-sure" && <p className={c.small}>{NOT_SURE_NOTE}</p>}
            </fieldset>

            {pre?.duplicateOf && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="alert">
                <p className={c.noticeTitle}>This server is already connected</p>
                <p>{pre.duplicateName} uses the same address and port. A second record would be a second target for the same machine, so it is not created.</p>
                <a className={c.linkBtn} href={serverPath(pre.duplicateOf)}>Open {pre.duplicateName}</a>
              </div>
            )}
            {pre && !pre.reachability.reachable && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="alert">
                <p className={c.noticeTitle}>ServrSit cannot reach this private address yet</p>
                <p>{pre.reachability.reason} Set up the private route (for example the Tailscale connection ServrSit runs on), then check again. Installing something on your laptop does not give ServrSit always-on access.</p>
              </div>
            )}
            <div className={s.nav}>
              <button type="submit" className={c.primary} disabled={busy}>{busy ? "Checking the address" : pre && !pre.reachability.reachable ? "Check again" : "Continue"}</button>
              <button type="button" className={c.secondary} onClick={clearDraft}>Clear this draft</button>
            </div>
            <p className={c.small}>Reachability here only checks the network path. Signing in is tested separately later.</p>
          </form>
        )}

        {step === 1 && (
          <div className={s.form}>
            <p className={c.p}>ServrSit reaches <strong className={c.mono}>{draft.address}:{draft.port}</strong> over the network, then signs in as <strong className={c.mono}>{draft.username}</strong> with its own key. These are two separate things and are checked separately.</p>
            {production && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="status">
                <p className={c.noticeTitle}>Production precautions apply{draft.classification === "not-sure" ? " (you chose Not sure)" : ""}</p>
                <p>Access is inspect only. Any future change on this server will need its own approval and two production confirmations.</p>
              </div>
            )}
            <fieldset className={s.fieldset}>
              <legend className={s.legend}>What may ServrSit do?</legend>
              <label className={s.choice}>
                <input type="radio" name={`${ids}-acc`} checked readOnly />
                <span><span className={s.choiceTitle}>Inspect only</span>Read facts about the machine: load, memory, storage, services, pending updates. Changes nothing.</span>
              </label>
              <label className={s.choice} aria-disabled="true">
                <input type="radio" name={`${ids}-acc`} disabled />
                <span><span className={s.choiceTitle}>Enable approved maintenance (not available yet)</span>Would allow package updates you approve one by one. It needs a helper installed on the server, which is not offered yet.</span>
              </label>
              <label className={s.choice} aria-disabled="true">
                <input type="checkbox" disabled />
                <span><span className={s.choiceTitle}>Allow package-list refresh (not available yet, off)</span>Refreshes available-package information on this machine. It does not install updates. Without it, ServrSit shows how old the existing package information is.</span>
              </label>
            </fieldset>

            <h3 className={s.h3}>Add ServrSit&rsquo;s public key on the server</h3>
            <p className={c.small}>Do this on the server&rsquo;s console or in a session you already have. ServrSit never asks for a password or a private key, here or in chat.</p>
            <ol className={`${c.list} ${c.bullets}`}>
              <li>Sign in to the server as <span className={c.mono}>{draft.username}</span>.</li>
              <li>Run <span className={c.mono}>mkdir -p ~/.ssh &amp;&amp; chmod 700 ~/.ssh</span>.</li>
              <li>Append the line below to <span className={c.mono}>~/.ssh/authorized_keys</span>, then run <span className={c.mono}>chmod 600 ~/.ssh/authorized_keys</span>.</li>
            </ol>
            {access ? (
              <>
                <pre className={s.codeBlock} tabIndex={0} aria-label="authorized_keys line">{line}</pre>
                <div className={c.row}>
                  <button type="button" className={c.secondary} onClick={() => void copyLine(line)}>Copy the line</button>
                </div>
                <p className={c.small} role="status">{copied === "ok" ? "Copied." : copied === "failed" ? "Couldn't copy. Select the line and copy it by hand." : ""}</p>
                <p className={c.small}><span className={c.mono}>restrict</span> switches off port forwarding, terminals and agent forwarding for this key. <span className={c.mono}>from=&quot;{access.controllerAddress}&quot;</span> lets only ServrSit&rsquo;s address use it. [FIXTURE: this key and address are samples.]</p>
              </>
            ) : <p className={c.p} role="status">Loading ServrSit&rsquo;s public key…</p>}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(0)}>Back</button>
              <button type="button" className={c.primary} onClick={() => go(2)} disabled={!access}>I added the key. Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className={s.form}>
            <p className={c.p}>Before ServrSit trusts this server, compare its host key fingerprint with a value you got <strong>from the server itself</strong>. The first connection alone is not proof: anyone in the middle would show a key too.</p>
            <h3 className={s.h3}>1. Get the fingerprint on the server&rsquo;s console</h3>
            <pre className={s.codeBlock} tabIndex={0} aria-label="command to run on the server">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</pre>
            <p className={c.small}>Use the provider&rsquo;s web console or a session you already trust. The output ends with <span className={c.mono}>(ED25519)</span> and the middle part starts with <span className={c.mono}>SHA256:</span>.</p>
            <div className={s.field}>
              <label htmlFor={`${ids}-fp`}>2. Fingerprint from the server console</label>
              <input id={`${ids}-fp`} type="text" className={c.mono} value={entered} onChange={(e) => { setEntered(e.target.value); setIndependent(false); }} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${ids}-fp-h`} />
              <p id={`${ids}-fp-h`} className={c.small}>Type or paste it. ServrSit shows what it sees only after you enter yours, so the comparison is real.</p>
            </div>
            <button type="button" className={c.secondary} onClick={() => void compare()} disabled={busy || entered.trim() === ""}>{busy ? "Reading the host key" : "3. Compare with what ServrSit sees"}</button>
            {hostKeyFailed && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>Couldn&rsquo;t read the host key</p><p>ServrSit could not get a host key from {draft.address}:{draft.port}. Nothing was trusted.</p></div>}

            {hostKey && (
              <div role="status" aria-live="polite" className={s.form}>
                <p className={c.small}>ServrSit sees ({hostKey.algorithm}):</p>
                <pre className={s.codeBlock} aria-label="fingerprint ServrSit sees">{hostKey.fingerprint}</pre>
                {comparison === "match" && (
                  <>
                    <div className={`${c.notice} ${c.noticePassed}`}><p className={c.noticeTitle}>Matches</p><p>The fingerprint you entered is the one ServrSit sees.</p></div>
                    <label className={s.choice}>
                      <input type="checkbox" checked={independent} onChange={(e) => setIndependent(e.target.checked)} />
                      <span>I got my fingerprint from the server&rsquo;s own console or another independent source, not from this page.</span>
                    </label>
                  </>
                )}
                {comparison === "mismatch" && (
                  <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>Does not match. Do not continue.</p><p>Either you copied the wrong line, or something between ServrSit and the server is presenting a different key. Check the console output again. If it still differs, stop and investigate the network path.</p></div>
                )}
                {comparison === "malformed" && (
                  <div className={`${c.notice} ${c.noticeAttention}`} role="alert"><p className={c.noticeTitle}>That is not a SHA256 fingerprint</p><p>Expected 43 letters and digits after <span className={c.mono}>SHA256:</span>, as <span className={c.mono}>ssh-keygen -lf</span> prints it.</p></div>
                )}
              </div>
            )}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(1)}>Back</button>
              <button type="button" className={c.primary} onClick={() => go(3)} disabled={comparison !== "match" || !independent}>Trust this host key and continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className={s.form}>
            <p className={c.p}>The host key is trusted. Now ServrSit signs in and reads what it can. It connects only now, after you verified the identity.</p>
            {checkState === "idle" && <button type="button" className={c.primary} onClick={() => void runCheck()}>Run the first check</button>}
            {snap && (
              <ul className={s.progress} aria-label="First check progress">
                {snap.steps.map((x) => (
                  <li key={x.id}>
                    <strong>{STATE_TEXT[x.state]}</strong>
                    <span>{x.label}{x.reason ? `. ${x.reason}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <div role="status" aria-live="polite">
              {checkState === "running" && <p className={c.p}>Checking… no percentage is shown because the number of seconds left is not known.</p>}
              {checkState === "finished" && snap && (
                <div className={`${c.notice} ${unavailableCount > 0 ? c.noticeAttention : c.noticePassed}`}>
                  <p className={c.noticeTitle}>{unavailableCount > 0 ? "Partly checked" : "Checked"}</p>
                  <p>{snap.platform?.supported ? `${snap.platform.name} is supported.` : "This platform is not supported."} {snap.steps.length - unavailableCount} of {snap.steps.length} checks ran.{unavailableCount > 0 ? " The usable read-only results are kept, and what could not be read is listed above." : ""}</p>
                </div>
              )}
            </div>
            {checkState === "finished" && (
              <>
                <fieldset className={s.fieldset}>
                  <legend className={s.legend}>How often should ServrSit check?</legend>
                  {(["15", "60"] as const).map((v) => (
                    <label key={v} className={s.choice}>
                      <input type="radio" name={`${ids}-int`} checked={draft.interval === v} onChange={() => set("interval", v)} />
                      <span><span className={s.choiceTitle}>{v === "15" ? "Every 15 minutes (default)" : "Every hour"}</span>{v === "15" ? "Fresh data for the Overview." : "Fewer logins on the server."}</span>
                    </label>
                  ))}
                </fieldset>
                <div className={`${c.notice} ${c.noticeProgress}`} role="status">
                  <p className={c.noticeTitle}>[FIXTURE] Nothing was saved</p>
                  <p>This flow runs on sample data. When the API supports it, finishing here adds the server to your Overview.</p>
                </div>
              </>
            )}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(2)}>Back</button>
              {checkState === "finished" && <a className={c.primary} href="/">Back to Overview</a>}
            </div>
          </div>
        )}
      </section>
    </CareShell>
  );
}
