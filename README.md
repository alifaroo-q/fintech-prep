# Fintech Foundations: Core Financial Systems Monorepo

A progressive exploration of core financial engineering primitives, transaction invariants, 
and deterministic verification systems.

## Modules

| # | Package | Core Concept | Key Invariant |
|---|---|---|---|
| 01 | `packages/01-immutable-double-entry-core` | Double-Entry & Postings | $\sum \text{Debits} - \sum \text{Credits} = 0$ |
| 02 | `packages/02-idempotent-webhook-outbox` | Idempotency & Outbox | Exactly-once event side-effects |
| 03 | `packages/03-settlement-reconciliation-engine` | 3-Way Reconciliation | Every settled cent matches bank deposits |
| 04 | `packages/04-realtime-card-authorization` | Two-Phase Balance Holds | Available = Book Balance - Active Holds |
| 05 | `packages/05-multi-currency-fx-split` | FX & Banker's Rounding | Zero-drift integer minor units |
| 06 | `packages/06-adversarial-chaos-fuzzer` | Property-Based Verification | Invariants hold under race conditions |

Module 01 has a visual explainer: [docs/01-ledger-double-entry.html](docs/01-ledger-double-entry.html). Open it in a browser.

## Tech Stack
- **Runtime:** Node.js / TypeScript
- **Database:** PostgreSQL 18 via `docker-compose.yml` (integration tests run against it)
- **Data Modeling:** Drizzle ORM
- **Testing:** Vitest & fast-check
