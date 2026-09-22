INSERT INTO admin_permissions (code, description) VALUES
  ('account_deletions.read', 'Read account deletion review queues and durable history'),
  ('account_deletions.review', 'Approve or reject account deletion requests without deleting user data')
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code) VALUES
  ('ADMIN','account_deletions.read'),
  ('ADMIN','account_deletions.review'),
  ('SUPER_ADMIN','account_deletions.read'),
  ('SUPER_ADMIN','account_deletions.review')
ON CONFLICT DO NOTHING;

ALTER TABLE account_deletion_requests
ADD COLUMN decided_by_admin_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE account_deletion_requests
ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE account_deletion_requests
ADD CONSTRAINT account_deletion_requests_admin_decision_check
CHECK (
  status NOT IN ('APPROVED','REJECTED','COMPLETED')
  OR (
    decided_at IS NOT NULL
    AND decided_by_admin_id IS NOT NULL
    AND decision_reason IS NOT NULL
    AND char_length(decision_reason) BETWEEN 2 AND 1000
  )
) NOT VALID;

ALTER TABLE account_deletion_request_events
ADD COLUMN admin_actor_id uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE account_deletion_request_events
ADD COLUMN reason text;

ALTER TABLE account_deletion_request_events
ADD CONSTRAINT account_deletion_request_events_admin_decision_check
CHECK (
  event_type <> 'STATUS_CHANGED'
  OR (admin_actor_id IS NOT NULL AND reason IS NOT NULL AND char_length(reason) BETWEEN 2 AND 1000)
) NOT VALID;

CREATE INDEX account_deletion_request_events_admin_idx
ON account_deletion_request_events (admin_actor_id, created_at DESC, id DESC)
WHERE admin_actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_account_deletion_request_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('BLOCKED','APPROVED','REJECTED','CANCELLED'))
    OR (OLD.status = 'BLOCKED' AND NEW.status IN ('PENDING_REVIEW','APPROVED','REJECTED','CANCELLED'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'Invalid account deletion request transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER account_deletion_requests_transition_guard
BEFORE UPDATE OF status ON account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION enforce_account_deletion_request_transition();
