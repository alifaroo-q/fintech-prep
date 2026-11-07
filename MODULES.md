### Root Repository Architecture

```text
fintech-foundations/
├── README.md
├── packages/
│   ├── 01-immutable-double-entry-core/
│   ├── 02-idempotent-webhook-outbox/
│   ├── 03-settlement-reconciliation-engine/
│   ├── 04-realtime-card-authorization/
│   ├── 05-multi-currency-fx-split/
│   └── 06-adversarial-chaos-fuzzer/

```

---

### Project 1: Immutable Double-Entry Core & Materialized Balances

* **Sub-project Folder:** `packages/01-immutable-double-entry-core`
* **Core Fintech Primitives:**
* Chart of Accounts (Assets, Liabilities, Equity, Revenue, Expense).
* Transaction Atomicity: A transaction consists of $\ge 2$ postings.
* Invariant: Total debits equal total credits ($\sum \text{debits} - \sum \text{credits} = 0$) inside the same database transaction.
* Append-only ledger: Zero `UPDATE` or `DELETE` operations on ledger lines; corrections via balancing reversals only.
* Bi-temporality: Effective time (when the real-world event happened) vs. recorded time (when the system recorded it).


* **AI Agent Prompt / Exercise:**
> *"Act as a Principal Fintech Database Architect. First, explain the difference between a mutable balance column and a balance derived from append-only postings. Then, design a PostgreSQL schema using Drizzle ORM containing `accounts`, `transactions`, and `entries`. Enforce the sum-to-zero invariant using a PostgreSQL constraint trigger. Finally, generate a test suite that attempts concurrent unbalanced writes to prove they roll back."*



---

### Project 2: Distributed Idempotency Key & Transactional Outbox

* **Sub-project Folder:** `packages/02-idempotent-webhook-outbox`
* **Core Fintech Primitives:**
* At-least-once external delivery vs. exactly-once internal execution.
* The Stripe/Modern Treasury Idempotency Protocol: `(idempotency_key, caller_id, request_hash)`.
* Atomic request lifecycle: In-flight locking $\rightarrow$ execution $\rightarrow$ response caching $\rightarrow$ 409 conflict handling for mismatched payloads.
* Transactional Outbox Pattern: Guaranteeing that when a payment row is inserted, a downstream domain event is reliably emitted to Kafka/BullMQ without dual-write failure.


* **AI Agent Prompt / Exercise:**
> *"Teach me why HTTP retries create duplicate payouts if not guarded at the database level. Walk me through building an Express/NestJS middleware that intercepts payment requests, acquires an atomic lock in Redis/PostgreSQL, caches the response payload, and returns 409 if a client reuses an idempotency key with a modified body. Concurrently, have the agent write an Outbox worker that polls pending events with `FOR UPDATE SKIP LOCKED`."*



---

### Project 3: Automated Multi-Way Settlement Reconciliation Engine

* **Sub-project Folder:** `packages/03-settlement-reconciliation-engine`
* **Core Fintech Primitives:**
* Internal ledger entries vs. external gateway reports vs. bank settlement statements (CAMT.053 / BAI2 / CSV).
* 3-Way Matching: Internal Order ID $\leftrightarrow$ Processor Charge ID $\leftrightarrow$ Bank Batch Settlement Deposit.
* Reconciliation Breaks: Identifying missing payouts, fee discrepancies, rolling reserves, and chargebacks.


* **AI Agent Prompt / Exercise:**
> *"Simulate a real-world bank settlement scenario. Generate two mock datasets: (1) internal ledger transactions with fees and (2) a Stripe daily settlement CSV containing grouped payouts, processing fees, and chargeback holds. Write a reconciliation pipeline that matches items using a multi-pass heuristic (Exact ID $\rightarrow$ Timestamp window + Minor-unit amount). Have the AI explain how to isolate unmatched records into a `reconciliation_breaks` audit table."*



---

### Project 4: Sub-100ms Card Authorization & Balance Holds

* **Sub-project Folder:** `packages/04-realtime-card-authorization`
* **Core Fintech Primitives:**
* Two-Phase Money Movement: Authorization (Hold) vs. Settlement (Capture) vs. Expiration/Void.
* Ledger Account States: `Available Balance = Current Balance - Active Holds`.
* Hot-Account Concurrency: Handling high-frequency card swipes on a single pooled merchant/user balance without deadlocks.


* **AI Agent Prompt / Exercise:**
> *"Walk me through the ISO 8583 / card network lifecycle from authorization request to clearing. Guide me to build a high-throughput endpoint that receives an authorization webhook (e.g., Lithic/Stripe Issuing style), checks available funds using pessimistic locking (`SELECT ... FOR UPDATE`), places a temporary hold with a TTL, and later captures or expires the hold back to the main ledger."*



---

### Project 5: Multi-Currency Ledger with FX Slippage & Rounding

* **Sub-project Folder:** `packages/05-multi-currency-fx-split`
* **Core Fintech Primitives:**
* Minor Units (Cents/Paisa) and preventing IEEE 754 floating-point contamination.
* Currency Conversion balancing: Handling odd splits and half-cent rounding errors using Banker's Rounding (Round Half to Even).
* FX Gain/Loss Accounts: Balancing debits in Currency A against credits in Currency B via a centralized FX clearing ledger account.


* **AI Agent Prompt / Exercise:**
> *"Explain why standard floating point numbers (`number` in JS) are catastrophic for financial arithmetic. Show me how to model a cross-border payment where a user pays 10,000 PKR to purchase an item costing 35.50 USD. Have the agent scaffold the ledger entries that balance the currency exchange using an intermediate FX suspense account and compute exact platform margin down to integer minor units."*



---

### Project 6: Adversarial Invariant Fuzzer & Chaos Harness

* **Sub-project Folder:** `packages/06-adversarial-chaos-fuzzer`
* **Core Fintech Primitives:**
* Property-Based Testing (using `fast-check` in TypeScript).
* Race Condition Injection: Fuzzing ledger endpoints with 50 parallel asynchronous transfers across identical accounts.
* Network Partition Simulation: Simulating database connection drops midway through multi-entry postings to verify zero partial writes occur.


* **AI Agent Prompt / Exercise:**
> *"Act as an adversarial financial auditor trying to break my ledger in Project 1. Write a `fast-check` property test suite that generates random concurrent transactions, negative amounts, out-of-order execution, and simulated database errors. Run the fuzzer to verify that $\sum \text{assets} = \sum \text{liabilities} + \sum \text{equity}$ holds true after every cycle."*
