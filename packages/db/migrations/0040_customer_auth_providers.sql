-- Keep legacy PHONE identities intact while enabling the five approved
-- customer login methods. The API no longer offers or accepts new phone login.
ALTER TABLE auth_identities
DROP CONSTRAINT auth_identities_provider_check;

ALTER TABLE auth_identities
ADD CONSTRAINT auth_identities_provider_check
CHECK (provider IN (
  'PHONE',
  'GOOGLE',
  'APPLE',
  'KAKAO',
  'NAVER',
  'EMAIL',
  'LOCAL_ADMIN',
  'DEV'
));
