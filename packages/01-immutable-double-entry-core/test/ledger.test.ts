import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, test } from 'vitest';
import { balanceOf, postTransaction, type Leg } from '../src/ledger.ts';
import { accounts, entries, transactions } from '../src/schema.ts';
import { DATABASE_URL } from './db.ts';

const CONCURRENCY = 20;
// One connection per in-flight transaction, or the barrier deadlocks waiting on the pool.
const pool = new Pool({ connectionString: DATABASE_URL, max: CONCURRENCY + 5 });
const db = drizzle({ client: pool });
afterAll(() => pool.end());

const UNBALANCED = 'LG001';
const APPEND_ONLY = 'LG002';
const CHECK_VIOLATION = '23514';

// Drizzle wraps driver errors; raw pg errors carry the code directly.
const pgCode = (err: any): string | undefined => err?.cause?.code ?? err?.code;
const rejectsWith = async (promise: Promise<unknown>, code: string) =>
  expect(await promise.then(() => 'committed', pgCode)).toBe(code);

async function openAccounts() {
  const suffix = randomUUID();
  const [cash, revenue] = await db
    .insert(accounts)
    .values([
      { code: `cash-${suffix}`, name: 'Cash', type: 'asset' },
      { code: `revenue-${suffix}`, name: 'Revenue', type: 'revenue' },
    ])
    .returning();
  return { cash: cash.id, revenue: revenue.id };
}
type Accounts = Awaited<ReturnType<typeof openAccounts>>;

const debit = (accountId: string, amount: bigint): Leg => ({ accountId, direction: 'debit', amount });
const credit = (accountId: string, amount: bigint): Leg => ({ accountId, direction: 'credit', amount });

async function rowsFor(txId: string) {
  const [{ headers }] = await db.select({ headers: sql<number>`count(*)::int` }).from(transactions).where(eq(transactions.id, txId));
  const [{ legs }] = await db.select({ legs: sql<number>`count(*)::int` }).from(entries).where(eq(entries.transactionId, txId));
  return { headers, legs };
}

// Rolls back anything left open so one failed assertion cannot leave locks that hang later tests.
async function withClients<T>(n: number, fn: (...clients: PoolClient[]) => Promise<T>): Promise<T> {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  try {
    return await fn(...clients);
  } finally {
    for (const c of clients) await c.query('rollback').finally(() => c.release());
  }
}

// Opens a DB transaction on its own connection and writes a header, leaving COMMIT to the caller.
async function beginPosting(client: PoolClient, description: string, legs: Leg[], txId: string = randomUUID()) {
  const tx = drizzle({ client });
  await client.query('begin');
  await tx.insert(transactions).values({ id: txId, description, effectiveAt: new Date() });
  if (legs.length) await tx.insert(entries).values(legs.map((leg) => ({ ...leg, transactionId: txId })));
  return txId;
}

// Resolves once `parties` callers have arrived, so every transaction is in flight before any commits.
function barrier(parties: number, timeoutMs = 5_000) {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => (release = resolve));
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`barrier timed out: ${arrived}/${parties} arrived`)), timeoutMs).unref(),
  );
  return () => {
    if (++arrived === parties) release();
    return Promise.race([allArrived, timeout]);
  };
}

describe('balanced postings', () => {
  test('commit, and balances are derived from entries', async () => {
    const { cash, revenue } = await openAccounts();
    await postTransaction(db, { description: 'sale', effectiveAt: new Date(), legs: [debit(cash, 1000n), credit(revenue, 1000n)] });

    expect(await balanceOf(db, cash)).toBe(1000n);
    expect(await balanceOf(db, revenue)).toBe(-1000n);
  });

  test('the check is deferred to COMMIT, so legs can arrive in separate statements', async () => {
    const { cash, revenue } = await openAccounts();
    await withClients(1, async (client) => {
      const txId = await beginPosting(client, 'split statements', [debit(cash, 700n)]);
      // Unbalanced right now; a non-deferred trigger would already have thrown.
      await drizzle({ client }).insert(entries).values({ ...credit(revenue, 700n), transactionId: txId });
      await client.query('commit');
      expect(await rowsFor(txId)).toEqual({ headers: 1, legs: 2 });
    });
  });

  test('balance can be read as of an effective time', async () => {
    const { cash, revenue } = await openAccounts();
    const yesterday = new Date(Date.now() - 86_400_000);
    await postTransaction(db, { description: 'old sale', effectiveAt: yesterday, legs: [debit(cash, 300n), credit(revenue, 300n)] });
    await postTransaction(db, { description: 'new sale', effectiveAt: new Date(), legs: [debit(cash, 50n), credit(revenue, 50n)] });

    expect(await balanceOf(db, cash, new Date(yesterday.getTime() + 1))).toBe(300n);
    expect(await balanceOf(db, cash)).toBe(350n);
  });
});

