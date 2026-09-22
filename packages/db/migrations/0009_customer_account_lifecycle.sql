ALTER TABLE sessions
ADD COLUMN rotated_from_session_id uuid REFERENCES sessions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX sessions_rotation_lineage_idx
ON sessions (rotated_from_session_id)
WHERE rotated_from_session_id IS NOT NULL;

CREATE TABLE account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (
    status IN ('PENDING_REVIEW','BLOCKED','APPROVED','COMPLETED','REJECTED','CANCELLED')
  ),
  blocker_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(blocker_snapshot) = 'object'),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  completed_at timestamptz,
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK (completed_at IS NULL OR decided_at IS NOT NULL),
  UNIQUE (id, user_id)
);

CREATE UNIQUE INDEX account_deletion_requests_one_open_idx
ON account_deletion_requests (user_id)
WHERE status IN ('PENDING_REVIEW','BLOCKED','APPROVED');

CREATE INDEX account_deletion_requests_queue_idx
ON account_deletion_requests (status, last_requested_at, id);

CREATE TRIGGER account_deletion_requests_set_updated_at
BEFORE UPDATE ON account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE account_deletion_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deletion_request_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','REASSESSED','STATUS_CHANGED')),
  status text NOT NULL CHECK (
    status IN ('PENDING_REVIEW','BLOCKED','APPROVED','COMPLETED','REJECTED','CANCELLED')
  ),
  blocker_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(blocker_snapshot) = 'object'),
  revoked_session_count integer NOT NULL DEFAULT 0 CHECK (revoked_session_count >= 0),
  correlation_id text NOT NULL,
  idempotency_key varchar(200) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deletion_request_id, idempotency_key),
  FOREIGN KEY (deletion_request_id, user_id)
    REFERENCES account_deletion_requests(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX account_deletion_request_events_request_idx
ON account_deletion_request_events (deletion_request_id, created_at, id);

CREATE TRIGGER account_deletion_request_events_immutable
BEFORE UPDATE OR DELETE ON account_deletion_request_events
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
