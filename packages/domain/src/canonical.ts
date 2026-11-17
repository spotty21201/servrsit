/**
 * Canonical JSON and digests (Technical Spec §8.2: "Canonicalize the manifest
 * with one tested serialization specification").
 *
 * Rules: object keys sorted by UTF-16 code unit order, recursively; arrays keep
 * their order; no whitespace; only JSON values. `undefined`, functions,
 * symbols, bigint, NaN and Infinity are rejected rather than silently dropped,
 * so two different inputs can never canonicalize to the same text.
 */

import { createHash } from "node:crypto";

export class CanonicalizationError extends Error {
  constructor(path: string, what: string) {
    super(`cannot canonicalize ${what} at ${path}`);
    this.name = "CanonicalizationError";
  }
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalizationError(path, "a non-finite number");
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v, i) => encode(v, `${path}[${i}]`)).join(",")}]`;
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalizationError(path, "a non-plain object");
      }
      const entries = Object.keys(value as Record<string, unknown>).sort();
      const parts: string[] = [];
      for (const key of entries) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) throw new CanonicalizationError(`${path}.${key}`, "undefined");
        parts.push(`${JSON.stringify(key)}:${encode(v, `${path}.${key}`)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new CanonicalizationError(path, `a ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** "sha256:<hex>" of the canonical JSON. */
export function digestOf(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}
