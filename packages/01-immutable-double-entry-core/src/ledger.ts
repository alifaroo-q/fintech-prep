import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { entries, transactions } from './schema.ts';

export type Db = NodePgDatabase;

export type Leg = { accountId: string; direction: 'debit' | 'credit'; amount: bigint };

// Deliberately no balance check here: the database is the single enforcer, and the
// tests prove it by sending unbalanced postings straight through this function.
export async function postTransaction(
  db: Db,
  input: { description: string; effectiveAt: Date; legs: Leg[] },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [header] = await tx
      .insert(transactions)
      .values({ description: input.description, effectiveAt: input.effectiveAt })
      .returning({ id: transactions.id });
    await tx.insert(entries).values(input.legs.map((leg) => ({ ...leg, transactionId: header.id })));
    return header.id;
  });
}

// Debits minus credits. Positive is the normal side for asset/expense accounts;
// liability/equity/revenue accounts normally read negative.
export async function balanceOf(db: Db, accountId: string, asOf?: Date): Promise<bigint> {
  const asOfFilter = asOf ? sql`and ${transactions.effectiveAt} <= ${asOf}` : sql``;
  const [row] = await db.execute<{ balance: string }>(sql`
    select coalesce(sum(case ${entries.direction} when 'debit' then ${entries.amount} else -${entries.amount} end), 0) as balance
      from ${entries} join ${transactions} on ${eq(transactions.id, entries.transactionId)}
     where ${eq(entries.accountId, accountId)} ${asOfFilter}`).then((r) => r.rows);
  return BigInt(row.balance);
}
