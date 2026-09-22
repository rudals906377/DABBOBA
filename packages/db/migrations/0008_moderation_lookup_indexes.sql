-- Keep public report badges and operator subject-history filters index-backed
-- as user-generated content and moderation history grow.
CREATE INDEX content_reports_target_lookup_idx
ON content_reports (target_type, target_id, created_at DESC, id DESC);

CREATE INDEX community_posts_author_lookup_idx
ON community_posts (author_id, created_at DESC, id DESC)
INCLUDE (kind, status);

CREATE INDEX community_comments_author_lookup_idx
ON community_comments (author_id, created_at DESC, id DESC)
INCLUDE (status);

CREATE INDEX exchange_listings_author_lookup_idx
ON exchange_listings (author_id, created_at DESC, id DESC)
INCLUDE (status);
