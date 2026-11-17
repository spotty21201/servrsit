/**
 * Write-once intent records in a directory (ADR-015).
 *
 * Technical Spec §9.2 writes the approval/intent object to private S3 with a
 * conditional create before dispatch. Locally, an exclusive-create file
 * ('wx') in a directory separate from the database gives the same contract:
 * the first write wins, an identical rewrite is a no-op, a different body for
 * the same key is refused. Not off-instance: see ADR-015.
 */

import { mkdirSync, openSync, readFileSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { IntentStore } from "./store.js";

const KEY = /^[A-Za-z0-9._-]{1,120}$/;

export class IntentConflictError extends Error {
  constructor(key: string) {
    super(`intent record ${key} already exists with a different digest`);
    this.name = "IntentConflictError";
  }
}

export class FileIntentStore implements IntentStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private path(key: string): string {
    if (!KEY.test(key)) throw new Error("invalid intent key");
    return join(this.dir, `${key}.json`);
  }

  put(key: string, digest: string, body: unknown): "created" | "exists" {
    const file = this.path(key);
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify({ digest, body }));
      } finally {
        closeSync(fd);
      }
      return "created";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = this.get(key);
      if (current?.digest === digest) return "exists";
      throw new IntentConflictError(key);
    }
  }

  get(key: string): { digest: string; body: unknown } | null {
    try {
      return JSON.parse(readFileSync(this.path(key), "utf8")) as { digest: string; body: unknown };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

/** In-memory intent store for tests. */
export class MemoryIntentStore implements IntentStore {
  private readonly records = new Map<string, { digest: string; body: unknown }>();

  put(key: string, digest: string, body: unknown): "created" | "exists" {
    const current = this.records.get(key);
    if (current === undefined) {
      this.records.set(key, { digest, body });
      return "created";
    }
    if (current.digest === digest) return "exists";
    throw new IntentConflictError(key);
  }

  get(key: string): { digest: string; body: unknown } | null {
    return this.records.get(key) ?? null;
  }
}
