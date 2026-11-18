/**
 * Server registration API (T-069, PRD FR-02/03/04, Tech Spec §6.2). Implemented
 * in apps/api/src/routes/servers.ts.
 *
 * Every endpoint needs a signed-in owner (session), and every state-changing
 * one also needs the session's CSRF token and an allowed Origin (T-053).
 * No endpoint ever accepts or returns a private key or a password.
 *
 *   POST   /api/servers/drafts                       ServerDraftRequest      -> 201 ServerDraft
 *   GET    /api/servers/drafts/:id                                           -> 200 ServerDraft
 *   DELETE /api/servers/drafts/:id                                           -> 204 (removes the draft and its unused key)
 *   POST   /api/servers/drafts/:id/host-key                                  -> 200 ServerDraft (hostKey filled; read-only key scan)
 *   POST   /api/servers/drafts/:id/host-key/confirm  HostKeyConfirmRequest   -> 200 ServerDraft (the owner typed or compared the fingerprint)
 *   POST   /api/servers/drafts/:id/access-key                                -> 200 ServerDraft (accessKey filled: a key made for THIS server)
 *   POST   /api/servers/drafts/:id/first-check                               -> 202 FirstCheck (read-only collection)
 *   GET    /api/servers/drafts/:id/first-check                               -> 200 FirstCheck (poll)
 *   POST   /api/servers/drafts/:id/activate                                  -> 201 ActivateResponse
 *   PATCH  /api/servers/:id                          ServerUpdateRequest     -> 200 ServerUpdateResponse (name, role, production only)
 *   POST   /api/servers/:id/disconnect                                       -> 200 DisconnectResponse
 *
 * Order is enforced by the API: host key -> owner confirms the fingerprint ->
 * access key -> first check -> activate. Out of order is 409 STATE_CONFLICT.
 * A draft holds no secret and expires after 24 hours.
 */

import { z } from "zod";

export const SERVER_DRAFT_TTL_HOURS = 24;

