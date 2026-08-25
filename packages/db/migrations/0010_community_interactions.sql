CREATE TABLE community_post_likes (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX community_post_likes_user_idx
ON community_post_likes (user_id, created_at DESC, post_id);

CREATE INDEX user_blocks_blocker_cursor_idx
ON user_blocks (blocker_id, created_at DESC, blocked_id DESC);

CREATE INDEX user_blocks_blocked_lookup_idx
ON user_blocks (blocked_id, blocker_id);

ALTER TABLE wanted_requests
ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);
