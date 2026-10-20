-- Phase 3: 찜(F9) / 리뷰(F10) / 검색(F11) / 서버 장바구니(F12) / 배송지(F13) / 구글 로그인 메타데이터(F14)

/* ---------- F9 찜 ---------- */
create table public.wishlists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.wishlists enable row level security;
create policy "wishlists: 본인 조회" on public.wishlists for select to authenticated using (user_id = (select auth.uid()));
create policy "wishlists: 본인 등록" on public.wishlists for insert to authenticated with check (user_id = (select auth.uid()));
create policy "wishlists: 본인 삭제" on public.wishlists for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, delete on public.wishlists to authenticated;

-- products.likes 는 클라이언트가 직접 바꾸지 못하고 트리거로만 증감한다.
create or replace function public.wishlists_sync_likes()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.products set likes = likes + 1 where id = new.product_id;
  else
    update public.products set likes = greatest(likes - 1, 0) where id = old.product_id;
  end if;
  return null;
end;
$$;
create trigger wishlists_sync_likes
  after insert or delete on public.wishlists
  for each row execute function public.wishlists_sync_likes();

/* ---------- F12 서버 장바구니 ---------- */
create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  size text not null,
  qty integer not null check (qty between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id, size)
);
alter table public.cart_items enable row level security;
create policy "cart_items: 본인 조회" on public.cart_items for select to authenticated using (user_id = (select auth.uid()));
create policy "cart_items: 본인 등록" on public.cart_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy "cart_items: 본인 수정" on public.cart_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "cart_items: 본인 삭제" on public.cart_items for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.cart_items to authenticated;

-- 로그인 시 로컬 장바구니를 서버 장바구니에 합친다(같은 상품+사이즈는 수량 합산, 상한 99). 합쳐진 전체를 돌려준다.
create or replace function public.merge_cart(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  if jsonb_typeof(p_items) = 'array' then
    insert into public.cart_items (user_id, product_id, size, qty)
    select v_uid, x.id, x.size, least(sum(x.qty), 99)::integer
      from jsonb_to_recordset(p_items) as x(id text, size text, qty integer)
      join public.products p on p.id = x.id and p.is_active and x.size = any (p.sizes)
     where x.qty >= 1
     group by x.id, x.size
    on conflict (user_id, product_id, size)
    do update set qty = least(public.cart_items.qty + excluded.qty, 99), updated_at = now();
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', product_id, 'size', size, 'qty', qty) order by updated_at, product_id, size)
                     from public.cart_items where user_id = v_uid), '[]'::jsonb);
end;
$$;