describe('unbalanced postings roll back', () => {
  test('every statement succeeds, COMMIT fails, and no row survives', async () => {
    const { cash, revenue } = await openAccounts();
    await withClients(1, async (client) => {
      const txId = await beginPosting(client, 'off by a cent', [debit(cash, 1000n), credit(revenue, 999n)]);
      await rejectsWith(client.query('commit'), UNBALANCED);
      expect(await rowsFor(txId)).toEqual({ headers: 0, legs: 0 });
    });
  });

  test.each([
    ['debits exceed credits', (a: Accounts) => [debit(a.cash, 1000n), credit(a.revenue, 999n)]],
    ['a single leg', (a: Accounts) => [debit(a.cash, 1000n)]],
    ['two debits', (a: Accounts) => [debit(a.cash, 500n), debit(a.revenue, 500n)]],
    ['no legs at all', () => []],
  ])('rejects %s', async (_, legsFor) => {
    const a = await openAccounts();
    await withClients(1, async (client) => {
      const txId = await beginPosting(client, 'bad', legsFor(a));
      await rejectsWith(client.query('commit'), UNBALANCED);
      expect(await rowsFor(txId)).toEqual({ headers: 0, legs: 0 });
    });
  });

  test('through postTransaction too, since the app layer does not check', async () => {
    const { cash, revenue } = await openAccounts();
    await rejectsWith(
      postTransaction(db, { description: 'bad', effectiveAt: new Date(), legs: [debit(cash, 10n), credit(revenue, 9n)] }),
      UNBALANCED,
    );
    expect(await balanceOf(db, cash)).toBe(0n);
  });

  test.each([0n, -100n])('rejects amount %s at INSERT', async (amount) => {
    const { cash, revenue } = await openAccounts();
    await rejectsWith(
      postTransaction(db, { description: 'bad amount', effectiveAt: new Date(), legs: [debit(cash, amount), credit(revenue, amount)] }),
      CHECK_VIOLATION,
    );
  });
});

describe('concurrent unbalanced writes', () => {
  test(`${CONCURRENCY} interleaved transactions on the same accounts: only the balanced ones commit`, async () => {
    const { cash, revenue } = await openAccounts();
    const tag = `race-${randomUUID()}`;
    const arrive = barrier(CONCURRENCY);
    const unbalanced = [
      () => [debit(cash, 100n), credit(revenue, 99n)],
      () => [debit(cash, 100n)],
      () => [debit(cash, 100n), debit(revenue, 100n)],
    ];

    const outcomes = await withClients(CONCURRENCY, (...clients) =>
      Promise.all(
        clients.map(async (client, i) => {
          const balanced = i % 2 === 0;
          const legs = balanced ? [debit(cash, 100n), credit(revenue, 100n)] : unbalanced[i % unbalanced.length]();
          await beginPosting(client, `${tag}-${i}`, legs);
          await arrive();
          return { i, balanced, outcome: await client.query('commit').then(() => 'committed', pgCode) };
        }),
      ),
    );

    for (const { balanced, outcome } of outcomes) expect(outcome).toBe(balanced ? 'committed' : UNBALANCED);

    const committed = await db
      .select({ description: transactions.description })
      .from(transactions)
      .where(sql`${transactions.description} like ${tag + '-%'}`);
    const expected = outcomes.filter((o) => o.balanced).map((o) => `${tag}-${o.i}`);
    expect(committed.map((t) => t.description).sort()).toEqual(expected.sort());

    expect(await balanceOf(db, cash)).toBe(100n * BigInt(expected.length));
    expect(await balanceOf(db, revenue)).toBe(-100n * BigInt(expected.length));
    const [{ net }] = await db
      .select({ net: sql<string>`coalesce(sum(case ${entries.direction} when 'debit' then ${entries.amount} else -${entries.amount} end), 0)` })
      .from(entries);
    expect(BigInt(net)).toBe(0n);
  });

  test('two sessions cannot each write half of one transaction', async () => {
    const { cash, revenue } = await openAccounts();
    await withClients(2, async (a, b) => {
      const txId = await beginPosting(a, 'half from A', [debit(cash, 500n)]);
      await b.query('begin');
      // B cannot see A's uncommitted header; whether this blocks or fails, it must not help A balance.
      const bInsert = drizzle({ client: b })
        .insert(entries)
        .values({ ...credit(revenue, 500n), transactionId: txId })
        .then(() => 'inserted', pgCode);

      await rejectsWith(a.query('commit'), UNBALANCED);
      const bOutcome = await bInsert;
      const bCommit = await b.query('commit').then((r) => r.command, pgCode);

      expect([bOutcome, bCommit]).not.toEqual(['inserted', 'COMMIT']);
      expect(await rowsFor(txId)).toEqual({ headers: 0, legs: 0 });
      expect(await balanceOf(db, revenue)).toBe(0n);
    });
  });
});

describe('append-only', () => {
  test('UPDATE and DELETE on posted rows are rejected', async () => {
    const { cash, revenue } = await openAccounts();
    const txId = await postTransaction(db, { description: 'sale', effectiveAt: new Date(), legs: [debit(cash, 10n), credit(revenue, 10n)] });

    await rejectsWith(db.update(entries).set({ amount: 1n }).where(eq(entries.transactionId, txId)), APPEND_ONLY);
    await rejectsWith(db.delete(entries).where(eq(entries.transactionId, txId)), APPEND_ONLY);
    await rejectsWith(db.update(transactions).set({ description: 'edited' }).where(eq(transactions.id, txId)), APPEND_ONLY);
    await rejectsWith(db.delete(transactions).where(eq(transactions.id, txId)), APPEND_ONLY);
    await rejectsWith(db.execute(sql`truncate ${entries}`), APPEND_ONLY);
  });
});
