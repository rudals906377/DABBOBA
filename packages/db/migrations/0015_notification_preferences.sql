CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  exchange_updates boolean NOT NULL DEFAULT true,
  request_updates boolean NOT NULL DEFAULT true,
  restock_updates boolean NOT NULL DEFAULT false,
  marketing_sms boolean NOT NULL DEFAULT false,
  marketing_email boolean NOT NULL DEFAULT false,
  marketing_push boolean NOT NULL DEFAULT false,
  personalized_recommendations boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER notification_preferences_set_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notification_preference_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('INITIALIZED','UPDATED')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key varchar(200),
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version),
  UNIQUE (user_id, idempotency_key),
  CHECK (
    (event_type = 'INITIALIZED'
      AND before_state IS NULL
      AND actor_user_id IS NULL
      AND idempotency_key IS NULL
      AND request_id IS NULL)
    OR
    (event_type = 'UPDATED'
      AND before_state IS NOT NULL
      AND actor_user_id = user_id
      AND idempotency_key IS NOT NULL
      AND request_id IS NOT NULL)
  )
);
CREATE INDEX notification_preference_events_user_idx
ON notification_preference_events (user_id, created_at DESC, id DESC);
CREATE TRIGGER notification_preference_events_immutable
BEFORE UPDATE OR DELETE ON notification_preference_events
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE OR REPLACE FUNCTION default_notification_preference_state(preference_version integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'orderUpdates', true,
    'exchangeUpdates', true,
    'requestUpdates', true,
    'restockUpdates', false,
    'marketingSms', false,
    'marketingEmail', false,
    'marketingPush', false,
    'personalizedRecommendations', false,
    'version', preference_version
  );
$$;

CREATE OR REPLACE FUNCTION create_default_notification_preferences()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  initialized_version integer;
BEGIN
  IF NEW.role <> 'USER' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notification_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT DO NOTHING
  RETURNING version INTO initialized_version;

  IF initialized_version IS NOT NULL THEN
    INSERT INTO notification_preference_events(
      user_id,event_type,before_state,after_state,version
    ) VALUES(
      NEW.id,'INITIALIZED',NULL,
      default_notification_preference_state(initialized_version),
      initialized_version
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_default_notification_preferences
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_notification_preferences();

WITH inserted AS (
  INSERT INTO notification_preferences (user_id)
  SELECT id FROM users WHERE role='USER'
  ON CONFLICT DO NOTHING
  RETURNING user_id,version
)
INSERT INTO notification_preference_events(
  user_id,event_type,before_state,after_state,version
)
SELECT
  user_id,'INITIALIZED',NULL,
  default_notification_preference_state(version),
  version
FROM inserted
ON CONFLICT (user_id,version) DO NOTHING;

INSERT INTO notification_preference_events(
  user_id,event_type,before_state,after_state,version
)
SELECT
  p.user_id,'INITIALIZED',NULL,
  default_notification_preference_state(p.version),
  p.version
FROM notification_preferences p
JOIN users u ON u.id=p.user_id AND u.role='USER'
WHERE NOT EXISTS (
  SELECT 1 FROM notification_preference_events e
  WHERE e.user_id=p.user_id AND e.version=p.version
)
ON CONFLICT (user_id,version) DO NOTHING;