/** Display name: letters, digits, space, dot, underscore, hyphen. */
export const SERVER_DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
/** Owner-written role text (same rule as the fleet's role field). */
export const SERVER_ROLE = /^[A-Za-z0-9][A-Za-z0-9 ._,()/&'+:-]{0,63}$/;
/** A Linux login name. */
export const SSH_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
/** "SHA256:" + 43 base64 characters, as `ssh-keygen -lf` prints it. */
export const SSH_FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

/**
 * Only the shape is checked here. The API also applies Tech Spec §6.2: no
 * scheme, credentials, command text or shell syntax; no loopback, link-local,
 * metadata (169.254.169.254), the controller itself or operator addresses;
 * private and CGNAT ranges only through the owner's enrolled route; DNS is
 * resolved and re-checked before every connection.
 */
const Address = z.string().min(1).max(253).regex(/^[A-Za-z0-9.:[\]-]+$/);

export const ServerDraftRequestSchema = z
  .object({
    address: Address,
    port: z.number().int().min(1).max(65535).default(22),
    user: z.string().regex(SSH_USER),
    name: z.string().regex(SERVER_DISPLAY_NAME),
    role: z.string().regex(SERVER_ROLE).nullable().default(null),
    production: z.boolean(),
  })
  .strict();
export type ServerDraftRequest = z.infer<typeof ServerDraftRequestSchema>;

export const ReachabilitySchema = z.discriminatedUnion("reachable", [
  /** The TCP path is open. It says nothing about signing in. */
  z.object({ reachable: z.literal(true), note: z.string().max(200) }).strict(),
  z.object({ reachable: z.literal(false), reason: z.string().max(200) }).strict(),
]);
export type Reachability = z.infer<typeof ReachabilitySchema>;

export const HostKeySchema = z
  .object({
    algorithm: z.enum(["ED25519", "ECDSA", "RSA"]),
    fingerprint: z.string().regex(SSH_FINGERPRINT),
    observedAt: z.string().datetime(),
  })
  .strict();
export type HostKey = z.infer<typeof HostKeySchema>;

/**
 * The key ServrSit made for this one server, on the controller. Only the
 * public half is ever returned; the private half never leaves the controller.
 */
export const AccessKeySchema = z
  .object({
    /**
     * The exact line to add to `~/.ssh/authorized_keys` on the server, with
     * options: `restrict,from="<controllerAddress>" ssh-ed25519 AAAA... servrsit-<name>`.
     */
    authorizedKeysLine: z.string().min(20).max(800),
    algorithm: z.literal("ED25519"),
    keyFingerprint: z.string().regex(SSH_FINGERPRINT),
    /** The address ServrSit connects from, used in `from=`. */
    controllerAddress: z.string().min(1).max(253),
    createdAt: z.string().datetime(),
  })
  .strict();
export type AccessKey = z.infer<typeof AccessKeySchema>;

export const ServerDraftStateSchema = z.enum([
  /** Created; address passed validation. */
  "draft",
  /** The server presented a host key; the owner has not confirmed it. */
  "host-key-seen",
  /** The owner confirmed the fingerprint; it is pinned for this draft. */
  "host-key-confirmed",
  /** A dedicated key exists; waiting for the owner to install the public line. */
  "key-issued",
  "checking",
  /** The first check finished (fully or partly); the draft can be activated. */
  "checked",
  /** The first check failed; see firstCheck. The owner can retry. */
  "check-failed",
]);
export type ServerDraftState = z.infer<typeof ServerDraftStateSchema>;

export const ServerDraftSchema = z
  .object({
    id: z.string().uuid(),
    state: ServerDraftStateSchema,
    address: z.string().max(253),
    port: z.number().int().min(1).max(65535),
    user: z.string().regex(SSH_USER),
    name: z.string().regex(SERVER_DISPLAY_NAME),
    role: z.string().regex(SERVER_ROLE).nullable(),
    production: z.boolean(),
    /** An existing server with the same address and port (FR-02). Activation is refused while set. */
    duplicateOf: z.object({ id: z.string().uuid(), name: z.string().max(64) }).nullable(),
    reachability: ReachabilitySchema,
    hostKey: HostKeySchema.nullable(),
    hostKeyConfirmedAt: z.string().datetime().nullable(),
    accessKey: AccessKeySchema.nullable(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type ServerDraft = z.infer<typeof ServerDraftSchema>;

export const HostKeyConfirmRequestSchema = z
  .object({
    /** The fingerprint the owner confirmed. Must equal hostKey.fingerprint exactly. */
    fingerprint: z.string().regex(SSH_FINGERPRINT),
  })
  .strict();
export type HostKeyConfirmRequest = z.infer<typeof HostKeyConfirmRequestSchema>;

export const FirstCheckStepStateSchema = z.enum(["waiting", "running", "done", "unavailable", "failed"]);
export const FirstCheckStepSchema = z
  .object({
    id: z.enum(["connect", "auth", "host", "services", "packages", "clock"]),
    label: z.string().max(100),
    state: FirstCheckStepStateSchema,
    /** Our own text: why a step is unavailable or failed. Never raw server output. */
    reason: z.string().max(300).nullable(),
    at: z.string().datetime().nullable(),
  })
  .strict();
export type FirstCheckStep = z.infer<typeof FirstCheckStepSchema>;

export const FirstCheckSchema = z
  .object({
    draftId: z.string().uuid(),
    steps: z.array(FirstCheckStepSchema).max(10),
    finished: z.boolean(),
    /** Null until the OS is known. `supported` is false for anything but a supported Ubuntu LTS. */
    platform: z.object({ supported: z.boolean(), name: z.string().max(64) }).nullable(),
    /** Null until finished. */
    coverage: z.object({ passed: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
    /** Set when the check failed, from the collector's fixed failure codes. */
    failureCode: z
      .enum(["HOST_UNTRUSTED", "HOST_KEY_CHANGED", "ROUTE_UNAVAILABLE", "AUTH_FAILED", "TIMEOUT", "TARGET_REJECTED", "OUTPUT_INVALID", "COLLECTION_FAILED"])
      .nullable(),
  })
  .strict();
export type FirstCheck = z.infer<typeof FirstCheckSchema>;

export const ActivateResponseSchema = z.object({ serverId: z.string().uuid() }).strict();
export type ActivateResponse = z.infer<typeof ActivateResponseSchema>;

/** Rename or describe. Nothing else about a server can be changed here; writesEnabled never can. */
export const ServerUpdateRequestSchema = z
  .object({
    name: z.string().regex(SERVER_DISPLAY_NAME).optional(),
    role: z.string().regex(SERVER_ROLE).nullable().optional(),
    production: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });
export type ServerUpdateRequest = z.infer<typeof ServerUpdateRequestSchema>;

/** PATCH /api/servers/:id response: the fields that can change, after the change. */
export const ServerUpdateResponseSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().regex(SERVER_DISPLAY_NAME),
    role: z.string().regex(SERVER_ROLE).nullable(),
    production: z.boolean(),
  })
  .strict();
export type ServerUpdateResponse = z.infer<typeof ServerUpdateResponseSchema>;

export const DisconnectResponseSchema = z
  .object({
    serverId: z.string().uuid(),
    /** ServrSit stopped every schedule for this server and deleted its key on the controller. */
    schedulesStopped: z.literal(true),
    controllerKeyDeleted: z.boolean(),
    /** ServrSit cannot prove the remote line is gone, so it never claims it. */
    remoteKeyRemoved: z.literal(false),
    /** Fixed steps for the owner to remove ServrSit's line on the server. */
    remoteSteps: z.array(z.string().max(300)).min(1).max(10),
    /** The authorized_keys line to look for (public, safe to show). */
    authorizedKeysLine: z.string().max(800).nullable(),
  })
  .strict();
export type DisconnectResponse = z.infer<typeof DisconnectResponseSchema>;

export const ServerRegistrationErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  /** The address broke a Tech Spec §6.2 rule; `reason` says which (our own text). */
  "ADDRESS_REJECTED",
  /** The same server is already registered (address+port now; host key and machine identity with T-056). */
  "DUPLICATE_SERVER",
  "DRAFT_NOT_FOUND",
  "DRAFT_EXPIRED",
  /** The step needs a confirmed host key first. */
  "HOST_KEY_NOT_CONFIRMED",
  /** The fingerprint given does not match the key the server presented. */
  "FINGERPRINT_MISMATCH",
  /** The host key changed between scan and connection. */
  "HOST_KEY_CHANGED",
  "ROUTE_UNAVAILABLE",
  /** The step is out of order for the draft's state. */
  "STATE_CONFLICT",
  "SERVER_NOT_FOUND",
]);
export type ServerRegistrationErrorCode = z.infer<typeof ServerRegistrationErrorCodeSchema>;

export const ServerRegistrationErrorSchema = z
  .object({
    error: ServerRegistrationErrorCodeSchema,
    /** Fixed, display-safe text. Never server output. */
    reason: z.string().max(300).optional(),
  })
  .strict();
export type ServerRegistrationError = z.infer<typeof ServerRegistrationErrorSchema>;
