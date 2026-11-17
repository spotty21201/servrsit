/**
 * Loads the owner-context file (T-050): apps/api/config/assistant-context.md.
 *
 * Re-read only when the file's modification time or size changes, so the
 * owner can edit it without restarting the API. Fails closed: a missing,
 * unreadable, empty or secret-looking file means no owner context. Log lines
 * never contain the file's text.
 */

import { readFileSync, statSync } from "node:fs";
import { prepareOwnerContext } from "@servrsit/ai";

export const DEFAULT_OWNER_CONTEXT_PATH = new URL("../config/assistant-context.md", import.meta.url).pathname;

export interface OwnerContextLog {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
}

export class OwnerContextFile {
  private stamp: string | null = null;
  private text: string | null = null;

  constructor(
    private readonly path: string,
    private readonly knownSecrets: readonly string[],
    private readonly log: OwnerContextLog,
  ) {}

  /** The prepared owner context, or null. */
  get(): string | null {
    let stamp: string;
    try {
      const st = statSync(this.path);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      if (this.stamp !== "missing") this.log.info({ path: "assistant-context.md" }, "owner context: file not found, none used");
      this.stamp = "missing";
      this.text = null;
      return null;
    }
    if (stamp === this.stamp) return this.text;
    this.stamp = stamp;

    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      this.log.warn({}, "owner context: file could not be read, none used");
      this.text = null;
      return null;
    }
    const prepared = prepareOwnerContext(raw, this.knownSecrets);
    if (!prepared.ok) {
      if (prepared.reason === "secret") {
        this.log.warn({ reason: "secret" }, "owner context REJECTED: it looks like it contains a secret; none used");
      } else {
        this.log.info({ reason: prepared.reason }, "owner context: nothing filled in yet, none used");
      }
      this.text = null;
      return null;
    }
    if (prepared.truncated) {
      this.log.warn({ bytes: prepared.bytes }, "owner context: longer than 4 KB, truncated");
    }
    this.log.info({ bytes: prepared.bytes, droppedPlaceholders: prepared.droppedPlaceholders }, "owner context loaded");
    this.text = prepared.text;
    return prepared.text;
  }
}
