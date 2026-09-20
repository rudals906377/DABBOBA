-- Home rail presentation is category-specific. Existing operator rows stay
-- nullable so they remain reviewable without silently choosing a card layout.
ALTER TABLE public.home_catalog_sections
ADD COLUMN layout_kind text
CHECK (layout_kind IN ('gacha', 'kuji'));

-- One IP may legitimately back separate Gacha and Kuji rails. The section id
-- remains the durable identity and sort_order remains the display authority.
ALTER TABLE public.home_catalog_sections
DROP CONSTRAINT home_catalog_sections_ip_id_key;

CREATE INDEX home_catalog_sections_ip_order_idx
ON public.home_catalog_sections (ip_id, sort_order, id);
