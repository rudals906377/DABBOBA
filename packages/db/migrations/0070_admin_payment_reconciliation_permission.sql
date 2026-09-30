-- A provider requery may grant draw entitlements or move an order into review.
-- Keep it separate from read-only payment access and refund execution.
INSERT INTO admin_permissions (code, description) VALUES
  ('payments.reconcile', 'Requery a PortOne payment and apply its verified state through the canonical payment handler')
ON CONFLICT DO NOTHING;

INSERT INTO admin_role_permissions (role, permission_code)
VALUES ('SUPER_ADMIN', 'payments.reconcile')
ON CONFLICT DO NOTHING;
