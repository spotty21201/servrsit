/**
 * Test-only launcher. Starts the real apps/api server (same buildServer()) on
 * 127.0.0.1:3002 because apps/api/src/index.ts hardcodes port 3001 and has no
 * environment override (reported as defect D2 in test-report-live-001.md).
 *
 * This file lives under tests/ and does not modify production source.
 * Run from apps/api:  tsx ../../tests/live/serve-3002.ts
 */
import { buildServer } from "../../apps/api/src/server.js";

const PORT = Number(process.env["TEST_API_PORT"] ?? 3002);
const fastify = await buildServer();

const shutdown = async (signal: string): Promise<void> => {
  fastify.log.info({ signal }, "tester launcher: shutdown signal");
  await fastify.close();
  fastify.log.info("tester launcher: closed cleanly");
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await fastify.listen({ port: PORT, host: "127.0.0.1" });
