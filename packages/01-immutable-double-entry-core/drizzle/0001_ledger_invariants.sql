-- Sum-to-zero: checked at COMMIT (deferred), so the legs of a transaction can be
-- inserted in any order and in separate statements. One function serves both tables:
-- the transactions trigger catches a header with no entries, which the entries trigger never sees.
-- shortcut: fires once per entry row (O(n^2) per transaction), fine for small postings; dedupe per transaction if postings get large.
CREATE FUNCTION assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  tx_id uuid;
  leg_count bigint;
  net numeric;
BEGIN
  -- Separate statements, not a CASE: plpgsql resolves every NEW field in an expression.
  IF TG_TABLE_NAME = 'entries' THEN
    tx_id := NEW.transaction_id;
  ELSE
    tx_id := NEW.id;
  END IF;

  SELECT count(*), coalesce(sum(CASE direction WHEN 'debit' THEN amount ELSE -amount END), 0)
    INTO leg_count, net
    FROM entries
   WHERE transaction_id = tx_id;

  IF leg_count < 2 OR net <> 0 THEN
    RAISE EXCEPTION 'transaction % is unbalanced: % entries, debits - credits = %', tx_id, leg_count, net
      USING ERRCODE = 'LG001';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT ON entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER transactions_balanced
  AFTER INSERT ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();
--> statement-breakpoint
-- Append-only: corrections are new reversing transactions, never edits.
CREATE FUNCTION reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden: the ledger is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'LG002';
END $$;
--> statement-breakpoint
CREATE TRIGGER entries_append_only BEFORE UPDATE OR DELETE ON entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER entries_no_truncate BEFORE TRUNCATE ON entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER transactions_append_only BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER transactions_no_truncate BEFORE TRUNCATE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION reject_ledger_mutation();
