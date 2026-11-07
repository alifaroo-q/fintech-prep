# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

`README.md` has the module overview and `MODULES.md` has each module's primitives and exercise prompt. Only `packages/01-immutable-double-entry-core` exists so far. It is a pnpm workspace, and Postgres 18 runs from the root `docker-compose.yml` on `127.0.0.1:54329`.

```bash
pnpm install
pnpm db:up                                   # docker compose up -d --wait
pnpm test                                    # every package, one at a time (they share one DB)
pnpm --filter ./packages/01-* test           # one package
pnpm --filter ./packages/01-* typecheck
pnpm --filter ./packages/01-* db:generate    # drizzle-kit: SQL from src/schema.ts
```

Vitest `globalSetup` drops and recreates the `public` schema, then runs `drizzle/` migrations. Do not point `DATABASE_URL` at a database you want to keep. Triggers live in hand-written custom migrations (`drizzle-kit generate --custom`), because drizzle-kit cannot express them.

## What this is

A learning monorepo: six progressive packages under `packages/NN-<name>/`, each exploring one fintech primitive. Each `MODULES.md` exercise is phrased as "teach me / walk me through", so explain the concept before (or alongside) writing code for a module.

Stack: Node.js + TypeScript, PostgreSQL via Drizzle ORM (node-postgres driver), Vitest, and fast-check. Integration tests run against the docker-compose Postgres, not Testcontainers.

## How the modules connect

- **01 double-entry core** is the foundation: `accounts`, `transactions`, `entries`. Later modules build on its ledger.
- **02 idempotency/outbox**: payment requests keyed by `(idempotency_key, caller_id, request_hash)`; outbox worker polls with `FOR UPDATE SKIP LOCKED`.
- **03 reconciliation**: matches internal ledger ↔ processor charge ↔ bank deposit (exact ID first, then timestamp window + minor-unit amount); unmatched rows go to a `reconciliation_breaks` table.
- **04 card authorization**: holds placed with `SELECT ... FOR UPDATE` and a TTL, later captured or expired into the ledger.
- **05 multi-currency FX**: cross-currency postings balance through an FX suspense/clearing account.
- **06 chaos fuzzer** attacks module 01's ledger with fast-check: concurrent transfers, negative amounts, out-of-order execution, dropped DB connections. Its check is assets = liabilities + equity after every cycle.

## Invariants every package must keep

- Money is integer minor units. Never use JS `number` floats for amounts; round with banker's rounding (half to even).
- Ledger entries are append-only: no `UPDATE`/`DELETE`; corrections are balancing reversals.
- A transaction has ≥ 2 postings, and debits − credits = 0, enforced inside the same DB transaction (Postgres constraint trigger), not only in application code.
- Entries are bi-temporal: effective time and recorded time are separate columns. In module 01 both sit on the `transactions` header, and every entry inherits them.
- Prove concurrency invariants with tests against real Postgres (docker compose), not mocks.
- Drizzle wraps driver errors: the Postgres SQLSTATE is on `err.cause.code`, not `err.code`.
