import { sql } from 'drizzle-orm';
import { bigint, check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense']);
export const direction = pgEnum('direction', ['debit', 'credit']);

// Single-currency by design; module 05 adds per-currency balancing.
// No balance column: balance is always SUM(entries). See src/ledger.ts.
export const accounts = pgTable('accounts', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  code: text().notNull().unique(),
  name: text().notNull(),
  type: accountType().notNull(),
});

// Both time axes live on the header: every entry of a transaction shares them, and a
// per-entry copy would let legs of one atomic event disagree about when it happened.
export const transactions = pgTable('transactions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  description: text().notNull(),
  effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  reversesTransactionId: uuid('reverses_transaction_id').unique().references((): any => transactions.id),
});

export const entries = pgTable(
  'entries',
  {
    id: bigint({ mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: uuid('transaction_id').notNull().references(() => transactions.id),
    accountId: uuid('account_id').notNull().references(() => accounts.id),
    direction: direction().notNull(),
    // Integer minor units; sign lives in `direction`, so amount is always positive.
    amount: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    check('entries_amount_positive', sql`${t.amount} > 0`),
    index('entries_transaction_id_idx').on(t.transactionId),
    index('entries_account_id_idx').on(t.accountId),
  ],
);
