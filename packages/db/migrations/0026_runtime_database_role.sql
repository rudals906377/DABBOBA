-- Keep schema changes on the migration connection while API and worker traffic
-- uses a non-owner role with data access only. Login credentials are provisioned
-- separately and are never stored in migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dabboba_runtime') THEN
    CREATE ROLE dabboba_runtime;
  END IF;
END
$$;

ALTER ROLE dabboba_runtime WITH
  NOLOGIN
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  BYPASSRLS;
ALTER ROLE dabboba_runtime SET search_path = pg_catalog, public, extensions, pg_temp;

REVOKE ALL ON SCHEMA public FROM dabboba_runtime;
GRANT USAGE ON SCHEMA public TO dabboba_runtime;
REVOKE ALL ON SCHEMA extensions FROM dabboba_runtime;
GRANT USAGE ON SCHEMA extensions TO dabboba_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dabboba_runtime;
GRANT SELECT ON TABLE
  public.account_deletion_request_events,
  public.account_deletion_requests,
  public.admin_audit_logs,
  public.admin_commerce_review_notes,
  public.admin_commerce_reviews,
  public.admin_credentials,
  public.admin_role_permissions,
  public.auth_identities,
  public.catalog_characters,
  public.catalog_ips,
  public.catalog_products,
  public.catalog_requests,
  public.community_comments,
  public.community_post_likes,
  public.community_post_media,
  public.community_posts,
  public.content_reports,
  public.coupon_redemptions,
  public.coupons,
  public.default_shipping_addresses,
  public.draw_entitlements,
  public.draw_pool_entries,
  public.draw_probability_versions,
  public.draw_results,
  public.exchange_listings,
  public.exchange_offers,
  public.idempotency_keys,
  public.inquiries,
  public.inquiry_message_media,
  public.inquiry_messages,
  public.inventory_point_return_items,
  public.inventory_point_returns,
  public.inventory_units,
  public.kuji_room_entries,
  public.kuji_rooms,
  public.media_assets,
  public.notices,
  public.notification_preferences,
  public.notifications,
  public.order_lines,
  public.orders,
  public.outbox_events,
  public.payment_ledger_entries,
  public.payment_provider_events,
  public.payments,
  public.point_accounts,
  public.point_ledger_entries,
  public.product_characters,
  public.product_stock,
  public.product_stock_adjustment_ledger,
  public.sessions,
  public.shipping_request_items,
  public.shipping_requests,
  public.shipping_status_events,
  public.stock_reservations,
  public.user_blocks,
  public.user_profiles,
  public.user_suspensions,
  public.users,
  public.wanted_request_likes,
  public.wanted_requests,
  public.wishlist_items
TO dabboba_runtime;

GRANT INSERT ON TABLE
  public.account_deletion_request_events,
  public.account_deletion_requests,
  public.admin_audit_logs,
  public.admin_commerce_review_notes,
  public.admin_commerce_reviews,
  public.admin_credentials,
  public.admin_login_events,
  public.auth_identities,
  public.catalog_characters,
  public.catalog_ips,
  public.catalog_products,
  public.catalog_requests,
  public.community_comments,
  public.community_post_likes,
  public.community_post_media,
  public.community_posts,
  public.content_reports,
  public.coupon_redemptions,
  public.default_shipping_addresses,
  public.draw_entitlements,
  public.draw_pool_entries,
  public.draw_probability_versions,
  public.draw_results,
  public.exchange_listings,
  public.exchange_offers,
  public.idempotency_keys,
  public.inquiries,
  public.inquiry_message_media,
  public.inquiry_messages,
  public.inventory_ownership_transfers,
  public.inventory_point_return_items,
  public.inventory_point_returns,
  public.inventory_units,
  public.kuji_room_entries,
  public.kuji_rooms,
  public.media_assets,
  public.moderation_actions,
  public.notice_versions,
  public.notices,
  public.notification_preference_events,
  public.notification_preferences,
  public.notifications,
  public.order_lines,
  public.orders,
  public.outbox_events,
  public.payment_ledger_entries,
  public.payment_provider_events,
  public.payments,
  public.point_accounts,
  public.point_ledger_entries,
  public.product_characters,
  public.product_stock,
  public.product_stock_adjustment_ledger,
  public.sessions,
  public.shipping_request_items,
  public.shipping_requests,
  public.shipping_status_events,
  public.stock_reservations,
  public.user_blocks,
  public.user_profiles,
  public.user_suspensions,
  public.users,
  public.wanted_request_likes,
  public.wanted_requests,
  public.wishlist_items
TO dabboba_runtime;

GRANT UPDATE ON TABLE
  public.account_deletion_requests,
  public.admin_commerce_reviews,
  public.admin_credentials,
  public.catalog_characters,
  public.catalog_ips,
  public.catalog_products,
  public.catalog_requests,
  public.community_comments,
  public.community_posts,
  public.content_reports,
  public.coupon_redemptions,
  public.coupons,
  public.default_shipping_addresses,
  public.draw_entitlements,
  public.draw_pool_entries,
  public.draw_probability_versions,
  public.exchange_listings,
  public.exchange_offers,
  public.idempotency_keys,
  public.inquiries,
  public.inventory_units,
  public.kuji_room_entries,
  public.kuji_rooms,
  public.media_assets,
  public.notices,
  public.notification_preferences,
  public.notifications,
  public.order_lines,
  public.orders,
  public.outbox_events,
  public.payments,
  public.point_accounts,
  public.product_stock,
  public.sessions,
  public.shipping_requests,
  public.stock_reservations,
  public.user_profiles,
  public.user_suspensions,
  public.users,
  public.wanted_requests
TO dabboba_runtime;

GRANT DELETE ON TABLE
  public.community_post_likes,
  public.community_post_media,
  public.idempotency_keys,
  public.product_characters,
  public.user_blocks,
  public.wanted_request_likes,
  public.wishlist_items
TO dabboba_runtime;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM dabboba_runtime;
GRANT USAGE ON SEQUENCE public.kuji_room_entries_queue_sequence_seq TO dabboba_runtime;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM dabboba_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions FROM dabboba_runtime;
GRANT EXECUTE ON FUNCTION public.default_notification_preference_state(integer)
TO dabboba_runtime;
GRANT EXECUTE ON FUNCTION extensions.citext_eq(extensions.citext, extensions.citext)
TO dabboba_runtime;
