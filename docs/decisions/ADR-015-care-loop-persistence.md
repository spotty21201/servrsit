# ADR-015 — Care-loop persistence: SQLite (node:sqlite) behind a repository interface

| Field | Value |
|---|---|
| **Date** | 2026-11-17 |
| **Owner** | Coder |
| **Status** | [AGENT DECISION] — Adopted for the local build (ADR-014). Orchestrator to index in `decision-log.md`. |
| **Requirements** | Technical Spec §3.1 (PostgreSQL 17), §9, §11, §12; T-048 |

## Decision

The care loop (plans, approvals, operations, events, dispatch outbox) is stored through a repository interface, `CareStore`, in a new package `packages/store`. The first implementation is `SqliteCareStore` on **Node's built-in `node:sqlite`** (SQLite 3.54.1 in Node 24.22.3).

## Why not PostgreSQL now

The spec selects PostgreSQL 17. On Merauke, checked 2026-11-17: no PostgreSQL binaries on `PATH`, no `/usr/lib/postgresql`, nothing listening on 5432, and the `postgresql` service is inactive. Installing a database server needs `sudo`, which this agent does not use. ADR-014 keeps everything local on Merauke for now.

## Why built-in SQLite

- **No native dependency:** `better-sqlite3` and similar need a build script, which the workspace's pnpm build-script policy blocks.
- **Transactions:** `BEGIN IMMEDIATE` makes approval, operation, event and outbox one all-or-nothing write.
- **Database-level guards that hold even if application code is wrong**, all tested by attacking the file through a second, independent connection:
  - triggers make plans, approvals and operation events immutable and append-only
  - a trigger stops a final operation state from changing
  - a partial unique index allows at most one unresolved operation per server
  - unique constraints allow one approval per plan version and one outbox entry per operation
- `STRICT` tables and `CHECK` constraints on state and target kind.

## Consequences

- **Replaceable:** a `PostgresCareStore` must pass the same `store.test.ts` contract tests. The schema maps directly: partial unique index, triggers, `BEGIN` / `SERIALIZABLE`.
- **Single process:** SQLite allows one writer at a time. That fits one owner on one host. It is **not** a design for several API or worker processes on different machines.
- **`node:sqlite` stability is unverified.** On Node 24.22.3 it loads without an `ExperimentalWarning`, but I could not read its documented stability index offline (no local docs, no web access in this session). Check it before relying on it beyond the local build, and again at the next Node upgrade (ADR-008).
- **New package `packages/store`:** it is not in the steering's repository map. Dependency direction: `contracts <- domain <- store <- worker, api`. `packages/domain` stays free of I/O.
- **Intent records are not off-instance.** Technical Spec §9.2 writes them to private S3 with a conditional create. Locally, `FileIntentStore` writes exclusive-create (`wx`), mode 0600 files in a separate directory. This gives the same write-once contract, but **not** the protection against losing the controller's disk. Replace with S3 before any AWS deployment (T-049).
- **Manifest signing is simulated.** Ed25519 from `node:crypto` stands in for the KMS RSA-PSS key (§8.2). Only `Signer` changes when KMS arrives.
