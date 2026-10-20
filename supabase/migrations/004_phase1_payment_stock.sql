-- Phase 1: 결제 승인(F1) / 재고(F2) / pending 자동 만료(F3) / 주문 취소(F4)

/* ---------- 재고 (F2) ---------- */
create table public.product_stock (
  product_id text not null references public.products (id) on delete cascade,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  primary key (product_id, size)
);
alter table public.product_stock enable row level security;

create policy "product_stock: 누구나 조회" on public.product_stock
  for select to anon, authenticated using (true);
create policy "product_stock: 관리자 등록" on public.product_stock
  for insert to authenticated with check ((select public.is_admin()));
create policy "product_stock: 관리자 수정" on public.product_stock
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "product_stock: 관리자 삭제" on public.product_stock
  for delete to authenticated using ((select public.is_admin()));
grant select on public.product_stock to anon, authenticated;
grant insert, update, delete on public.product_stock to authenticated;

-- 기존 상품은 사이즈별 10개로 시작한다.
insert into public.product_stock (product_id, size, stock)
select p.id, s, 10 from public.products p, unnest(p.sizes) as s
on conflict do nothing;

/* ---------- 주문 확장 / 상태 이력 ---------- */
alter table public.orders
  add column payment_method text,
  add column approved_at timestamptz,
  add column fail_reason text,
  add column cancel_reason text,
  add column canceled_at timestamptz,
  add column courier text,
  add column tracking_no text,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column discount integer not null default 0,
  add column coupon_id bigint;

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor uuid,
  note text,
  created_at timestamptz not null default now()
);
create index order_events_order_id_idx on public.order_events (order_id);
alter table public.order_events enable row level security;
create policy "order_events: 주문 소유자 또는 관리자 조회" on public.order_events
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.orders o where o.id = order_id and o.user_id = (select auth.uid()))
  );
grant select on public.order_events to authenticated;

/* ---------- 주문 상태 트리거: 전이 검증 + 이력 + 재고 복구 ---------- */
-- 클라이언트(authenticated/anon)가 직접 바꿀 수 있는 전이는 관리자의 paid→shipping→delivered 뿐이다.
-- 취소/실패/결제완료는 security definer 함수(서비스 롤 경유)에서만 일어난다.
create or replace function public.orders_status_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if current_user in ('authenticated', 'anon') then
    if not ((old.status = 'paid' and new.status = 'shipping') or (old.status = 'shipping' and new.status = 'delivered')) then
      raise exception '허용되지 않는 주문 상태 변경입니다. (% → %)', old.status, new.status;
    end if;
    if new.status = 'shipping' then new.shipped_at := coalesce(new.shipped_at, now()); end if;
    if new.status = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  end if;

  -- 실패/취소되면 차감했던 재고를 되돌린다.
  if new.status in ('failed', 'canceled') and old.status in ('pending', 'paid', 'shipping') then
    update public.product_stock ps
       set stock = ps.stock + x.qty
      from (
        select product_id, size, sum(qty)::integer as qty
          from public.order_items where order_id = new.id group by product_id, size
      ) x
     where ps.product_id = x.product_id and ps.size = x.size;
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor, note)
  values (new.id, old.status, new.status, (select auth.uid()), coalesce(new.cancel_reason, new.fail_reason));
  return new;
end;
$$;
create trigger orders_status_guard
  before update on public.orders
  for each row execute function public.orders_status_guard();

create or replace function public.orders_log_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.order_events (order_id, from_status, to_status, actor)
  values (new.id, null, new.status, new.user_id);
  return new;
end;
$$;
create trigger orders_log_created
  after insert on public.orders
  for each row execute function public.orders_log_created();

/* ---------- create_order: 재고 차감 ---------- */
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

  -- 교착 방지를 위해 항상 (상품, 사이즈) 순서로 처리한다.
  for r in
    select * from jsonb_to_recordset(p_items) as x(id text, size text, qty integer)
     order by x.id, x.size
  loop
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

    -- 조건부 UPDATE가 행을 잠그므로 동시 주문에서도 재고가 음수가 되지 않는다.
    update public.product_stock
       set stock = stock - r.qty
     where product_id = p.id and size = r.size and stock >= r.qty;
    if not found then
      raise exception '재고가 부족합니다. (% / %)', p.name, r.size;
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

/* ---------- 결제 완료 / 실패 / 취소 / 만료 ---------- */
drop function public.mark_order_paid(text, text, integer);
create function public.mark_order_paid(
  p_order_id text, p_payment_key text, p_amount integer,
  p_method text default null, p_approved_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  update public.orders
     set status = 'paid', payment_key = p_payment_key, paid_at = now(),
         payment_method = p_method, approved_at = coalesce(p_approved_at, now())
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

drop function public.mark_order_failed(text);
create function public.mark_order_failed(p_order_id text, p_reason text default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.orders
     set status = 'failed', fail_reason = left(coalesce(p_reason, 'canceled_by_user'), 200)
   where id = p_order_id and status = 'pending';
$$;

create function public.cancel_order_db(p_order_id text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders;
begin
  update public.orders
     set status = 'canceled', cancel_reason = left(coalesce(nullif(trim(p_reason), ''), '고객 요청'), 200), canceled_at = now()
   where id = p_order_id and status = 'paid'
  returning * into o;
  if not found then
    raise exception '취소할 수 없는 주문입니다.';
  end if;
  return jsonb_build_object('order_id', o.id, 'status', o.status);
end;
$$;

create function public.expire_pending_orders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  with expired as (
    update public.orders
       set status = 'failed', fail_reason = 'expired'
     where status = 'pending' and created_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*) into n from expired;
  return n;
end;
$$;

/* ---------- 권한 ---------- */
-- Supabase는 새 함수에 anon/authenticated 실행 권한을 자동 부여하므로 명시적으로 회수한다.
revoke execute on function public.mark_order_paid(text, text, integer, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.cancel_order_db(text, text) from public, anon, authenticated;
revoke execute on function public.expire_pending_orders() from public, anon, authenticated;
revoke execute on function public.mark_order_failed(text, text) from public;
revoke execute on function public.orders_status_guard() from public, anon, authenticated;
revoke execute on function public.orders_log_created() from public, anon, authenticated;
grant execute on function public.mark_order_paid(text, text, integer, text, timestamptz) to service_role;
grant execute on function public.cancel_order_db(text, text) to service_role;
grant execute on function public.expire_pending_orders() to service_role;
grant execute on function public.mark_order_failed(text, text) to anon, authenticated, service_role;

/* ---------- 자동 만료 (F3) ---------- */
create extension if not exists pg_cron;
select cron.schedule('expire-pending-orders', '* * * * *', $$select public.expire_pending_orders()$$);
