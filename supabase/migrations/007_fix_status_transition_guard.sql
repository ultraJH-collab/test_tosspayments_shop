-- orders_status_guard 는 security definer 라서 안에서 current_user 가 항상 소유자로 보인다.
-- 클라이언트(authenticated/anon)의 직접 상태 변경 검사는 security invoker 트리거로 분리한다.
create or replace function public.orders_transition_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status and current_user in ('authenticated', 'anon') then
    if not ((old.status = 'paid' and new.status = 'shipping') or (old.status = 'shipping' and new.status = 'delivered')) then
      raise exception '허용되지 않는 주문 상태 변경입니다. (% → %)', old.status, new.status;
    end if;
    if new.status = 'shipping' then
      if coalesce(trim(new.courier), '') = '' or coalesce(trim(new.tracking_no), '') = '' then
        raise exception '택배사와 운송장 번호를 입력해 주세요.';
      end if;
      new.shipped_at := coalesce(new.shipped_at, now());
    end if;
    if new.status = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  end if;
  return new;
end;
$$;
drop trigger orders_shipping_guard on public.orders;
drop function public.orders_shipping_guard();
create trigger orders_a_transition_guard
  before update on public.orders
  for each row execute function public.orders_transition_guard();

-- security definer 쪽에서는 역할 검사를 제거(서비스 롤/RPC 경로의 전이는 허용).
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
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor, note)
  values (new.id, old.status, new.status, (select auth.uid()), coalesce(new.cancel_reason, new.fail_reason));
  return new;
end;
$$;
