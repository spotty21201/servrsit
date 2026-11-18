/**
 * ConnectScreen — UX-03 Connect a server at /servers/new (UX Spec §7.3),
 * aligned to the T-069 registration contract.
 *
 *   1 Meet the server    POST draft: name, address, port, user, role, production
 *   2 Verify identity    the owner enters the fingerprint from the server's own
 *                        console FIRST; then ServrSit scans, shows what it sees,
 *                        compares, and the owner confirms (POST host-key/confirm)
 *   3 Set up access      POST access-key: a key made for THIS server; only the
 *                        public `authorized_keys` line is shown. NO private key
 *                        or password input exists anywhere
 *   4 First check        POST first-check, poll; partial results; then activate
 *
 * The contract enforces host key -> confirm -> access key, so identity comes
 * before access (UX Spec lists them the other way round; flagged in the
 * handoff). The screen runs on the [FIXTURE] client until the routes exist, so
 * the [FIXTURE DATA] banner is always shown. Local storage holds the
 * non-secret form fields and the server draft's id only.
 */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { ServerDraft, FirstCheck } from "@servrsit/contracts";
import { copyText } from "../auth/copy";
import { CareShell } from "../care/CareShell";
import { createFixtureServersClient, type ServersClient, type ServersResult } from "../api/stubs/servers";
import { serverPath } from "../lib/router";
import {
  compareFingerprint, DRAFT_ID_KEY, DRAFT_KEY, EMPTY_DRAFT, FAILURE_TEXT, hasErrors, NOT_SURE_NOTE, parseDraft, parseDraftId, registrationError,
  serializeDraft, STEPS, toDraftRequest, treatedAsProduction, validateMeet, type Classification, type ConnectDraft, type FieldErrors,
} from "./connectLogic";
import c from "../care/care.module.css";
import s from "../servers/servers.module.css";

const STATE_TEXT = { waiting: "Waiting", running: "In progress", done: "Done", unavailable: "Not available", failed: "Failed" } as const;
const CLASS_LABEL: Record<Classification, string> = { production: "Production", "non-production": "Non-production", "not-sure": "Not sure" };

const store = {
  get: (k: string): string | null => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set: (k: string, v: string): void => { try { globalThis.localStorage?.setItem(k, v); } catch { /* storage unavailable */ } },
  del: (k: string): void => { try { globalThis.localStorage?.removeItem(k); } catch { /* nothing to remove */ } },
};

/** The step a stored server draft resumes at. */
function stepFor(d: ServerDraft): number {
  switch (d.state) {
    case "draft": case "host-key-seen": return 1;
    case "host-key-confirmed": case "key-issued": return 2;
    default: return 3;
  }
}

