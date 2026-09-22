-- Store-review trust and safety support for every customer-created surface.
-- The mobile client never writes these tables directly; the authenticated API
-- records the exact operations-policy version before accepting the first UGC.

ALTER TABLE content_reports
DROP CONSTRAINT IF EXISTS content_reports_target_type_check;

ALTER TABLE content_reports
ADD CONSTRAINT content_reports_target_type_check
CHECK (target_type IN (
  'POST',
  'COMMENT',
  'SNAP',
  'USER',
  'EXCHANGE_LISTING',
  'WANTED_REQUEST'
));

ALTER TABLE moderation_actions
DROP CONSTRAINT IF EXISTS moderation_actions_action_check;

ALTER TABLE moderation_actions
ADD CONSTRAINT moderation_actions_action_check
CHECK (action IN (
  'NO_ACTION',
  'HIDE_POST',
  'HIDE_COMMENT',
  'HIDE_EXCHANGE_LISTING',
  'HIDE_WANTED_REQUEST',
  'RESTORE_POST',
  'RESTORE_COMMENT',
  'WARN_USER',
  'SUSPEND_USER'
));
