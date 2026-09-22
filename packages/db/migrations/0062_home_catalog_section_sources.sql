-- Home rails can be curated manually or populated from a deterministic source.
-- Existing rows keep their previous IP-backed behavior after this migration.
ALTER TABLE public.home_catalog_sections
ADD COLUMN subtitle varchar(240),
ADD COLUMN source_kind text NOT NULL DEFAULT 'IP'
  CHECK (source_kind IN ('MANUAL', 'IP', 'NEW', 'POPULAR')),
ADD COLUMN visible_limit smallint NOT NULL DEFAULT 20
  CHECK (visible_limit BETWEEN 1 AND 20);

ALTER TABLE public.home_catalog_sections
ALTER COLUMN ip_id DROP NOT NULL;

ALTER TABLE public.home_catalog_sections
ADD CONSTRAINT home_catalog_sections_source_ip_check
CHECK (source_kind <> 'IP' OR ip_id IS NOT NULL);

-- Manual product order is durable operator data rather than JSON embedded in
-- the section. A product can appear only once in a section and each position is
-- unique, so the API can replace an ordered selection transactionally.
CREATE TABLE public.home_catalog_section_products (
  section_id text NOT NULL REFERENCES public.home_catalog_sections(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.catalog_products(id) ON DELETE RESTRICT,
  sort_order smallint NOT NULL CHECK (sort_order BETWEEN 0 AND 19),
  PRIMARY KEY (section_id, product_id),
  UNIQUE (section_id, sort_order)
);

CREATE INDEX home_catalog_section_products_product_idx
ON public.home_catalog_section_products (product_id, section_id);

ALTER TABLE public.home_catalog_section_products ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.home_catalog_section_products
FROM PUBLIC, anon, authenticated, dabboba_worker, dabboba_runtime;
GRANT SELECT, INSERT, DELETE ON TABLE public.home_catalog_section_products TO dabboba_runtime;

COMMENT ON COLUMN public.home_catalog_sections.source_kind IS
  'MANUAL uses home_catalog_section_products; IP, NEW, and POPULAR are populated by the API.';
COMMENT ON COLUMN public.home_catalog_sections.visible_limit IS
  'Maximum number of cards returned for this Home rail, from 1 through 20.';
COMMENT ON TABLE public.home_catalog_section_products IS
  'Operator-owned ordered product selection for MANUAL Home rails.';
