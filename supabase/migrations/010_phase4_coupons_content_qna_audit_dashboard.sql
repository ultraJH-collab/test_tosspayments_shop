-- Phase 4: 쿠폰(F15) / 상품 Q&A(F16) / 배너·공지·FAQ(F17) / 매출 대시보드(F18) / 감사 로그(F19)

/* ---------- F15 쿠폰 ---------- */
create table public.coupons (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,30}$'),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('amount', 'percent')),
  value integer not null check (value > 0),
  min_order integer not null default 0 check (min_order >= 0),
  max_discount integer check (max_discount is null or max_discount > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  total_limit integer check (total_limit is null or total_limit > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'amount' or value <= 100)
);
alter table public.coupons enable row level security;
-- 일반 회원에게는 목록을 노출하지 않는다(코드 검증 RPC만). 관리자만 직접 접근.
create policy "coupons: 관리자 조회" on public.coupons for select to authenticated using ((select public.is_admin()));
create policy "coupons: 관리자 등록" on public.coupons for insert to authenticated with check ((select public.is_admin()));
create policy "coupons: 관리자 수정" on public.coupons for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "coupons: 관리자 삭제" on public.coupons for delete to authenticated using ((select public.is_admin()));
grant select, insert, update, delete on public.coupons to authenticated;

create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id bigint not null references public.coupons (id),
  user_id uuid references public.profiles (id) on delete set null,
  order_id text not null references public.orders (id) on delete cascade,
  status text not null default 'used' check (status in ('used', 'restored')),
  created_at timestamptz not null default now()
);
create index coupon_redemptions_coupon_user_idx on public.coupon_redemptions (coupon_id, user_id);
create index coupon_redemptions_order_id_idx on public.coupon_redemptions (order_id);
create index coupon_redemptions_user_id_idx on public.coupon_redemptions (user_id);
alter table public.coupon_redemptions enable row level security;
create policy "coupon_redemptions: 본인 또는 관리자 조회" on public.coupon_redemptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.coupon_redemptions to authenticated;

alter table public.orders
  add constraint orders_coupon_id_fkey foreign key (coupon_id) references public.coupons (id) on delete set null;
create index orders_coupon_id_idx on public.orders (coupon_id);

