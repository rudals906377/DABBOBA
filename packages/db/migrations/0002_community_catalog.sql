CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('PROFILE','POST','COMMENT','INQUIRY','EXCHANGE','CATALOG_REQUEST','CATALOG')),
  object_key text NOT NULL UNIQUE,
  object_generation bigint,
  original_filename varchar(255),
  declared_mime_type varchar(120) NOT NULL,
  detected_mime_type varchar(120),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_UPLOAD' CHECK (status IN ('PENDING_UPLOAD','UPLOADED','PROCESSING','READY','REJECTED','DELETED')),
  width integer,
  height integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER media_assets_set_updated_at BEFORE UPDATE ON media_assets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE catalog_ips (
  id text PRIMARY KEY,
  slug varchar(100) NOT NULL UNIQUE,
  name_ko varchar(160) NOT NULL,
  name_en varchar(160) NOT NULL,
  name_ja varchar(160),
  aliases text[] NOT NULL DEFAULT '{}',
  description text NOT NULL DEFAULT '',
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_ips_name_ko_trgm_idx ON catalog_ips USING gin (name_ko gin_trgm_ops);
CREATE INDEX catalog_ips_name_en_trgm_idx ON catalog_ips USING gin (name_en gin_trgm_ops);
CREATE TRIGGER catalog_ips_set_updated_at BEFORE UPDATE ON catalog_ips
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE catalog_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_id text NOT NULL REFERENCES catalog_ips(id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ip_id, name)
);
CREATE INDEX catalog_characters_name_trgm_idx ON catalog_characters USING gin (name gin_trgm_ops);
CREATE TRIGGER catalog_characters_set_updated_at BEFORE UPDATE ON catalog_characters
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE catalog_products (
  id text PRIMARY KEY,
  sku varchar(80) NOT NULL UNIQUE,
  ip_id text NOT NULL REFERENCES catalog_ips(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('gacha','figure','kuji','tcg')),
  name varchar(240) NOT NULL,
  manufacturer varchar(160),
  release_date date,
  price integer NOT NULL CHECK (price >= 0),
  currency char(3) NOT NULL DEFAULT 'KRW' CHECK (currency = 'KRW'),
  image_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_products_name_trgm_idx ON catalog_products USING gin (name gin_trgm_ops);
CREATE INDEX catalog_products_filter_idx ON catalog_products (category, ip_id, is_active);
CREATE TRIGGER catalog_products_set_updated_at BEFORE UPDATE ON catalog_products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_characters (
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES catalog_characters(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, character_id)
);

CREATE TABLE product_stock (
  product_id text PRIMARY KEY REFERENCES catalog_products(id) ON DELETE RESTRICT,
  on_hand integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= on_hand),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER product_stock_set_updated_at BEFORE UPDATE ON product_stock
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL,
  content text NOT NULL,
  is_pinned boolean NOT NULL DEFAULT false,
  is_published boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','DELETED')),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_published OR status = 'ACTIVE')
);
CREATE INDEX notices_public_idx ON notices (is_pinned DESC, published_at DESC, id DESC)
WHERE is_published AND status = 'ACTIVE';
CREATE TRIGGER notices_set_updated_at BEFORE UPDATE ON notices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE notice_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  title varchar(160) NOT NULL,
  content text NOT NULL,
  is_pinned boolean NOT NULL,
  is_published boolean NOT NULL,
  changed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, version)
);
CREATE TRIGGER notice_versions_immutable
BEFORE UPDATE OR DELETE ON notice_versions
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('ACCOUNT','ERROR','PRODUCT','COMMUNITY','ORDER','OTHER')),
  title varchar(160) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','ANSWERED','CLOSED')),
  assigned_admin_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX inquiries_queue_idx ON inquiries (status, updated_at DESC, id DESC);
CREATE INDEX inquiries_user_idx ON inquiries (user_id, created_at DESC, id DESC);
CREATE TRIGGER inquiries_set_updated_at BEFORE UPDATE ON inquiries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE inquiry_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES inquiries(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  author_role text NOT NULL CHECK (author_role IN ('USER','ADMIN','SUPER_ADMIN')),
  content text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_internal OR author_role IN ('ADMIN','SUPER_ADMIN'))
);
CREATE INDEX inquiry_messages_inquiry_idx ON inquiry_messages (inquiry_id, created_at, id);

CREATE TABLE inquiry_message_media (
  message_id uuid NOT NULL REFERENCES inquiry_messages(id) ON DELETE RESTRICT,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (message_id, media_id)
);

