CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  bio varchar(500),
  favorite_ip_id text REFERENCES catalog_ips(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_profiles_favorite_ip_idx ON user_profiles (favorite_ip_id) WHERE favorite_ip_id IS NOT NULL;
CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION create_default_user_profile()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_profiles (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_create_default_profile
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION create_default_user_profile();

INSERT INTO user_profiles (user_id)
SELECT id FROM users
ON CONFLICT DO NOTHING;

CREATE TABLE default_shipping_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  recipient varchar(80) NOT NULL CHECK (char_length(btrim(recipient)) BETWEEN 1 AND 80),
  phone varchar(20) NOT NULL CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  postal_code varchar(12) NOT NULL CHECK (char_length(btrim(postal_code)) BETWEEN 3 AND 12),
  address_line1 varchar(200) NOT NULL CHECK (char_length(btrim(address_line1)) BETWEEN 1 AND 200),
  address_line2 varchar(200),
  delivery_note varchar(200),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER default_shipping_addresses_set_updated_at BEFORE UPDATE ON default_shipping_addresses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wishlist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);
CREATE INDEX wishlist_items_user_cursor_idx ON wishlist_items (user_id, created_at DESC, id DESC);
