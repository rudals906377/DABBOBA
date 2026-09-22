ALTER TABLE users
ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
ADD COLUMN phone_e164 varchar(16)
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

WITH safe_phone_identities AS (
  SELECT user_id, min(provider_subject) AS phone_e164
  FROM auth_identities
  WHERE provider = 'PHONE'
  GROUP BY user_id
  HAVING count(*) = 1
    AND min(provider_subject) ~ '^\+[1-9][0-9]{7,14}$'
)
UPDATE users u
SET phone_e164 = phone.phone_e164
FROM safe_phone_identities phone
WHERE u.id = phone.user_id
  AND u.phone_e164 IS NULL;

ALTER TABLE users
ADD CONSTRAINT users_phone_e164_key UNIQUE (phone_e164);

ALTER TABLE auth_identities
DROP CONSTRAINT auth_identities_provider_check;

ALTER TABLE auth_identities
ADD CONSTRAINT auth_identities_provider_check
CHECK (provider IN ('PHONE','GOOGLE','KAKAO','NAVER','LOCAL_ADMIN','DEV'));
