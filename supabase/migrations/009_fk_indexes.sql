-- advisor(0001): 외래 키 보조 인덱스
create index if not exists cart_items_product_id_idx on public.cart_items (product_id);
create index if not exists wishlists_product_id_idx on public.wishlists (product_id);
