/**
 * [FIXTURE DATA]
 *
 * A local mock of an OpenAI-compatible endpoint, listening on loopback only.
 * Records every request so tests can assert exactly what was sent.
 */

import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface Mock {
  readonly baseUrl: string;
  readonly requests: Recorded[];
  close(): Promise<void>;
}

export type Handler = (req: IncomingMessage, res: ServerResponse, recorded: Recorded) => void | Promise<void>;

export async function startMock(handler: Handler): Promise<Mock> {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const recorded: Recorded = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(recorded);
      void Promise.resolve(handler(req, res, recorded));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A normal chat completion. The provider reports a different model id than requested. */
export function completion(content: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "chatcmpl-fixture",
    object: "chat.completion",
    model: "cb/deepseek-v4.1-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  };
}
