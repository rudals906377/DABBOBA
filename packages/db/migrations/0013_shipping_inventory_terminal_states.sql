ALTER TABLE inventory_units
DROP CONSTRAINT inventory_units_status_check;

ALTER TABLE inventory_units
ADD CONSTRAINT inventory_units_status_check
CHECK (status IN (
  'OWNED',
  'EXCHANGE_LISTED',
  'EXCHANGE_OFFERED',
  'SHIPPING',
  'DELIVERED',
  'TRANSFERRED',
  'REFUNDED'
)) NOT VALID;

UPDATE inventory_units AS inventory
SET status = CASE shipping.status
  WHEN 'CANCELLED' THEN 'OWNED'
  WHEN 'DELIVERED' THEN 'DELIVERED'
END
FROM shipping_request_items AS item
JOIN shipping_requests AS shipping ON shipping.id = item.shipping_request_id
WHERE inventory.id = item.inventory_unit_id
  AND inventory.status = 'SHIPPING'
  AND shipping.status IN ('CANCELLED', 'DELIVERED');

ALTER TABLE inventory_units
VALIDATE CONSTRAINT inventory_units_status_check;
