-- Operator-managed presentation policy for the fixed commerce categories.
-- Category IDs keep their domain meaning; operators control only storefront presentation.
CREATE TABLE public.storefront_category_settings (
  category text PRIMARY KEY CHECK (category IN ('gacha', 'figure', 'kuji', 'tcg')),
  label varchar(40) NOT NULL CHECK (btrim(label) <> ''),
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  availability varchar(20) NOT NULL CHECK (availability IN ('active', 'coming-soon', 'hidden')),
  show_on_home boolean NOT NULL DEFAULT false,
  show_on_catalog boolean NOT NULL DEFAULT true,
  show_on_exchange boolean NOT NULL DEFAULT true,
  show_on_wanted boolean NOT NULL DEFAULT true,
  description varchar(240) NOT NULL DEFAULT '',
  image_url text,
  icon_key varchar(80),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (image_url IS NULL OR image_url ~ '^https?://'),
  CHECK (icon_key IS NULL OR icon_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

INSERT INTO public.storefront_category_settings (
  category, label, sort_order, availability,
  show_on_home, show_on_catalog, show_on_exchange, show_on_wanted,
  description, icon_key
) VALUES
  ('gacha', '가챠', 10, 'active', true, true, true, true, '캡슐을 열어 상품을 확인해요.', 'capsule'),
  ('kuji', '쿠지', 20, 'active', true, true, true, true, '번호를 선택해 쿠지 상품을 확인해요.', 'ticket'),
  ('figure', '피규어', 30, 'coming-soon', false, true, true, true, '피규어 상품은 준비가 끝나는 대로 공개할게요.', 'figure'),
  ('tcg', '카드', 40, 'hidden', false, false, false, false, '카드 상품을 준비하고 있어요.', 'cards')
ON CONFLICT (category) DO NOTHING;

CREATE INDEX storefront_category_settings_order_idx
ON public.storefront_category_settings (sort_order, category);

CREATE TRIGGER storefront_category_settings_set_updated_at
BEFORE UPDATE ON public.storefront_category_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.storefront_category_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.storefront_category_settings FROM PUBLIC;
DO $$
DECLARE
  app_role text;
BEGIN
  FOR app_role IN
    SELECT rolname FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.storefront_category_settings FROM %I',
      app_role
    );
  END LOOP;
END
$$;

-- Only the reviewed API runtime can read or update the fixed settings.
-- Rows are never created or deleted through the runtime role.
REVOKE ALL ON TABLE public.storefront_category_settings FROM dabboba_runtime;
GRANT SELECT, UPDATE ON TABLE public.storefront_category_settings TO dabboba_runtime;
