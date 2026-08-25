CREATE OR REPLACE FUNCTION guard_approved_account_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-mutation:' || NEW.actor_id::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM account_deletion_requests
    WHERE user_id = NEW.actor_id
      AND status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'approved account deletion blocks new mutations'
      USING ERRCODE = '23514',
            CONSTRAINT = 'account_deletion_approved_mutation_guard';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS idempotency_keys_account_deletion_guard ON idempotency_keys;

CREATE TRIGGER idempotency_keys_account_deletion_guard
BEFORE INSERT ON idempotency_keys
FOR EACH ROW
EXECUTE FUNCTION guard_approved_account_mutation();
