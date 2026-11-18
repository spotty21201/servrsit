/**
 * ServrSit API entry point. The server itself is built in ./server.ts so tests
 * can create it without listening on a port.
 *
 * Logs go through a non-blocking stream and signals through a handler with a
 * deadline, so the process can always be stopped, even when nothing is reading
 * its output (D4).
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createAssistant } from "@servrsit/ai";
import { SqliteAuthStore, SqliteServerStore } from "@servrsit/store";
import { loadAiRuntime } from "./ai-runtime.js";
import { createAsyncLogStream } from "./log-stream.js";
import { resolvePort } from "./port.js";
import { buildServer, DEFAULT_AUTH_DB_PATH } from "./server.js";
import { DEFAULT_REGISTRY_PATH } from "./fleet/config.js";
import { createShutdownHandler } from "./shutdown.js";

const PORT = resolvePort();
const HOST = "127.0.0.1";

async function start(): Promise<void> {
  const ai = loadAiRuntime();
  // T-069: the server registry persists across restarts (gitignored .data/).
  const registryPath = process.env["SERVRSIT_REGISTRY_DB"] ?? DEFAULT_REGISTRY_PATH.pathname;
  mkdirSync(dirname(registryPath), { recursive: true, mode: 0o700 });
  const fastify = await buildServer({
    servers: { store: new SqliteServerStore({ path: registryPath }) },
    redactSecrets: ai.redactSecrets,
    assistant: createAssistant(ai.config),
    logStream: createAsyncLogStream({ fd: 1 }),
    // T-053: owner auth records persist in apps/api/.data (gitignored, created 0600).
    auth: { store: new SqliteAuthStore({ path: process.env["SERVRSIT_AUTH_DB"] ?? DEFAULT_AUTH_DB_PATH }) },
  });
  for (const note of ai.notes) fastify.log[note.level](note.message);

  const shutdown = createShutdownHandler({
    close: () => fastify.close(),
    exit: (code) => process.exit(code),
    log: (level, message, extra) => fastify.log[level](extra ?? {}, message),
  });
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await fastify.listen({ port: PORT, host: HOST });
  } catch (err) {
    fastify.log.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

await start();