-- 장바구니 전체를 교체한다(이후 변경 동기화용).
create or replace function public.set_cart(p_items jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception '로그인이 필요합니다.'; end if;
  delete from public.cart_items where user_id = v_uid;
  if jsonb_typeof(p_items) = 'array' then
    insert into public.cart_items (user_id, product_id, size, qty)
    select v_uid, x.id, x.size, least(sum(x.qty), 99)::integer
      from jsonb_to_recordset(p_items) as x(id text, size text, qty integer)
      join public.products p on p.id = x.id and p.is_active and x.size = any (p.sizes)
     where x.qty >= 1
     group by x.id, x.size;
  end if;
end;
$$;

/* ---------- F13 배송지 ---------- */
create table public.addresses (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default '',
  recipient text not null,
  phone text not null,
  zip text not null,
  addr1 text not null,
  addr2 text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index addresses_user_id_idx on public.addresses (user_id);
create unique index addresses_one_default on public.addresses (user_id) where is_default;
alter table public.addresses enable row level security;
create policy "addresses: 본인 조회" on public.addresses for select to authenticated using (user_id = (select auth.uid()));
create policy "addresses: 본인 등록" on public.addresses for insert to authenticated with check (user_id = (select auth.uid()));
create policy "addresses: 본인 수정" on public.addresses for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "addresses: 본인 삭제" on public.addresses for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.addresses to authenticated;

-- 최대 10개, 첫 배송지는 자동 기본, 기본 지정 시 기존 기본 해제.
create or replace function public.addresses_rules()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.addresses where user_id = new.user_id) >= 10 then
      raise exception '배송지는 최대 10개까지 등록할 수 있습니다.';
    end if;
    if not exists (select 1 from public.addresses where user_id = new.user_id) then
      new.is_default := true;
    end if;
  end if;
  if new.is_default then
    update public.addresses set is_default = false where user_id = new.user_id and id is distinct from new.id and is_default;
  end if;
  return new;
end;
$$;
create trigger addresses_rules
  before insert or update on public.addresses
  for each row execute function public.addresses_rules();

/* ---------- F10 리뷰 ---------- */
create table public.reviews (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_item_id bigint not null unique references public.order_items (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  image_paths text[] not null default '{}' check (cardinality(image_paths) <= 3),
  author text not null default '',
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index reviews_product_id_idx on public.reviews (product_id, created_at desc);
create index reviews_user_id_idx on public.reviews (user_id);
alter table public.reviews enable row level security;

create policy "reviews: 숨김 아님 또는 본인/관리자 조회" on public.reviews for select to anon, authenticated
  using (not is_hidden or user_id = (select auth.uid()) or (select public.is_admin()));
-- 작성: 본인의 delivered 주문에 속한 해당 상품 항목만(주문 항목당 1회는 unique).
create policy "reviews: 구매확정 본인 작성" on public.reviews for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.order_items oi join public.orders o on o.id = oi.order_id
       where oi.id = order_item_id and oi.product_id = reviews.product_id
         and o.user_id = (select auth.uid()) and o.status = 'delivered'
    )
  );
create policy "reviews: 본인 또는 관리자 수정" on public.reviews for update to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "reviews: 본인 또는 관리자 삭제" on public.reviews for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;

-- 작성자 표시명(마스킹)과 수정 가능 필드 제한(숨김 여부는 관리자만).
create or replace function public.reviews_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(name, ''), split_part(email, '@', 1)) into v_name from public.profiles where id = new.user_id;
    new.author := left(coalesce(v_name, ''), 1) || '***';
    new.is_hidden := false;
  else
    new.product_id := old.product_id;
    new.user_id := old.user_id;
    new.order_item_id := old.order_item_id;
    new.author := old.author;
    new.created_at := old.created_at;
    if not public.is_admin() then new.is_hidden := old.is_hidden; end if;
  end if;
  return new;
end;
$$;
create trigger reviews_before_write
  before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- products.rating / reviews 재집계(숨김 제외)
create or replace function public.reviews_sync_product()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_pid text := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set rating = coalesce((select round(avg(rating)::numeric, 1) from public.reviews where product_id = v_pid and not is_hidden), 0),
         reviews = (select count(*) from public.reviews where product_id = v_pid and not is_hidden)
   where p.id = v_pid;
  return null;
end;
$$;
create trigger reviews_sync_product
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_sync_product();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-images', 'review-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
-- 경로 규칙: {user_id}/{파일명}
create policy "review-images: 본인 폴더 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'review-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "review-images: 본인 또는 관리자 삭제" on storage.objects for delete to authenticated
  using (bucket_id = 'review-images' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())));

/* ---------- F11 검색 ---------- */
create extension if not exists pg_trgm with schema extensions;
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_brand_trgm on public.products using gin (brand extensions.gin_trgm_ops);
create index products_created_at_idx on public.products (created_at desc);

-- 부분 일치 + 오타 완화(유사도). RLS를 따르도록 security invoker.
create or replace function public.search_products(q text)
returns setof public.products
language sql stable set search_path = ''
as $$
  select p.* from public.products p
   where length(trim(q)) > 0 and (
     p.name ilike '%' || trim(q) || '%'
     or p.brand ilike '%' || trim(q) || '%'
     or extensions.similarity(p.name, trim(q)) > 0.2
     or extensions.similarity(p.brand, trim(q)) > 0.3
   )
   order by greatest(extensions.similarity(p.name, trim(q)), extensions.similarity(p.brand, trim(q))) desc, p.likes desc
   limit 200;
$$;

/* ---------- F14 구글 로그인 메타데이터 ---------- */
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

/* ---------- 권한 ---------- */
revoke execute on function public.merge_cart(jsonb) from public, anon;
revoke execute on function public.set_cart(jsonb) from public, anon;
grant execute on function public.merge_cart(jsonb) to authenticated;
grant execute on function public.set_cart(jsonb) to authenticated;
revoke execute on function public.wishlists_sync_likes() from public, anon, authenticated;
revoke execute on function public.addresses_rules() from public, anon, authenticated;
revoke execute on function public.reviews_before_write() from public, anon, authenticated;
revoke execute on function public.reviews_sync_product() from public, anon, authenticated;
grant execute on function public.search_products(text) to anon, authenticated;
