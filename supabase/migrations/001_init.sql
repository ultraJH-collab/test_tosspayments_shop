-- FITROOM 초기 스키마: 회원(profiles) / 상품(products) / 주문(orders, order_items)
-- 이 파일은 Supabase 프로젝트에 적용된 마이그레이션의 기록입니다.

/* ---------- 회원 ---------- */
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  name text not null default '',
  phone text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;

-- 회원가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 일반 회원은 role/status를 바꿀 수 없고, 관리자는 자기 권한을 내려놓을 수 없다.
-- (auth.uid()가 없는 경우 = SQL 편집기/서비스 키. anon은 RLS로 update 자체가 막혀 있다.)
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  if (select auth.uid()) is null then
    return new;
  end if;
  if not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  elsif new.id = (select auth.uid()) and (new.role <> 'admin' or new.status <> 'active') then
    raise exception '자기 자신의 관리자 권한/상태는 변경할 수 없습니다.';
  end if;
  return new;
end;
$$;
create trigger protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

create policy "profiles: 본인 또는 관리자 조회" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: 본인 또는 관리자 수정" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

/* ---------- 상품 ---------- */
create table public.products (
  id text primary key check (id ~ '^[a-z0-9_-]{2,40}$'),
  cat text not null check (cat in ('tops', 'pants', 'shoes')),
  brand text not null,
  name text not null,
  price integer not null check (price >= 0),
  sale integer not null check (sale >= 0 and sale <= price),
  color text not null default '#888888',
  tone text not null default '#f2f2f2',
  sizes text[] not null default '{}',
  rating numeric(2, 1) not null default 0 check (rating between 0 and 5),
  reviews integer not null default 0 check (reviews >= 0),
  likes integer not null default 0 check (likes >= 0),
  tag text check (tag in ('BEST', 'NEW')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.products enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

create policy "products: 판매중 상품은 누구나, 관리자는 전체 조회" on public.products
  for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "products: 관리자 등록" on public.products
  for insert to authenticated with check ((select public.is_admin()));
create policy "products: 관리자 수정" on public.products
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "products: 관리자 삭제" on public.products
  for delete to authenticated using ((select public.is_admin()));

/* ---------- 주문 ---------- */
create table public.orders (
  id text primary key,
  user_id uuid references public.profiles (id) on delete set null,
  order_name text not null default '',
  amount integer not null default 0,
  subtotal integer not null default 0,
  shipping integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'shipping', 'delivered', 'canceled', 'failed')),
  payment_key text,
  customer_name text not null default '',
  customer_phone text not null default '',
  customer_email text not null default '',
  zip text not null default '',
  addr1 text not null default '',
  addr2 text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index orders_user_id_idx on public.orders (user_id);
create index orders_created_at_idx on public.orders (created_at desc);
alter table public.orders enable row level security;

-- 상품이 수정/삭제되어도 주문 당시 정보가 남도록 스냅샷으로 저장한다(products FK 없음).
create table public.order_items (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  product_id text not null,
  brand text not null,
  product_name text not null,
  size text not null,
  qty integer not null check (qty between 1 and 99),
  unit_price integer not null,
  line_total integer not null
);
create index order_items_order_id_idx on public.order_items (order_id);
alter table public.order_items enable row level security;

create policy "orders: 본인 또는 관리자 조회" on public.orders
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "orders: 관리자 상태 변경" on public.orders
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "order_items: 주문 소유자 또는 관리자 조회" on public.order_items
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
  );

