-- Keep per-user active upload quota checks index-backed. Expired PENDING_UPLOAD
-- rows are transitioned to REJECTED by the API while holding the same
-- user-scoped transaction advisory lock used to reserve new upload intents.
CREATE INDEX media_assets_owner_active_upload_idx
ON media_assets (owner_id, updated_at)
INCLUDE (byte_size)
WHERE status IN ('PENDING_UPLOAD','UPLOADED','PROCESSING');