export function ConnectScreen({ client: injected }: { client?: ServersClient }) {
  const client = useMemo(() => injected ?? createFixtureServersClient(), [injected]);
  const restoredForm = useMemo(() => parseDraft(store.get(DRAFT_KEY)), []);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ConnectDraft>(restoredForm ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [blocked, setBlocked] = useState<"duplicate" | "route" | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [entered, setEntered] = useState("");
  const [independent, setIndependent] = useState(false);
  const [check, setCheck] = useState<FirstCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);
  const alive = useRef(true);
  const ids = useId();

  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { store.set(DRAFT_KEY, serializeDraft(form)); }, [form]);
  useEffect(() => {
    if (!first.current) titleRef.current?.focus();
    first.current = false;
  }, [step]);

  // Resume a server-side draft (it holds no secret and expires after 24 hours).
  useEffect(() => {
    const id = parseDraftId(store.get(DRAFT_ID_KEY));
    if (!id) return;
    void client.getDraft(id).then((r) => {
      if (!alive.current) return;
      if (!r.ok) { store.del(DRAFT_ID_KEY); return; }
      setDraft(r.data);
      setStep(stepFor(r.data));
    });
  }, [client]);

  const set = <K extends keyof ConnectDraft>(k: K, v: ConnectDraft[K]): void => setForm((d) => ({ ...d, [k]: v }));
  const fail = (r: Extract<ServersResult<unknown>, { ok: false }>): void => setProblem(registrationError(r.error));
  const comparison = draft?.hostKey ? compareFingerprint(draft.hostKey.fingerprint, entered) : "empty";
  const confirmed = draft?.hostKeyConfirmedAt != null;
  const production = draft ? draft.production : treatedAsProduction(form.classification);

  function go(n: number): void { setProblem(null); setStep(n); }

  async function abandonDraft(): Promise<void> {
    if (draft) await client.deleteDraft(draft.id);
    store.del(DRAFT_ID_KEY);
    setDraft(null); setEntered(""); setIndependent(false); setCheck(null); setBlocked(null); setAdded(null);
  }

  async function submitMeet(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    const errs = validateMeet(form);
    setErrors(errs);
    setProblem(null);
    if (hasErrors(errs)) {
      globalThis.setTimeout(() => (document.querySelector("[aria-invalid=true]") as HTMLElement | null)?.focus(), 0);
      return;
    }
    setBusy(true);
    if (draft) await abandonDraft(); // a changed form starts a fresh draft
    const r = await client.createDraft(toDraftRequest(form));
    setBusy(false);
    if (!r.ok) return fail(r);
    if (r.data.duplicateOf) { setDraft(r.data); setBlocked("duplicate"); return; }
    if (!r.data.reachability.reachable) { setDraft(r.data); setBlocked("route"); return; }
    store.set(DRAFT_ID_KEY, r.data.id);
    setDraft(r.data); setBlocked(null);
    go(1);
  }

  async function scan(): Promise<void> {
    if (!draft) return;
    setBusy(true); setProblem(null);
    const r = await client.scanHostKey(draft.id);
    setBusy(false);
    if (!r.ok) return fail(r);
    setDraft(r.data);
  }

  async function trust(): Promise<void> {
    if (!draft?.hostKey) return;
    setBusy(true); setProblem(null);
    const r = await client.confirmHostKey(draft.id, { fingerprint: draft.hostKey.fingerprint });
    if (!r.ok) { setBusy(false); return fail(r); }
    const k = await client.issueAccessKey(r.data.id);
    setBusy(false);
    if (!k.ok) { setDraft(r.data); return fail(k); }
    setDraft(k.data);
    go(2);
  }

  async function runCheck(): Promise<void> {
    if (!draft) return;
    setChecking(true); setProblem(null);
    const started = await client.startFirstCheck(draft.id);
    if (!started.ok) { setChecking(false); return fail(started); }
    setCheck(started.data);
    let snap = started.data;
    while (!snap.finished && alive.current) {
      const r = await client.getFirstCheck(draft.id);
      if (!r.ok) { setChecking(false); return fail(r); }
      snap = r.data;
      setCheck(snap);
      if (snap.failureCode) break;
    }
    if (!alive.current) return;
    setChecking(false);
    const d = await client.getDraft(draft.id);
    if (d.ok) setDraft(d.data);
  }

  async function activate(): Promise<void> {
    if (!draft) return;
    setBusy(true); setProblem(null);
    const r = await client.activate(draft.id);
    setBusy(false);
    if (!r.ok) return fail(r);
    store.del(DRAFT_ID_KEY);
    setAdded(r.data.serverId);
  }

  async function copyLine(text: string): Promise<void> { setCopied((await copyText(text)) ? "ok" : "failed"); }

  const title = STEPS[step] ?? STEPS[0];
  const unavailable = check?.steps.filter((x) => x.state === "unavailable" || x.state === "failed").length ?? 0;
  const checkDone = check?.finished === true && !check.failureCode;

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

      {problem && <div className={`${c.notice} ${c.noticeFailed}`} role="alert"><p className={c.noticeTitle}>That didn&rsquo;t work</p><p>{problem}</p></div>}

      <section className={c.panel} aria-labelledby={`${ids}-h`}>
        <h2 id={`${ids}-h`} className={c.h2}>{title}</h2>

        {step === 0 && (
          <form className={s.form} onSubmit={(e) => void submitMeet(e)} noValidate>
            {restoredForm && <p className={c.small}>Your earlier answers were restored. Only these fields are saved on this device, never a key or password.</p>}
            <div className={s.field}>
              <label htmlFor={`${ids}-name`}>Name</label>
              <input id={`${ids}-name`} type="text" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={64} autoComplete="off" aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${ids}-name-e` : undefined} />
              {errors.name && <p id={`${ids}-name-e`} className={s.errorText}>{errors.name}</p>}
            </div>
            <div className={s.two}>
              <div className={s.field}>
                <label htmlFor={`${ids}-addr`}>Address</label>
                <input id={`${ids}-addr`} type="text" value={form.address} onChange={(e) => set("address", e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={errors.address ? true : undefined} aria-describedby={`${ids}-addr-h${errors.address ? ` ${ids}-addr-e` : ""}`} />
                <p id={`${ids}-addr-h`} className={c.small}>A hostname or IP address, such as 100.64.0.20 or web.example.org.</p>
                {errors.address && <p id={`${ids}-addr-e`} className={s.errorText}>{errors.address}</p>}
              </div>
              <div className={s.field}>
                <label htmlFor={`${ids}-port`}>Port</label>
                <input id={`${ids}-port`} type="text" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value)} autoComplete="off" aria-invalid={errors.port ? true : undefined} aria-describedby={errors.port ? `${ids}-port-e` : undefined} />
                {errors.port && <p id={`${ids}-port-e`} className={s.errorText}>{errors.port}</p>}
              </div>
            </div>
            <div className={s.field}>
              <label htmlFor={`${ids}-user`}>SSH user name</label>
              <input id={`${ids}-user`} type="text" value={form.user} onChange={(e) => set("user", e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={errors.user ? true : undefined} aria-describedby={`${ids}-user-h${errors.user ? ` ${ids}-user-e` : ""}`} />
              <p id={`${ids}-user-h`} className={c.small}>Use a normal user. Root works but gives the key far more power than inspection needs.</p>
              {errors.user && <p id={`${ids}-user-e`} className={s.errorText}>{errors.user}</p>}
            </div>
            <div className={s.field}>
              <label htmlFor={`${ids}-role`}>What is this server for? (optional, shown as its role)</label>
              <input id={`${ids}-role`} type="text" value={form.role} onChange={(e) => set("role", e.target.value)} maxLength={64} autoComplete="off" aria-invalid={errors.role ? true : undefined} aria-describedby={errors.role ? `${ids}-role-e` : undefined} />
              {errors.role && <p id={`${ids}-role-e`} className={s.errorText}>{errors.role}</p>}
            </div>
            <fieldset className={s.fieldset} aria-describedby={errors.classification ? `${ids}-cls-e` : undefined}>
              <legend className={s.legend}>Is it production?</legend>
              {(["production", "non-production", "not-sure"] as const).map((v) => (
                <label key={v} className={s.choice}>
                  <input type="radio" name={`${ids}-cls`} checked={form.classification === v} onChange={() => set("classification", v)} aria-invalid={errors.classification ? true : undefined} />
                  <span><span className={s.choiceTitle}>{CLASS_LABEL[v]}</span>
                    {v === "production" && "Customers or your work depend on it."}
                    {v === "non-production" && "A development, test or personal machine."}
                    {v === "not-sure" && "ServrSit records it as production until you decide."}
                  </span>
                </label>
              ))}
              {errors.classification && <p id={`${ids}-cls-e`} className={s.errorText}>{errors.classification}</p>}
              {form.classification === "not-sure" && <p className={c.small}>{NOT_SURE_NOTE}</p>}
            </fieldset>

            {blocked === "duplicate" && draft?.duplicateOf && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="alert">
                <p className={c.noticeTitle}>This server is already connected</p>
                <p>{draft.duplicateOf.name} uses the same address and port. A second record would be a second target for the same machine, so it is not created.</p>
                <a className={c.linkBtn} href={serverPath(draft.duplicateOf.id)}>Open {draft.duplicateOf.name}</a>
              </div>
            )}
            {blocked === "route" && draft && !draft.reachability.reachable && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="alert">
                <p className={c.noticeTitle}>ServrSit cannot reach this private address yet</p>
                <p>{draft.reachability.reason} Set up the private route (for example the Tailscale connection ServrSit runs on), then check again. Installing something on your laptop does not give ServrSit always-on access.</p>
              </div>
            )}
            <div className={s.nav}>
              <button type="submit" className={c.primary} disabled={busy}>{busy ? "Checking the address" : blocked === "route" ? "Check again" : "Continue"}</button>
              <button type="button" className={c.secondary} onClick={() => { store.del(DRAFT_KEY); void abandonDraft(); setForm(EMPTY_DRAFT); setErrors({}); }}>Clear this draft</button>
            </div>
            <p className={c.small}>Reachability here only checks the network path. Signing in is tested separately later.</p>
          </form>
        )}

        {step === 1 && draft && (
          <div className={s.form}>
            <p className={c.p}>Before ServrSit trusts <strong className={c.mono}>{draft.address}:{draft.port}</strong>, compare its host key fingerprint with a value you got <strong>from the server itself</strong>. The first connection alone is not proof: anyone in the middle would show a key too.</p>
            {confirmed && draft.hostKey ? (
              <div className={`${c.notice} ${c.noticePassed}`} role="status">
                <p className={c.noticeTitle}>Host key confirmed</p>
                <p>You confirmed <span className={c.mono}>{draft.hostKey.fingerprint}</span> ({draft.hostKey.algorithm}). ServrSit will refuse to connect if the server later shows a different key.</p>
              </div>
            ) : (
              <>
                <h3 className={s.h3}>1. Get the fingerprint on the server&rsquo;s console</h3>
                <pre className={s.codeBlock} tabIndex={0} aria-label="command to run on the server">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</pre>
                <p className={c.small}>Use the provider&rsquo;s web console or a session you already trust. The middle part of the output starts with <span className={c.mono}>SHA256:</span>.</p>
                <div className={s.field}>
                  <label htmlFor={`${ids}-fp`}>2. Fingerprint from the server console</label>
                  <input id={`${ids}-fp`} type="text" className={c.mono} value={entered} onChange={(e) => { setEntered(e.target.value); setIndependent(false); }} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${ids}-fp-h`} />
                  <p id={`${ids}-fp-h`} className={c.small}>Type or paste it. ServrSit shows what it sees only after you enter yours, so the comparison is real.</p>
                </div>
                <button type="button" className={c.secondary} onClick={() => void scan()} disabled={busy || entered.trim() === ""}>{busy ? "Reading the host key" : "3. Compare with what ServrSit sees"}</button>
                {draft.hostKey && (
                  <div role="status" aria-live="polite" className={s.form}>
                    <p className={c.small}>ServrSit sees ({draft.hostKey.algorithm}):</p>
                    <pre className={s.codeBlock} aria-label="fingerprint ServrSit sees">{draft.hostKey.fingerprint}</pre>
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
              </>
            )}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(0)}>Back</button>
              {confirmed
                ? <button type="button" className={c.primary} onClick={() => go(2)}>Continue</button>
                : <button type="button" className={c.primary} onClick={() => void trust()} disabled={busy || comparison !== "match" || !independent}>{busy ? "Confirming" : "Trust this host key and continue"}</button>}
            </div>
          </div>
        )}

        {step === 2 && draft && (
          <div className={s.form}>
            <p className={c.p}>ServrSit reaches <strong className={c.mono}>{draft.address}:{draft.port}</strong> over the network, then signs in as <strong className={c.mono}>{draft.user}</strong> with a key made only for this server. These are two separate things and are checked separately.</p>
            {production && (
              <div className={`${c.notice} ${c.noticeAttention}`} role="status">
                <p className={c.noticeTitle}>Production precautions apply{form.classification === "not-sure" ? " (you chose Not sure)" : ""}</p>
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
            <p className={c.small}>Do this on the server&rsquo;s console or in a session you already have. ServrSit never asks for a password or a private key, here or in chat. The private half stays on ServrSit&rsquo;s own machine.</p>
            <ol className={`${c.list} ${c.bullets}`}>
              <li>Sign in to the server as <span className={c.mono}>{draft.user}</span>.</li>
              <li>Run <span className={c.mono}>mkdir -p ~/.ssh &amp;&amp; chmod 700 ~/.ssh</span>.</li>
              <li>Append the line below to <span className={c.mono}>~/.ssh/authorized_keys</span>, then run <span className={c.mono}>chmod 600 ~/.ssh/authorized_keys</span>.</li>
            </ol>
            {draft.accessKey ? (
              <>
                <pre className={s.codeBlock} tabIndex={0} aria-label="authorized_keys line">{draft.accessKey.authorizedKeysLine}</pre>
                <div className={c.row}><button type="button" className={c.secondary} onClick={() => void copyLine(draft.accessKey?.authorizedKeysLine ?? "")}>Copy the line</button></div>
                <p className={c.small} role="status">{copied === "ok" ? "Copied." : copied === "failed" ? "Couldn't copy. Select the line and copy it by hand." : ""}</p>
                <p className={c.small}><span className={c.mono}>restrict</span> switches off port forwarding, terminals and agent forwarding for this key. <span className={c.mono}>from=&quot;{draft.accessKey.controllerAddress}&quot;</span> lets only ServrSit&rsquo;s address use it. Key fingerprint: <span className={c.mono}>{draft.accessKey.keyFingerprint}</span>. [FIXTURE: this key and address are samples.]</p>
              </>
            ) : <p className={c.p} role="status">The key has not been made yet. Go back and confirm the host key.</p>}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(1)}>Back</button>
              <button type="button" className={c.primary} onClick={() => go(3)} disabled={!draft.accessKey}>I added the key. Continue</button>
            </div>
          </div>
        )}

        {step === 3 && draft && (
          <div className={s.form}>
            <p className={c.p}>The host key is trusted. Now ServrSit signs in and reads what it can. It connects only now, after you verified the identity.</p>
            {!checking && !checkDone && <button type="button" className={c.primary} onClick={() => void runCheck()}>{check?.failureCode ? "Run the first check again" : "Run the first check"}</button>}
            {check && (
              <ul className={s.progress} aria-label="First check progress">
                {check.steps.map((x) => (
                  <li key={x.id}>
                    <strong>{STATE_TEXT[x.state]}</strong>
                    <span>{x.label}{x.reason ? `. ${x.reason}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <div role="status" aria-live="polite">
              {checking && <p className={c.p}>Checking… no percentage is shown because the time left is not known.</p>}
              {check?.failureCode && (
                <div className={`${c.notice} ${c.noticeFailed}`} role="alert">
                  <p className={c.noticeTitle}>Could not complete</p>
                  <p>{FAILURE_TEXT[check.failureCode] ?? "The check could not complete."} Nothing was added.</p>
                </div>
              )}
              {checkDone && check && (
                <div className={`${c.notice} ${unavailable > 0 ? c.noticeAttention : c.noticePassed}`}>
                  <p className={c.noticeTitle}>{unavailable > 0 ? "Partly checked" : "Checked"}</p>
                  <p>{check.platform ? (check.platform.supported ? `${check.platform.name} is supported.` : `${check.platform.name} is not a supported platform.`) : "The platform could not be identified."} {check.coverage ? `${check.coverage.passed} of ${check.coverage.total} checks ran.` : ""}{unavailable > 0 ? " The usable read-only results are kept, and what could not be read is listed above." : ""}</p>
                </div>
              )}
            </div>
            {checkDone && !added && (
              <>
                <fieldset className={s.fieldset}>
                  <legend className={s.legend}>How often should ServrSit check?</legend>
                  {(["15", "60"] as const).map((v) => (
                    <label key={v} className={s.choice}>
                      <input type="radio" name={`${ids}-int`} checked={form.interval === v} onChange={() => set("interval", v)} />
                      <span><span className={s.choiceTitle}>{v === "15" ? "Every 15 minutes (default)" : "Every hour"}</span>{v === "15" ? "Fresh data for the Overview." : "Fewer logins on the server."}</span>
                    </label>
                  ))}
                  <p className={c.small}>The registration API has no schedule setting yet, so this choice is not saved.</p>
                </fieldset>
                <button type="button" className={c.primary} onClick={() => void activate()} disabled={busy}>{busy ? "Adding the server" : `Add ${draft.name} to ServrSit`}</button>
              </>
            )}
            {added && (
              <div className={`${c.notice} ${c.noticeProgress}`} role="status">
                <p className={c.noticeTitle}>[FIXTURE] Server added (sample)</p>
                <p>With the live API this opens the new server&rsquo;s page. Here nothing was saved. <a href={serverPath(added)}>Server page (sample id)</a></p>
              </div>
            )}
            <div className={s.nav}>
              <button type="button" className={c.secondary} onClick={() => go(2)} disabled={checking}>Back</button>
              {added && <a className={c.primary} href="/">Back to Overview</a>}
            </div>
          </div>
        )}
      </section>
    </CareShell>
  );
}
