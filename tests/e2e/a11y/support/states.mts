/**
 * Every UI state the accessibility pass looks at. Each state mounts the REAL app (or a real
 * screen component) in jsdom against the scripted API and drives it the way a person would
 * (typing, clicking). Synthetic data only: fixture plans/operations and "Fixture One" servers.
 */
import { installFetch, type Handler, type Installed } from "./api.mts";
import { $, $$, byText, click, h, mount, settle, type, waitFor, type Mounted } from "./render.mts";

export interface Opened { m: Mounted; api: Installed }
export interface State { id: string; group: "auth" | "setup" | "overview" | "plan" | "operation"; label: string; open(): Promise<Opened> }

const authed: Record<string, Handler> = { "GET /api/auth/session": () => ({ json: JSON.parse(JSON.stringify(sessionNow())) }) };
function sessionNow() {
  return { authenticated: true, username: "owner", csrfToken: "A".repeat(43), csrfHeader: "x-csrf-token", idleExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString() };
}
const err = (status: number, error: string, extra: Record<string, unknown> = {}): ReturnType<Handler> => ({ status, json: { error, ...extra } });

async function app(path: string, overrides: Record<string, Handler> = {}): Promise<Opened> {
  const api = installFetch(overrides);
  const App = (await import("../../../../apps/web/src/App.tsx")).default;
  const m = await mount(path, () => h(App));
  return { m, api };
}
const input = (id: string) => $<HTMLInputElement>(`#${id}`)!;

async function toPasswordForm(o: Record<string, Handler> = {}): Promise<Opened> {
  const x = await app("/", o);
  await waitFor(() => !!$("#si-user"), "sign-in form");
  return x;
}
async function fillPassword(user = "owner", pw = "synthetic-password-0001"): Promise<void> {
  await type(input("si-user"), user);
  await type(input("si-pass"), pw);
}
async function toTotp(o: Record<string, Handler> = {}): Promise<Opened> {
  const x = await toPasswordForm(o);
  await fillPassword();
  await click(byText("button", "Continue")!);
  await waitFor(() => !!$("#si-code"), "code step");
  return x;
}
async function toSetupDetails(o: Record<string, Handler> = {}): Promise<Opened> {
  const x = await toPasswordForm(o);
  await click(byText("button", /Set up the owner account/)!);
  await waitFor(() => !!$("#su-token"), "setup form");
  return x;
}
async function toEnrol(o: Record<string, Handler> = {}): Promise<Opened> {
  const x = await toSetupDetails(o);
  await type(input("su-token"), "synthetic-setup-token-0001");
  await type(input("su-pass"), "synthetic-password-0001");
  await click(byText("button", /Continue to authenticator/)!);
  await waitFor(() => !!$("#su-code"), "enrol step");
  return x;
}

const planIds = ["ready", "production", "lost", "changed", "expired", "busy", "writes-off"];
const opIds = ["queued", "running", "running-stop", "verifying", "succeeded", "succeeded-reboot", "partial", "failed", "cancelled", "unknown"];

