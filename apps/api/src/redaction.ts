/**
 * Log, error and response redaction.
 *
 * - Logger: header and credential fields are censored by path, every logged
 *   string and plain object is scrubbed for known secret values and for
 *   bearer-shaped credentials, and request URLs are scrubbed.
 * - Errors: 5xx responses carry a fixed message; 4xx messages are scrubbed.
 * - Responses: every string payload is scrubbed as a last line of defence.
 */

import { STATUS_CODES } from "node:http";
import { createScrubber, REDACTED, type Scrub } from "@servrsit/ai";
import type { FastifyError, FastifyInstance } from "fastify";

export interface LogStream {
  write(message: string): void;
}

export interface LoggerSettings {
  readonly level: string;
  readonly secrets: readonly string[];
  /** For tests: capture log lines instead of writing to stdout. */
  readonly stream?: LogStream | undefined;
}

interface ReqLike {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
}

export function createLoggerOptions(settings: LoggerSettings) {
  const scrub = createScrubber(settings.secrets);
  return {
    level: settings.level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "headers.authorization",
        "*.authorization",
        "*.apiKey",
        "*.api_key",
      ],
      censor: REDACTED,
    },
    serializers: {
      req: (req: ReqLike) => ({
        method: req.method ?? "",
        url: String(scrub(req.url ?? "")),
        hostname: req.hostname ?? "",
        remoteAddress: req.ip ?? "",
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode ?? 0 }),
      err: (err: { name?: string; message?: string; stack?: string }) => ({
        type: err.name ?? "Error",
        message: String(scrub(err.message ?? "")),
        stack: String(scrub(err.stack ?? "")),
      }),
    },
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
        method.apply(this, args.map((a) => scrub(a)));
      },
    },
    ...(settings.stream === undefined ? {} : { stream: settings.stream }),
  };
}

export function installResponseRedaction(fastify: FastifyInstance, scrub: Scrub, hasSecrets: boolean): void {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const status = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
    const body: Record<string, unknown> = {
      statusCode: status,
      error: STATUS_CODES[status] ?? "Error",
      message: status >= 500 ? "Internal Server Error" : String(scrub(error.message)),
    };
    if (status < 500 && typeof error.code === "string") body["code"] = error.code;
    return reply.status(status).send(body);
  });

  if (hasSecrets) {
    fastify.addHook("onSend", async (_request, _reply, payload) =>
      typeof payload === "string" ? (scrub(payload) as string) : payload,
    );
  }
}