-- 쿠폰 검증과 할인액 계산(서버가 단일 진실). p_lock=true 면 쿠폰 행을 잠가 발급 한도 경쟁을 막는다.
create or replace function public.coupon_apply(p_code text, p_subtotal integer, p_uid uuid, p_lock boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.coupons;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_disc integer;
begin
  if p_uid is null then
    raise exception '쿠폰은 로그인 후 사용할 수 있습니다.';
  end if;
  if p_lock then
    select * into c from public.coupons where code = v_code for update;
  else
    select * into c from public.coupons where code = v_code;
  end if;
  if not found or not c.is_active then
    raise exception '사용할 수 없는 쿠폰입니다.';
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    raise exception '아직 사용할 수 없는 쿠폰입니다.';
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    raise exception '사용 기한이 지난 쿠폰입니다.';
  end if;
  if p_subtotal < c.min_order then
    raise exception '최소 주문금액 %원 이상부터 사용할 수 있습니다.', c.min_order;
  end if;
  if c.total_limit is not null
     and (select count(*) from public.coupon_redemptions where coupon_id = c.id and status = 'used') >= c.total_limit then
    raise exception '발급 한도가 모두 소진된 쿠폰입니다.';
  end if;
  if (select count(*) from public.coupon_redemptions where coupon_id = c.id and user_id = p_uid and status = 'used') >= c.per_user_limit then
    raise exception '이미 사용한 쿠폰입니다.';
  end if;

  if c.kind = 'amount' then
    v_disc := c.value;
  else
    v_disc := floor(p_subtotal * c.value / 100.0)::integer;
    if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
  end if;
  v_disc := least(v_disc, p_subtotal);
  return jsonb_build_object('coupon_id', c.id, 'name', c.name, 'discount', v_disc);
end;
$$;

-- 결제 화면 표시용. 실제 금액은 create_order 가 다시 계산한다.
create or replace function public.validate_coupon(p_code text, p_subtotal integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
begin
  r := public.coupon_apply(p_code, p_subtotal, (select auth.uid()), false);
  return jsonb_build_object('ok', true, 'name', r ->> 'name', 'discount', (r ->> 'discount')::integer);
exception when raise_exception then
  return jsonb_build_object('ok', false, 'message', sqlerrm);
end;
$$;

/* ---------- create_order: 쿠폰 할인 ---------- */
drop function public.create_order(jsonb, jsonb);
create function public.create_order(p_items jsonb, p_customer jsonb, p_coupon_code text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id text := 'FR' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || upper(substr(md5(random()::text), 1, 6));
  v_sub integer := 0;
  v_disc integer := 0;
  v_ship integer;
  v_name text;
  v_count integer := 0;
  v_cp jsonb;
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

  -- 쿠폰: 할인은 상품금액에만 적용하고, 무료배송은 할인 후 금액 기준(common.js calcOrder 와 같은 규칙).
  if nullif(trim(coalesce(p_coupon_code, '')), '') is not null then
    v_cp := public.coupon_apply(p_coupon_code, v_sub, v_uid, true);
    v_disc := (v_cp ->> 'discount')::integer;
  end if;

  v_ship := case when v_sub - v_disc >= 50000 then 0 else 3000 end;
  if v_count > 1 then
    v_name := v_name || ' 외 ' || (v_count - 1) || '건';
  end if;
  update public.orders
     set order_name = v_name, subtotal = v_sub, shipping = v_ship, discount = v_disc,
         coupon_id = (v_cp ->> 'coupon_id')::bigint, amount = v_sub - v_disc + v_ship
   where id = v_id;
  if v_cp is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id)
    values ((v_cp ->> 'coupon_id')::bigint, v_uid, v_id);
  end if;

  return jsonb_build_object('order_id', v_id, 'order_name', v_name, 'amount', v_sub - v_disc + v_ship, 'discount', v_disc);
end;
$$;

/* ---------- 주문 상태 트리거: 실패/취소 시 쿠폰 사용 복구 ---------- */
create or replace function public.orders_status_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('failed', 'canceled') and old.status in ('pending', 'paid', 'shipping') then
    update public.product_stock ps
       set stock = ps.stock + x.qty
      from (
        select product_id, size, sum(qty)::integer as qty
          from public.order_items where order_id = new.id group by product_id, size
      ) x
     where ps.product_id = x.product_id and ps.size = x.size;

    update public.coupon_redemptions set status = 'restored' where order_id = new.id and status = 'used';
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor, note)
  values (new.id, old.status, new.status, (select auth.uid()), coalesce(new.cancel_reason, new.fail_reason));
  return new;
end;
$$;

/* ---------- F16 상품 Q&A ---------- */
create table public.product_questions (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  author text not null default '',
  body text not null check (char_length(body) between 1 and 1000),
  is_secret boolean not null default false,
  answer text check (answer is null or char_length(answer) <= 1000),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
create index product_questions_product_id_idx on public.product_questions (product_id, created_at desc);
create index product_questions_user_id_idx on public.product_questions (user_id);
alter table public.product_questions enable row level security;
-- 비밀글은 작성자와 관리자만 열람한다.
create policy "product_questions: 공개글 또는 본인/관리자 조회" on public.product_questions for select to anon, authenticated
  using (not is_secret or user_id = (select auth.uid()) or (select public.is_admin()));
create policy "product_questions: 회원 작성" on public.product_questions for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "product_questions: 관리자 답변" on public.product_questions for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "product_questions: 본인 또는 관리자 삭제" on public.product_questions for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
grant select on public.product_questions to anon, authenticated;
grant insert, delete on public.product_questions to authenticated;
grant update (answer) on public.product_questions to authenticated;

create or replace function public.product_questions_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select coalesce(nullif(name, ''), split_part(email, '@', 1)) into v_name from public.profiles where id = new.user_id;
    new.author := left(coalesce(v_name, ''), 1) || '***';
    new.answer := null;
    new.answered_at := null;
  else
    new.answered_at := case
      when nullif(trim(coalesce(new.answer, '')), '') is null then null
      when new.answer is distinct from old.answer then now()
      else old.answered_at
    end;
    if nullif(trim(coalesce(new.answer, '')), '') is null then new.answer := null; end if;
  end if;
  return new;
end;
$$;
create trigger product_questions_before_write
  before insert or update on public.product_questions
  for each row execute function public.product_questions_before_write();

/* ---------- F17 배너 · 공지 · FAQ ---------- */
create table public.banners (
  id bigint generated always as identity primary key,
  title text not null default '',
  image_path text not null,
  link_url text not null default '',
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.notices (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '',
  is_pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.faqs (
  id bigint generated always as identity primary key,
  question text not null check (char_length(question) between 1 and 200),
  answer text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.banners enable row level security;
alter table public.notices enable row level security;
alter table public.faqs enable row level security;

-- 배너는 노출 중인 것만 공개, 관리자는 전체.
create policy "banners: 노출중 또는 관리자 조회" on public.banners for select to anon, authenticated
  using (
    (select public.is_admin())
    or (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()))
  );
create policy "banners: 관리자 등록" on public.banners for insert to authenticated with check ((select public.is_admin()));
create policy "banners: 관리자 수정" on public.banners for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "banners: 관리자 삭제" on public.banners for delete to authenticated using ((select public.is_admin()));

create policy "notices: 누구나 조회" on public.notices for select to anon, authenticated using (true);
create policy "notices: 관리자 등록" on public.notices for insert to authenticated with check ((select public.is_admin()));
create policy "notices: 관리자 수정" on public.notices for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "notices: 관리자 삭제" on public.notices for delete to authenticated using ((select public.is_admin()));

create policy "faqs: 누구나 조회" on public.faqs for select to anon, authenticated using (true);
create policy "faqs: 관리자 등록" on public.faqs for insert to authenticated with check ((select public.is_admin()));
create policy "faqs: 관리자 수정" on public.faqs for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "faqs: 관리자 삭제" on public.faqs for delete to authenticated using ((select public.is_admin()));

grant select on public.banners, public.notices, public.faqs to anon, authenticated;
grant insert, update, delete on public.banners, public.notices, public.faqs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
create policy "banners: 관리자 업로드" on storage.objects for insert to authenticated
  with check (bucket_id = 'banners' and (select public.is_admin()));
create policy "banners: 관리자 수정(파일)" on storage.objects for update to authenticated
  using (bucket_id = 'banners' and (select public.is_admin()));
create policy "banners: 관리자 삭제(파일)" on storage.objects for delete to authenticated
  using (bucket_id = 'banners' and (select public.is_admin()));

/* ---------- F19 감사 로그 ---------- */
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor uuid,
  table_name text not null,
  row_id text,
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_table_idx on public.audit_logs (table_name, created_at desc);
alter table public.audit_logs enable row level security;
-- 관리자 조회만 허용. insert 는 트리거(security definer)뿐이고 update/delete 는 누구에게도 권한이 없다.
create policy "audit_logs: 관리자 조회" on public.audit_logs for select to authenticated using ((select public.is_admin()));
grant select on public.audit_logs to authenticated;

-- 인자 'admin': 관리자가 한 변경만 기록(고객 주문으로 인한 재고 변동 등은 제외). 'all': 항상 기록.
create or replace function public.audit_row()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v jsonb := coalesce(v_new, v_old);
begin
  if tg_argv[0] = 'admin' and not coalesce(public.is_admin(), false) then
    return null;
  end if;
  insert into public.audit_logs (actor, table_name, row_id, action, before, after)
  values (
    (select auth.uid()), tg_table_name,
    coalesce(v ->> 'id', (v ->> 'product_id') || ':' || (v ->> 'size')),
    tg_op, v_old, v_new
  );
  return null;
end;
$$;

create trigger audit_products_iud after insert or delete on public.products
  for each row execute function public.audit_row('admin');
create trigger audit_products_u after update on public.products
  for each row
  when ((old.name, old.brand, old.price, old.sale, old.sizes, old.tag, old.is_active) is distinct from (new.name, new.brand, new.price, new.sale, new.sizes, new.tag, new.is_active))
  execute function public.audit_row('admin');
create trigger audit_product_stock after insert or update or delete on public.product_stock
  for each row execute function public.audit_row('admin');
create trigger audit_coupons after insert or update or delete on public.coupons
  for each row execute function public.audit_row('admin');
create trigger audit_profiles_u after update on public.profiles
  for each row
  when (old.role is distinct from new.role or old.status is distinct from new.status)
  execute function public.audit_row('all');
create trigger audit_orders_status after update on public.orders
  for each row
  when (old.status is distinct from new.status)
  execute function public.audit_row('all');

/* ---------- F18 매출 대시보드(관리자 전용, security invoker → RLS 적용) ---------- */
-- 매출은 paid~delivered 만 포함하고 canceled 는 제외한다(취소율 계산에만 사용).
create or replace function public.admin_dashboard(p_from date, p_to date, p_unit text default 'day')
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  v_unit text := case when p_unit in ('day', 'week', 'month') then p_unit else 'day' end;
  r jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 조회할 수 있습니다.';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 800 then
    raise exception '조회 기간이 올바르지 않습니다.';
  end if;

  with o as materialized (
    select x.id, x.status, x.amount, (coalesce(x.paid_at, x.created_at) at time zone 'Asia/Seoul')::date as d
      from public.orders x
     where (coalesce(x.paid_at, x.created_at) at time zone 'Asia/Seoul')::date between p_from and p_to
       and x.status in ('paid', 'shipping', 'delivered', 'canceled')
  ),
  series as (
    select date_trunc(v_unit, d::timestamp)::date as period, count(*) as n, sum(amount)::bigint as rev
      from o where status <> 'canceled' group by 1
  ),
  cats as (
    select coalesce(p.cat, 'etc') as cat, sum(oi.qty)::integer as qty, sum(oi.line_total)::bigint as rev
      from o join public.order_items oi on oi.order_id = o.id
      left join public.products p on p.id = oi.product_id
     where o.status <> 'canceled' group by 1
  ),
  top as (
    select oi.product_id, max(oi.product_name) as name, sum(oi.qty)::integer as qty, sum(oi.line_total)::bigint as rev
      from o join public.order_items oi on oi.order_id = o.id
     where o.status <> 'canceled' group by oi.product_id
     order by sum(oi.qty) desc, sum(oi.line_total) desc limit 10
  ),
  sm as (
    select count(*) filter (where status <> 'canceled') as orders,
           coalesce(sum(amount) filter (where status <> 'canceled'), 0) as revenue,
           coalesce(round(avg(amount) filter (where status <> 'canceled')), 0) as aov,
           count(*) filter (where status = 'canceled') as canceled,
           coalesce(round(100.0 * count(*) filter (where status = 'canceled') / nullif(count(*), 0), 1), 0) as cancel_rate
      from o
  )
  select jsonb_build_object(
    'summary', (select to_jsonb(sm) from sm),
    'series', coalesce((select jsonb_agg(jsonb_build_object('period', period, 'orders', n, 'revenue', rev) order by period) from series), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('cat', cat, 'qty', qty, 'revenue', rev) order by rev desc) from cats), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'qty', qty, 'revenue', rev) order by qty desc, rev desc) from top), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;

/* ---------- 권한 ---------- */
revoke execute on function public.coupon_apply(text, integer, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.validate_coupon(text, integer) from public, anon;
grant execute on function public.validate_coupon(text, integer) to authenticated;
revoke execute on function public.admin_dashboard(date, date, text) from public, anon;
grant execute on function public.admin_dashboard(date, date, text) to authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
revoke execute on function public.product_questions_before_write() from public, anon, authenticated;
revoke execute on function public.orders_status_guard() from public, anon, authenticated;