-- 주문 생성: 금액은 클라이언트가 아니라 DB의 상품가로 계산한다.
-- 배송비 규칙은 js/common.js의 SHIPPING_FREE_OVER / SHIPPING_FEE와 같아야 한다.
create or replace function public.create_order(p_items jsonb, p_customer jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id text := 'FR' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || upper(substr(md5(random()::text), 1, 6));
  v_sub integer := 0;
  v_ship integer;
  v_name text;
  v_count integer := 0;
  r record;
  p public.products;
begin
  if v_uid is not null and exists (select 1 from public.profiles where id = v_uid and status = 'blocked') then
    raise exception '이용이 정지된 계정입니다.';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 50 then
    raise exception '주문할 상품이 없습니다.';
  end if;
  if coalesce(trim(p_customer ->> 'name'), '') = '' then
    raise exception '받는 분 이름을 입력해 주세요.';
  end if;

  insert into public.orders (id, user_id, customer_name, customer_phone, customer_email, zip, addr1, addr2, memo)
  values (
    v_id, v_uid,
    left(trim(p_customer ->> 'name'), 50),
    left(coalesce(p_customer ->> 'phone', ''), 20),
    left(coalesce(p_customer ->> 'email', ''), 100),
    left(coalesce(p_customer ->> 'zip', ''), 10),
    left(coalesce(p_customer ->> 'addr1', ''), 200),
    left(coalesce(p_customer ->> 'addr2', ''), 200),
    left(coalesce(p_customer ->> 'memo', ''), 100)
  );

  for r in select * from jsonb_to_recordset(p_items) as x(id text, size text, qty integer) loop
    select * into p from public.products where products.id = r.id and is_active;
    if not found then
      raise exception '판매하지 않는 상품이 포함되어 있습니다. (%)', r.id;
    end if;
    if r.qty is null or r.qty < 1 or r.qty > 99 then
      raise exception '수량이 올바르지 않습니다.';
    end if;
    if not (r.size = any (p.sizes)) then
      raise exception '선택할 수 없는 사이즈입니다. (% / %)', p.name, r.size;
    end if;
    insert into public.order_items (order_id, product_id, brand, product_name, size, qty, unit_price, line_total)
    values (v_id, p.id, p.brand, p.name, r.size, r.qty, p.sale, p.sale * r.qty);
    v_sub := v_sub + p.sale * r.qty;
    v_count := v_count + 1;
    v_name := coalesce(v_name, p.name);
  end loop;

  v_ship := case when v_sub >= 50000 then 0 else 3000 end;
  if v_count > 1 then
    v_name := v_name || ' 외 ' || (v_count - 1) || '건';
  end if;
  update public.orders
     set order_name = v_name, subtotal = v_sub, shipping = v_ship, amount = v_sub + v_ship
   where id = v_id;

  return jsonb_build_object('order_id', v_id, 'order_name', v_name, 'amount', v_sub + v_ship);
end;
$$;

-- 결제 성공 리다이렉트 후 호출: 저장된 금액과 일치하는 대기 주문만 결제완료로 바꾼다.
-- 토스 결제 승인 API(서버)는 아직 없으므로 "결제 인증 완료" 수준의 처리다.
create or replace function public.mark_order_paid(p_order_id text, p_payment_key text, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  update public.orders
     set status = 'paid', payment_key = p_payment_key, paid_at = now()
   where id = p_order_id and status = 'pending' and amount = p_amount
  returning * into o;
  if not found then
    select * into o from public.orders where id = p_order_id and payment_key = p_payment_key and amount = p_amount;
    if not found then
      raise exception '주문 정보가 없거나 결제 금액이 일치하지 않습니다.';
    end if;
  end if;
  return jsonb_build_object('order_id', o.id, 'order_name', o.order_name, 'amount', o.amount, 'status', o.status);
end;
$$;

create or replace function public.mark_order_failed(p_order_id text)
returns void
language sql security definer set search_path = ''
as $$
  update public.orders set status = 'failed' where id = p_order_id and status = 'pending';
$$;

/* ---------- 권한 ---------- */
grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
revoke execute on function public.create_order(jsonb, jsonb) from public;
revoke execute on function public.mark_order_paid(text, text, integer) from public;
revoke execute on function public.mark_order_failed(text) from public;
grant execute on function public.create_order(jsonb, jsonb) to anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer) to anon, authenticated;
grant execute on function public.mark_order_failed(text) to anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