CREATE TABLE community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ip_id text REFERENCES catalog_ips(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('DUKROOM','SNAP','GENERAL')),
  title varchar(160) NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','DELETED')),
  hidden_reason text,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_posts_public_idx ON community_posts (created_at DESC, id DESC) WHERE status = 'ACTIVE';
CREATE INDEX community_posts_title_trgm_idx ON community_posts USING gin (title gin_trgm_ops);
CREATE TRIGGER community_posts_set_updated_at BEFORE UPDATE ON community_posts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE community_post_media (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  sort_order smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  parent_comment_id uuid REFERENCES community_comments(id) ON DELETE RESTRICT,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','DELETED')),
  hidden_reason text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_comments_post_idx ON community_comments (post_id, created_at, id);
CREATE TRIGGER community_comments_set_updated_at BEFORE UPDATE ON community_comments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_type text NOT NULL CHECK (target_type IN ('POST','COMMENT','SNAP','USER','EXCHANGE_LISTING')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ABUSE','ADVERTISING','SPAM','INAPPROPRIATE','SUSPECTED_FRAUD','COPYRIGHT','OTHER')),
  details text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REVIEWING','RESOLVED','REJECTED')),
  resolution text,
  resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX content_reports_one_open_idx
ON content_reports (reporter_id, target_type, target_id)
WHERE status IN ('PENDING','REVIEWING');
CREATE INDEX content_reports_queue_idx ON content_reports (status, created_at, id);
CREATE TRIGGER content_reports_set_updated_at BEFORE UPDATE ON content_reports
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX user_suspensions_active_idx ON user_suspensions (user_id, starts_at DESC)
WHERE revoked_at IS NULL;

CREATE TABLE moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  report_id uuid REFERENCES content_reports(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('NO_ACTION','HIDE_POST','HIDE_COMMENT','RESTORE_POST','RESTORE_COMMENT','WARN_USER','SUSPEND_USER')),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER moderation_actions_immutable
BEFORE UPDATE OR DELETE ON moderation_actions
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

CREATE TABLE catalog_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('PRODUCT','IP')),
  name varchar(240) NOT NULL,
  reference_url text,
  description text,
  media_id uuid REFERENCES media_assets(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','ON_HOLD','MERGED')),
  canonical_target_id text,
  decision_reason text,
  decided_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_requests_queue_idx ON catalog_requests (status, created_at, id);
CREATE TRIGGER catalog_requests_set_updated_at BEFORE UPDATE ON catalog_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wanted_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('gacha','figure','kuji','tcg')),
  ip_id text NOT NULL REFERENCES catalog_ips(id) ON DELETE RESTRICT,
  desired_item varchar(240) NOT NULL,
  details text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','HIDDEN','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wanted_requests_public_idx ON wanted_requests (created_at DESC, id DESC) WHERE status = 'ACTIVE';
CREATE INDEX wanted_requests_category_cursor_idx ON wanted_requests (category, created_at DESC, id DESC) WHERE status = 'ACTIVE';
CREATE INDEX wanted_requests_ip_cursor_idx ON wanted_requests (ip_id, created_at DESC, id DESC) WHERE status = 'ACTIVE';
CREATE TRIGGER wanted_requests_set_updated_at BEFORE UPDATE ON wanted_requests
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE wanted_request_likes (
  request_id uuid NOT NULL REFERENCES wanted_requests(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX wanted_request_likes_user_idx ON wanted_request_likes (user_id, created_at DESC, request_id);

CREATE TABLE inventory_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES catalog_products(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('PURCHASE','GACHA','KUJI','ADMIN_ADJUSTMENT')),
  source_id uuid,
  status text NOT NULL DEFAULT 'OWNED' CHECK (status IN ('OWNED','EXCHANGE_LISTED','EXCHANGE_OFFERED','SHIPPING','TRANSFERRED','REFUNDED')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_units_owner_status_idx ON inventory_units (owner_id, status, acquired_at DESC, id DESC);
CREATE TRIGGER inventory_units_set_updated_at BEFORE UPDATE ON inventory_units
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exchange_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  offered_inventory_unit_id uuid NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  details text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MATCHED','COMPLETED','CANCELLED','HIDDEN')),
  accepted_offer_id uuid,
  matched_at timestamptz,
  author_confirmed_at timestamptz,
  proposer_confirmed_at timestamptz,
  completed_at timestamptz,
  completion_mode text CHECK (completion_mode IS NULL OR completion_mode IN ('MUTUAL_CONFIRMATION','ADMIN_OVERRIDE')),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  cancel_reason text,
  resolved_by_admin_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  hidden_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('MATCHED','COMPLETED') OR accepted_offer_id IS NOT NULL),
  CHECK (status <> 'MATCHED' OR (matched_at IS NOT NULL AND completed_at IS NULL)),
  CHECK (matched_at IS NULL OR accepted_offer_id IS NOT NULL),
  CHECK (status <> 'COMPLETED' OR matched_at IS NOT NULL),
  CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  CHECK ((status = 'COMPLETED') = (completion_mode IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL)),
  CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL)),
  CHECK ((author_confirmed_at IS NULL AND proposer_confirmed_at IS NULL) OR matched_at IS NOT NULL),
  CHECK (resolved_by_admin_id IS NULL OR status IN ('COMPLETED','CANCELLED'))
);
CREATE UNIQUE INDEX exchange_listings_active_inventory_idx ON exchange_listings (offered_inventory_unit_id)
WHERE status IN ('OPEN','MATCHED');
CREATE INDEX exchange_listings_public_idx ON exchange_listings (created_at DESC, id DESC) WHERE status = 'OPEN';
CREATE TRIGGER exchange_listings_set_updated_at BEFORE UPDATE ON exchange_listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE exchange_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES exchange_listings(id) ON DELETE RESTRICT,
  proposer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  offered_inventory_unit_id uuid NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','WITHDRAWN')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, id),
  UNIQUE (listing_id, proposer_id, offered_inventory_unit_id)
);
ALTER TABLE exchange_listings
ADD CONSTRAINT exchange_listings_accepted_offer_fk
FOREIGN KEY (id, accepted_offer_id) REFERENCES exchange_offers(listing_id, id)
ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX exchange_offers_one_accepted_idx ON exchange_offers (listing_id) WHERE status = 'ACCEPTED';
CREATE TRIGGER exchange_offers_set_updated_at BEFORE UPDATE ON exchange_offers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION enforce_exchange_listing_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.accepted_offer_id IS NOT NULL AND NEW.accepted_offer_id IS DISTINCT FROM OLD.accepted_offer_id THEN
    RAISE EXCEPTION 'accepted exchange offer cannot be replaced';
  END IF;
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'OPEN' AND NEW.status IN ('MATCHED','CANCELLED','HIDDEN')) OR
    (OLD.status = 'MATCHED' AND NEW.status IN ('COMPLETED','CANCELLED','HIDDEN')) OR
    (OLD.status = 'HIDDEN' AND NEW.status = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'invalid exchange listing transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER exchange_listings_transition_guard
BEFORE UPDATE OF status, accepted_offer_id ON exchange_listings
FOR EACH ROW EXECUTE FUNCTION enforce_exchange_listing_transition();

CREATE OR REPLACE FUNCTION enforce_exchange_offer_transition()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('ACCEPTED','REJECTED','WITHDRAWN') THEN
    RAISE EXCEPTION 'invalid exchange offer transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER exchange_offers_transition_guard
BEFORE UPDATE OF status ON exchange_offers
FOR EACH ROW EXECUTE FUNCTION enforce_exchange_offer_transition();

CREATE TABLE inventory_ownership_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_listing_id uuid NOT NULL REFERENCES exchange_listings(id) ON DELETE RESTRICT,
  inventory_unit_id uuid NOT NULL REFERENCES inventory_units(id) ON DELETE RESTRICT,
  from_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  to_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transferred_by_admin_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exchange_listing_id, inventory_unit_id),
  CHECK (from_owner_id <> to_owner_id)
);
CREATE INDEX inventory_ownership_transfers_owner_idx
ON inventory_ownership_transfers (to_owner_id, created_at DESC, id DESC);
CREATE TRIGGER inventory_ownership_transfers_immutable
BEFORE UPDATE OR DELETE ON inventory_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

INSERT INTO admin_permissions (code, description)
VALUES ('exchange.resolve', 'Complete or cancel a matched exchange')
ON CONFLICT DO NOTHING;
INSERT INTO admin_role_permissions (role, permission_code) VALUES
  ('ADMIN','exchange.resolve'), ('SUPER_ADMIN','exchange.resolve')
ON CONFLICT DO NOTHING;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind varchar(100) NOT NULL,
  title varchar(160) NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC, id DESC);
