ALTER TABLE media_assets
DROP CONSTRAINT media_assets_purpose_check;

ALTER TABLE media_assets
ADD CONSTRAINT media_assets_purpose_check
CHECK (purpose IN ('PROFILE','POST','COMMENT','INQUIRY','EXCHANGE','CATALOG_REQUEST','CATALOG','WANTED_REQUEST'));

ALTER TABLE wanted_requests
ADD COLUMN ip_name_ko varchar(160),
ADD COLUMN media_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT;

UPDATE wanted_requests w
SET ip_name_ko = i.name_ko
FROM catalog_ips i
WHERE i.id = w.ip_id;

ALTER TABLE wanted_requests
ALTER COLUMN ip_name_ko SET NOT NULL,
ALTER COLUMN ip_id DROP NOT NULL;

ALTER TABLE wanted_requests
ADD CONSTRAINT wanted_requests_ip_name_present_check
CHECK (length(btrim(ip_name_ko)) > 0);

CREATE INDEX wanted_requests_name_trgm_idx
ON wanted_requests USING gin (ip_name_ko gin_trgm_ops);

CREATE UNIQUE INDEX wanted_requests_media_idx
ON wanted_requests (media_id)
WHERE media_id IS NOT NULL;
