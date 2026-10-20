-- 상품 색상은 SVG 속성에 그대로 들어가므로 #rrggbb 형식만 허용한다.
alter table public.products
  add constraint products_color_hex check (color ~ '^#[0-9a-fA-F]{6}$'),
  add constraint products_tone_hex check (tone ~ '^#[0-9a-fA-F]{6}$');
