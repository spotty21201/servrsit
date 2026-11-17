/**
 * ServrSit API entry point. The server itself is built in ./server.ts so tests
 * can create it without listening on a port.
 */

import { buildServer } from "./server.js";

const PORT = 3001;
const HOST = "127.0.0.1";

async function start(): Promise<void> {
  const fastify = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info({ signal }, "Received shutdown signal — closing server");
    try {
      await fastify.close();
      fastify.log.info("Server closed cleanly");
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

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
