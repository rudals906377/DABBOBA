-- Bind Expo push tokens to one authenticated app installation and persist
-- delivery tickets so the finite worker can resume safely after restarts.

CREATE TABLE public.push_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  expo_push_token varchar(256) NOT NULL,
  platform text NOT NULL CHECK (platform IN ('IOS','ANDROID')),
  app_version varchar(40),
  disabled_at timestamptz,
  disabled_reason varchar(80),
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, installation_id),
  CHECK (
    length(expo_push_token) BETWEEN 24 AND 256
    AND expo_push_token !~ '[[:space:]]'
    AND (
      (expo_push_token LIKE 'ExpoPushToken[%]' AND right(expo_push_token, 1) = ']')
      OR
      (expo_push_token LIKE 'ExponentPushToken[%]' AND right(expo_push_token, 1) = ']')
    )
  ),
  CHECK (
    (disabled_at IS NULL AND disabled_reason IS NULL)
    OR
    (disabled_at IS NOT NULL AND disabled_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX push_device_tokens_active_installation_idx
ON public.push_device_tokens (installation_id)
WHERE disabled_at IS NULL;

CREATE UNIQUE INDEX push_device_tokens_active_expo_token_idx
ON public.push_device_tokens (expo_push_token)
WHERE disabled_at IS NULL;

CREATE INDEX push_device_tokens_active_user_idx
ON public.push_device_tokens (user_id, last_registered_at DESC, id DESC)
WHERE disabled_at IS NULL;

CREATE INDEX push_device_tokens_session_idx
ON public.push_device_tokens (session_id)
WHERE disabled_at IS NULL;

CREATE TRIGGER push_device_tokens_set_updated_at
BEFORE UPDATE ON public.push_device_tokens
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.push_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  push_device_token_id uuid NOT NULL REFERENCES public.push_device_tokens(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING','SENDING','TICKETED','DELIVERED','FAILED','INVALID'
  )),
  expo_ticket_id varchar(120),
  send_attempt_count integer NOT NULL DEFAULT 0 CHECK (send_attempt_count BETWEEN 0 AND 8),
  receipt_attempt_count integer NOT NULL DEFAULT 0 CHECK (receipt_attempt_count BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  last_error_code varchar(80),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, push_device_token_id),
  CHECK (
    (status = 'TICKETED' AND expo_ticket_id IS NOT NULL AND completed_at IS NULL)
    OR
    (status IN ('DELIVERED','FAILED','INVALID') AND completed_at IS NOT NULL)
    OR
    (status IN ('PENDING','SENDING') AND expo_ticket_id IS NULL AND completed_at IS NULL)
  )
);

CREATE UNIQUE INDEX push_notification_deliveries_ticket_idx
ON public.push_notification_deliveries (expo_ticket_id)
WHERE expo_ticket_id IS NOT NULL;

CREATE INDEX push_notification_deliveries_pending_idx
ON public.push_notification_deliveries (next_attempt_at, id)
WHERE status IN ('PENDING','SENDING','TICKETED');

CREATE TRIGGER push_notification_deliveries_set_updated_at
BEFORE UPDATE ON public.push_notification_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notification_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.push_device_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.push_notification_deliveries FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.push_device_tokens TO dabboba_runtime;
GRANT SELECT, UPDATE, DELETE ON TABLE public.push_device_tokens TO dabboba_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.push_notification_deliveries TO dabboba_worker;
GRANT SELECT (id,user_id,session_kind,revoked_at,expires_at)
ON TABLE public.sessions TO dabboba_worker;

COMMENT ON TABLE public.push_device_tokens IS
  'Server-only Expo push tokens bound to one user session and one app installation.';
COMMENT ON TABLE public.push_notification_deliveries IS
  'Durable Expo ticket and receipt state; raw push tokens must never be copied into logs or notification payloads.';
