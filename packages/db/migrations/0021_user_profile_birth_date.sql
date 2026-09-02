ALTER TABLE user_profiles
ADD COLUMN birth_date date,
ADD CONSTRAINT user_profiles_birth_date_valid
CHECK (
  birth_date IS NULL
  OR birth_date BETWEEN DATE '1900-01-01' AND CURRENT_DATE
);
