-- Phase 2: 상품 이미지(F5) / 배송 추적(F6) / 관리자 Realtime(F7)

/* ---------- F5: 이미지 ---------- */
create table public.product_images (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on delete cascade,
  path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_id_idx on public.product_images (product_id, sort_order);
alter table public.product_images enable row level security;
create policy "product_images: 누구나 조회" on public.product_images
  for select to anon, authenticated using (true);
create policy "product_images: 관리자 등록" on public.product_images
  for insert to authenticated with check ((select public.is_admin()));
create policy "product_images: 관리자 수정" on public.product_images
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "product_images: 관리자 삭제" on public.product_images
  for delete to authenticated using ((select public.is_admin()));
grant select on public.product_images to anon, authenticated;
grant insert, update, delete on public.product_images to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create policy "product-images: 관리자 업로드" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy "product-images: 관리자 수정" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
create policy "product-images: 관리자 삭제" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));

/* ---------- F6: 배송 추적 ---------- */
-- 배송중으로 바꿀 때는 택배사와 운송장 번호가 필요하다. 상태 전이 자체는 orders_status_guard 가 검증한다.
create or replace function public.orders_shipping_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = 'shipping' and old.status is distinct from 'shipping' and current_user in ('authenticated', 'anon') then
    if coalesce(trim(new.courier), '') = '' or coalesce(trim(new.tracking_no), '') = '' then
      raise exception '택배사와 운송장 번호를 입력해 주세요.';
    end if;
  end if;
  return new;
end;
$$;
create trigger orders_shipping_guard
  before update on public.orders
  for each row execute function public.orders_shipping_guard();

/* ---------- F7: Realtime ---------- */
-- 구독도 RLS를 따르므로 관리자만 타인 주문 변경을 받는다.
alter publication supabase_realtime add table public.orders;