export const states: State[] = [
  // ---------------------------------------------------------------- sign-in
  { id: "auth-checking", group: "auth", label: "checking the session", async open() { return app("/", { "GET /api/auth/session": () => "hang" }); } },
  { id: "auth-unreachable", group: "auth", label: "API unreachable", async open() { const x = await app("/", { "GET /api/auth/session": () => "network-error" }); await waitFor(() => /Can.t reach/.test(document.body.textContent ?? ""), "unreachable"); return x; } },
  { id: "auth-password", group: "auth", label: "sign-in, password step", async open() { return toPasswordForm(); } },
  { id: "auth-password-error", group: "auth", label: "sign-in, wrong password", async open() {
    const x = await toPasswordForm({ "POST /api/auth/login": () => err(401, "INVALID_CREDENTIALS") });
    await fillPassword(); await click(byText("button", "Continue")!); await waitFor(() => !!$("[role=alert]"), "error"); return x; } },
  { id: "auth-lockout", group: "auth", label: "sign-in, locked out", async open() {
    const x = await toPasswordForm({ "POST /api/auth/login": () => err(429, "LOCKED_OUT", { retryAfterSeconds: 300 }) });
    await fillPassword(); await click(byText("button", "Continue")!); await waitFor(() => !!$("[role=alert]"), "lockout"); return x; } },
  { id: "auth-code", group: "auth", label: "sign-in, code step", async open() { return toTotp(); } },
  { id: "auth-code-error", group: "auth", label: "sign-in, wrong code", async open() {
    const x = await toTotp({ "POST /api/auth/totp": () => err(401, "INVALID_CODE") });
    await type(input("si-code"), "123456"); await click(byText("button", "Sign in")!); await waitFor(() => !!$("[role=alert]"), "error"); return x; } },
  { id: "auth-recovery", group: "auth", label: "sign-in, recovery code", async open() {
    const x = await toTotp(); await click(byText("button", /recovery code instead/)!); await waitFor(() => !!$("#si-rec"), "recovery"); return x; } },
  { id: "auth-notice-signed-out", group: "auth", label: "sign-in after sign-out", async open() {
    const api = installFetch(); const { SignInScreen } = await import("../../../../apps/web/src/auth/SignInScreen.tsx");
    const m = await mount("/", () => h(SignInScreen, { notice: "signed-out", onSignedIn() {}, onSetup() {} })); await settle(); return { m, api }; } },
  { id: "auth-notice-expired", group: "auth", label: "sign-in after the session ended", async open() {
    const api = installFetch(); const { SignInScreen } = await import("../../../../apps/web/src/auth/SignInScreen.tsx");
    const m = await mount("/", () => h(SignInScreen, { notice: "expired", onSignedIn() {}, onSetup() {} })); await settle(); return { m, api }; } },

  // ---------------------------------------------------------------- setup
  { id: "setup-details", group: "setup", label: "setup, account details", async open() { return toSetupDetails(); } },
  { id: "setup-weak-password", group: "setup", label: "setup, short password hint", async open() {
    const x = await toSetupDetails(); await type(input("su-pass"), "short"); await settle(); return x; } },
  { id: "setup-error", group: "setup", label: "setup, token refused", async open() {
    const x = await toSetupDetails({ "POST /api/auth/setup": () => err(403, "SETUP_UNAVAILABLE") });
    await type(input("su-token"), "synthetic-setup-token-0001"); await type(input("su-pass"), "synthetic-password-0001");
    await click(byText("button", /Continue to authenticator/)!); await waitFor(() => !!$("[role=alert]"), "error"); return x; } },
  { id: "setup-enrol", group: "setup", label: "setup, QR code and key", async open() { return toEnrol(); } },
  { id: "setup-enrol-error", group: "setup", label: "setup, wrong confirmation code", async open() {
    const x = await toEnrol({ "POST /api/auth/setup/confirm": () => err(401, "INVALID_CODE") });
    await type(input("su-code"), "123456"); await click(byText("button", /Confirm and create account/)!); await waitFor(() => !!$("[role=alert]"), "error"); return x; } },
  { id: "setup-codes", group: "setup", label: "setup, recovery codes shown once", async open() {
    const x = await toEnrol(); await type(input("su-code"), "123456"); await click(byText("button", /Confirm and create account/)!);
    await waitFor(() => !!$("ul[aria-label='Recovery codes']"), "recovery codes"); return x; } },

  // ---------------------------------------------------------------- overview (signed in)
  { id: "overview", group: "overview", label: "overview with three fixture servers", async open() {
    const x = await app("/", authed); await waitFor(() => /Fixture One/.test(document.body.textContent ?? ""), "fleet"); await settle(); return x; } },
  { id: "clock-fixture", group: "overview", label: "fixture page: ServrSit's own clock untrusted", async open() {
    const x = await app("/fixtures/clock", authed); await waitFor(() => !!$("h1"), "clock page"); await settle(); return x; } },
  { id: "overview-api-down", group: "overview", label: "overview, fleet request failing", async open() {
    const x = await app("/", { ...authed, "GET /api/fleet": () => "network-error" }); await settle(50); return x; } },

  // ---------------------------------------------------------------- care screens (fixtures)
  ...planIds.map((id): State => ({ id: `plan-${id}`, group: "plan", label: `plan review, fixture ${id}`, async open() {
    const x = await app(`/plans/fixture-plan-${id}`, authed); await waitFor(() => !!$("h1") && !/Loading/.test(document.body.textContent ?? ""), "plan"); await settle(); return x; } })),
  { id: "plan-production-acknowledged", group: "plan", label: "plan review, production, both acknowledgements ticked", async open() {
    const x = await app("/plans/fixture-plan-production", authed); await waitFor(() => $$("input[type=checkbox]").length >= 2, "checkboxes");
    for (const c of $$<HTMLInputElement>("input[type=checkbox]")) await click(c); await settle(); return x; } },
  { id: "plan-production-submitting", group: "plan", label: "plan review, after Approve is pressed", async open() {
    const x = await app("/plans/fixture-plan-production", authed); await waitFor(() => $$("input[type=checkbox]").length >= 2, "checkboxes");
    for (const c of $$<HTMLInputElement>("input[type=checkbox]")) await click(c);
    await click($$("button").find((b) => /Approve update/.test(b.textContent ?? ""))!); await settle(20); return x; } },
  ...opIds.map((id): State => ({ id: `op-${id}`, group: "operation", label: `operation detail, fixture ${id}`, async open() {
    const x = await app(`/operations/fixture-op-${id}`, authed); await waitFor(() => !!$("h1") && !/Loading/.test(document.body.textContent ?? ""), "operation"); await settle(); return x; } })),
  { id: "op-running-transcript-open", group: "operation", label: "operation, transcript opened", async open() {
    const x = await app("/operations/fixture-op-running", authed); await waitFor(() => !!$("summary, button[aria-expanded]"), "transcript control");
    const t = $("summary, button[aria-expanded]")!; await click(t); await settle(); return x; } },
];
