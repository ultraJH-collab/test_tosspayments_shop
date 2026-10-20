# FITROOM PRD — Supabase 연동 기능 확장

| 항목 | 내용 |
|---|---|
| 문서 상태 | **확정 v1.0** (§8 결정 사항 기본안으로 확정) · 구현 현황은 §12 (Phase 1~4 구현 완료, 수동 확인·설정 항목은 §12.3) |
| 대상 서비스 | FITROOM (순수 HTML/CSS/JS + Supabase + 토스페이먼츠 결제위젯 v2 테스트 환경) |
| 작성일 | 2026-10-20 |
| 범위 결정 | 전체 기능 + 단계별 로드맵 / 소셜 로그인은 **구글만** / 프로모션은 **쿠폰만**(적립금·등급은 Future) |

---

## 1. 배경과 목표

### 1.1 현재 상태 (As-Is)
- 회원(`profiles`), 상품(`products`), 주문(`orders`, `order_items`) 테이블과 RLS가 구현되어 있다.
- 주문은 RPC `create_order` → 토스 결제 → `success.html`의 `mark_order_paid` 흐름이다.
- **빈틈**: 토스 결제 승인 API(`/v1/payments/confirm`)를 호출하지 않아 `paid`는 "결제 인증 완료" 수준이고, 승인되지 않은 결제는 10분 후 만료된다.
- 재고·취소/환불·배송 추적·이미지·리뷰·찜 등 쇼핑몰 기본 기능이 없다. 장바구니는 localStorage에만 있다.
- 상품 이미지는 `productImage()`가 그리는 SVG 일러스트다.

### 1.2 목표 (To-Be)
1. **결제 신뢰성 확보**: 서버 측 결제 승인·취소로 "실제로 승인된 주문만 `paid`"가 되게 한다.
2. **운영 가능한 쇼핑몰**: 재고, 배송 추적, 이미지 업로드, 대시보드로 관리자가 실제 운영할 수 있게 한다.
3. **구매 전환·재방문 향상**: 찜, 리뷰, 검색·필터, 쿠폰, 서버 장바구니를 추가한다.
4. 모든 권한은 지금처럼 **RLS와 RPC로 서버에서 강제**하고, 화면 단 체크는 UX용으로만 둔다.

### 1.3 비목표 (Out of Scope)
- 실결제(라이브 키) 전환. 테스트 환경(`test_` 키) 가드는 유지한다.
- 적립금·회원 등급 (Future, §9).
- 네이버·카카오 로그인 (구글만 포함).
- 빌드 도구·프레임워크 도입. 순수 HTML/JS와 스크립트 로드 순서(`data.js → supabase-js → db.js → common.js → 페이지 JS`)를 유지한다.
- 다국어, 모바일 앱.

### 1.4 성공 지표
| 지표 | 목표 |
|---|---|
| 결제 승인 일치율 (`paid` 주문 중 토스 승인 확인된 비율) | 100% |
| 재고 초과 주문 | 0건 |
| `pending` 주문 방치 건수 | 0건 (자동 만료) |
| 상품 상세 → 장바구니 전환율 | 리뷰·찜 도입 후 기준선 대비 개선 |
| 관리자 신규 주문 인지 지연 | 5초 이내 (Realtime) |

---

## 2. 사용자와 역할

| 역할 | 설명 | 주요 권한 |
|---|---|---|
| 비회원 | 로그인하지 않은 방문자 | 상품 조회, 검색, 장바구니(localStorage), 비회원 결제 |
| 회원 (`user`) | 가입/구글 로그인 회원 | 위 + 찜, 리뷰, 서버 장바구니, 배송지, 쿠폰, 주문 취소 요청 |
| 관리자 (`admin`) | `profiles.role = 'admin'` | 상품·재고·이미지·주문·배송·쿠폰·공지·리뷰 관리, 대시보드 |

---

## 3. 우선순위와 로드맵

| 단계 | 기능 | 우선순위 |
|---|---|---|
| **Phase 1 — 결제·재고 안정화** | F1 결제 승인, F2 재고, F3 pending 자동 만료, F4 주문 취소/환불 | P0 |
| **Phase 2 — 운영 기반** | F5 상품 이미지 Storage, F6 배송 추적, F7 관리자 신규 주문 Realtime, F8 이메일 알림 | P1 |
| **Phase 3 — 구매 경험** | F9 찜, F10 리뷰·평점, F11 검색·필터·정렬, F12 서버 장바구니, F13 배송지 관리, F14 구글 로그인·비밀번호 재설정·탈퇴 | P1 |
| **Phase 4 — 성장·관리** | F15 쿠폰, F16 상품 Q&A, F17 배너·공지·FAQ, F18 매출 대시보드, F19 감사 로그, F20 CSV 내보내기·일괄 처리 | P2 |

> 각 Phase는 독립 배포 가능해야 한다. DB 변경은 `supabase/migrations/`에 새 번호 파일로 추가하고 MCP `apply_migration`으로 같은 내용을 적용한다. (Phase 1~3에서 `004`~`009` 사용 → Phase 4는 `010`(쿠폰·콘텐츠·Q&A·감사·대시보드 일괄). 실제 번호는 §12.2)

---

## 4. 기능 요구사항

### Phase 1 — 결제·재고 안정화

#### F1. 서버 결제 승인 (Edge Function) — P0
**문제**: 시크릿 키가 필요한 승인 API를 클라이언트에서 호출할 수 없다.
**요구사항**
- Edge Function `confirm-payment`가 `POST https://api.tosspayments.com/v1/payments/confirm`을 호출한다. 시크릿 키는 **함수 secret에서만** 읽고 브라우저에는 절대 노출하지 않는다. 클라이언트는 이 함수만 호출한다.
- `success.html`은 `mark_order_paid` 대신 `confirm-payment`(`orderId`, `paymentKey`, `amount`)를 호출한다.
- 함수는 DB의 `pending` 주문 금액과 요청 `amount`가 일치할 때만 토스에 승인을 요청하고, 성공 시 주문을 `paid`로 바꾼다(`payment_key`, `paid_at`, 승인 응답 일부 저장).
- 멱등성: 같은 주문을 중복 호출해도 이중 승인되지 않는다(이미 `paid`면 현재 상태를 반환). 토스 호출 시 `Idempotency-Key`를 사용한다.
- 승인 실패 시 주문을 `failed`로 바꾸고 재고를 복구한다(F2).
- `mark_order_paid` RPC는 일반 사용자가 호출할 수 없도록 권한을 회수하고 서비스 롤 전용으로 전환한다.
- (선택) 토스 **웹훅** 엔드포인트 `payment-webhook`으로 취소·가상계좌 입금 확정 상태를 동기화한다.

**수용 기준**
- [ ] 토스 승인 없이 URL 조작만으로 주문이 `paid`가 될 수 없다.
- [ ] 금액 변조(`amount` 불일치) 시 승인 호출 없이 거부된다.
- [ ] 같은 `paymentKey`로 새로고침/중복 호출해도 주문은 한 번만 `paid`가 된다.
- [ ] 브라우저 번들과 네트워크 요청 어디에도 시크릿 키가 없다.
- [ ] `test_` 클라이언트 키가 아니면 결제를 막는 기존 가드를 유지한다.

#### F2. 재고 관리 — P0
**요구사항**
- 사이즈별 재고를 관리한다(`product_stock`). 재고 0이면 상세 페이지 사이즈가 "품절"로 표시되고 선택·구매가 불가하다.
- `create_order`가 주문 생성 시 **트랜잭션 안에서 재고를 차감**(행 잠금)하고, 부족하면 예외를 던진다.
- 주문이 `failed`/`canceled`/만료되면 재고를 복구한다.
- 관리자 화면에서 상품별·사이즈별 재고를 입력/수정한다.

**수용 기준**
- [ ] 재고 1개 상품을 두 사용자가 동시에 주문하면 한 명만 성공한다.
- [ ] 결제 실패/취소/만료 시 차감된 재고가 정확히 복구된다.
- [ ] 목록 카드와 상세에서 품절 상태가 표시된다.

#### F3. `pending` 주문 자동 만료 — P0
- `pg_cron`이 1분 주기로 생성 후 **10분 초과 `pending`** 주문을 `failed`(사유: expired)로 바꾸고 재고를 복구한다. (토스 결제 만료 시간과 일치)

**수용 기준**
- [ ] 10분 넘은 `pending` 주문이 남지 않는다. 이미 `paid`인 주문은 건드리지 않는다.

#### F4. 주문 취소/환불 — P0
**요구사항**
- 회원은 마이페이지에서 `paid` 상태(배송 전) 주문의 **취소를 요청**한다. 취소 가능 상태: `paid`. 배송 시작 이후는 불가(CS 문의 안내).
- Edge Function `cancel-payment`가 토스 취소 API(`/v1/payments/{paymentKey}/cancel`)를 호출한다. 전액 취소만 지원한다(부분 취소는 Future).
- 성공 시 주문 `canceled`, 재고 복구, 쿠폰 사용 이력 복구(F15).
- 관리자도 주문 상세에서 취소할 수 있다.

**수용 기준**
- [ ] 본인 주문만 취소 가능하고, 타인 주문 취소 시도는 거부된다.
- [ ] 토스 취소 실패 시 주문 상태·재고는 변하지 않는다.
- [ ] 취소 사유와 시각이 기록된다.

---

### Phase 2 — 운영 기반

#### F5. 상품 이미지 업로드 (Supabase Storage) — P1
- 공개 읽기 버킷 `product-images`. 업로드/삭제는 관리자만(Storage RLS).
- 상품당 다중 이미지(대표 1 + 상세 N), 정렬 순서 지정. 허용 형식 jpg/png/webp, 파일당 5MB 이하.
- `productImage(p, variant)`가 이미지가 있으면 `<img>`(Storage 변환으로 썸네일 크기 지정), 없으면 **기존 SVG 일러스트로 폴백**한다. 카드·상세·장바구니·결제 화면이 한 함수 수정으로 반영되어야 한다.
- 관리자 상품 폼에 업로드·순서 변경·삭제 UI 추가.

**수용 기준**
- [ ] 일반 회원은 업로드/삭제 불가. 이미지 없는 상품은 기존처럼 SVG로 보인다.
- [ ] 목록은 썸네일, 상세는 원본급 이미지를 사용한다.

#### F6. 배송 추적 — P1
- 관리자가 주문에 택배사·운송장 번호를 입력하면 상태가 `shipping`으로, 배송 완료 시 `delivered`로 바뀐다.
- 마이페이지 주문 상세에 상태 타임라인(결제완료 → 배송중 → 배송완료)과 운송장 번호를 표시한다.
- 택배사 조회 링크는 외부 링크로만 제공한다(실시간 API 연동은 비목표).

**수용 기준**
- [ ] 상태는 `paid → shipping → delivered` 순서로만 변경된다(역방향·건너뛰기 불가, 관리자 한정).
- [ ] 각 상태 변경 시각이 `order_events`에 기록된다.

#### F7. 관리자 신규 주문 실시간 반영 (Realtime) — P1
- 관리자 주문 탭이 `orders` 변경(INSERT/UPDATE)을 구독해 신규·상태 변경 건을 즉시 반영하고 토스트로 알린다.
- Realtime 구독도 RLS를 따르므로 관리자 외에는 타인 주문을 받을 수 없다.

#### F8. 이메일 알림 — P1
- 주문 확인(`paid`), 배송 시작, 주문 취소 시 고객 이메일 발송. 발송은 Edge Function(+ 메일 서비스 API 키는 함수 secret).
- 인증 메일용 커스텀 SMTP는 Supabase 대시보드에서 설정(MCP로 변경 불가, 수동 작업으로 문서화).

> 확정: 메일 발송 서비스는 Resend (§8-1)

---

### Phase 3 — 구매 경험

#### F9. 찜(위시리스트) — P1
- 회원이 카드/상세의 하트로 찜 토글. 마이페이지 "찜한 상품" 목록. 비회원이 누르면 로그인으로 이동(`?next=`).
- `products.likes`는 트리거로 갱신한다(클라이언트가 직접 증감 불가).

**수용 기준**: [ ] 본인 찜만 조회·수정 가능 [ ] 같은 상품 중복 찜 불가 [ ] 판매중지된 상품은 목록에서 제외 표시

#### F10. 리뷰·평점 — P1
- **구매 확정(`delivered`) 주문의 상품에 대해서만** 작성 가능, 주문 항목당 1회. 별점 1~5, 내용 최대 1,000자, 사진 최대 3장(Storage `review-images`).
- 본인 리뷰 수정/삭제, 관리자는 부적절 리뷰 숨김/삭제.
- `products.rating`/`reviews`는 트리거로 집계한다(기존 컬럼 재사용).
- 상세 페이지에 평균 별점, 별점 분포, 최신순/별점순 목록 표시.

**수용 기준**: [ ] 미구매자는 작성 불가(RLS) [ ] 리뷰 추가/삭제 시 평균·개수 자동 갱신 [ ] 숨김 처리된 리뷰는 일반 사용자에게 보이지 않음

#### F11. 검색·필터·정렬 — P1
- 헤더 검색창: 상품명·브랜드 검색(`pg_trgm`로 부분 일치·오타 완화). 결과 페이지 `search.html?q=`.
- 목록(tops/pants/shoes)에 필터(가격대, 사이즈, 색상, 품절 제외)와 정렬(인기, 최신, 낮은 가격, 높은 가격, 리뷰 많은 순) 추가.
- `tops/pants/shoes.html`은 동일 마크업이므로 **세 파일을 함께 수정**한다.

#### F12. 서버 장바구니 동기화 — P1
- 로그인 시 `carts`와 localStorage(`fr_cart`)를 **병합**(같은 상품+사이즈는 수량 합산, 상한 99). 이후 변경은 서버에 반영, 비회원은 기존대로 localStorage.
- 병합 후 localStorage는 비우지 않고 캐시로 유지한다(오프라인/지연 대응).

> 확정: 병합 시 수량 합산(상한 99) (§8-3)

#### F13. 배송지 관리 — P1
- 회원당 배송지 여러 개(최대 10), 기본 배송지 1개. 결제 화면에서 선택/신규 입력, 결제 시 `orders`에는 주문 당시 값을 스냅샷으로 저장(기존 구조 유지).

#### F14. 계정 기능 — P1
- **구글 로그인**: Supabase Auth Google provider. `handle_new_user` 트리거가 구글 메타데이터(`full_name`)로 이름을 채우고, 전화번호 등 누락 정보는 최초 로그인 후 마이페이지에서 입력을 유도한다. 이미 같은 이메일로 가입한 계정과의 연결 정책은 §8-4.
- **비밀번호 재설정**: 로그인 화면의 "비밀번호 찾기" → 이메일 링크 → 재설정 페이지.
- **회원 탈퇴**: Edge Function이 `auth.users` 삭제. 주문은 `user_id`를 null로 두어(`on delete set null`) 거래 기록은 보존하고 개인정보(이름·연락처·주소)는 보존기간 정책에 따라 처리한다(§8-5).
- 이메일 인증/리다이렉트 URL과 Google OAuth 클라이언트 설정은 Supabase/Google 대시보드에서 수동 설정한다.

**수용 기준**: [ ] 차단(`blocked`) 회원은 로그인해도 주문 불가 [ ] 탈퇴 후 동일 계정으로 로그인 불가 [ ] 탈퇴 시 찜·장바구니·배송지·리뷰 처리 규칙이 문서화된 대로 동작

---

### Phase 4 — 성장·관리

#### F15. 쿠폰 — P2
- 관리자가 쿠폰 생성: 정액/정률 할인, 최소 주문금액, 최대 할인액, 사용 기한, 총 발급 한도, 1인당 사용 횟수.
- 회원은 쿠폰 코드를 입력해 보유하거나(`user_coupons`), 결제 화면에서 코드를 직접 입력해 적용한다.
- **할인 계산은 `create_order`(서버)에서만** 수행한다. 클라이언트 표시용 계산은 `calcOrder`에 두되, **배송비·할인 규칙이 `create_order`와 `common.js` 두 곳에 있으므로 반드시 함께 수정**한다. 할인은 상품금액에만 적용하고, 할인 후 금액이 기준 이상이면 무료배송(§8-6 확정).
- 주문 취소/만료 시 쿠폰 사용 상태를 복구한다. `orders`에 `discount`, `coupon_id` 컬럼 추가. 토스 `amount`는 **할인 적용 후 최종 결제금액**이어야 한다.

**수용 기준**: [ ] 만료·한도 초과·최소금액 미달 쿠폰은 거부 [ ] 클라이언트가 보낸 할인액은 사용하지 않음 [ ] 결제 취소 시 쿠폰 복구

#### F16. 상품 Q&A — P2
- 회원이 상품 상세에서 질문(비밀글 옵션). 관리자가 답변. 비밀글은 작성자·관리자만 열람(RLS).

#### F17. 배너·기획전·공지·FAQ — P2
- 관리자가 메인 배너(이미지·링크·노출기간·순서), 공지사항, FAQ를 관리한다. 이미지는 Storage `banners` 버킷.

#### F18. 매출 대시보드 — P2
- 관리자 대시보드 탭: 기간별(일/주/월) 매출·주문 수·객단가, 카테고리별 판매, 베스트셀러 Top 10, 취소율. SQL 뷰/RPC(관리자 전용)로 집계한다. 매출은 `paid`~`delivered`만 포함하고 `canceled`는 제외한다.

#### F19. 감사 로그 — P2
- 상품·재고·주문 상태·회원 권한/상태·쿠폰 변경을 트리거로 `audit_logs`에 기록(누가, 언제, 무엇을, 이전/이후 값). 관리자만 조회, 수정·삭제 불가.

#### F20. CSV 내보내기·일괄 처리 — P2
- 관리자 주문/회원/상품 목록 CSV 내보내기(현재 필터 기준), 주문 다건 선택 후 일괄 상태 변경(F6 상태 전이 규칙 준수).

---

## 5. 데이터 모델 (초안)

> 모든 신규 테이블은 RLS를 켠다. 아래 정책 요약의 "본인"은 `user_id = auth.uid()`, "관리자"는 `is_admin()`이다. 함수는 `security definer`이고 `set search_path = ''`로 고정한다(기존 규칙).

```sql
-- 004: 재고 (F2)
create table public.product_stock (
  product_id text not null references public.products (id) on delete cascade,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  primary key (product_id, size)
);
-- 정책: 조회 누구나 / 변경 관리자 / 차감·복구는 create_order 등 RPC에서만

-- 004: 주문 확장 (F1, F4, F6, F15)
alter table public.orders
  add column payment_method text,
  add column approved_at timestamptz,
  add column cancel_reason text,
  add column canceled_at timestamptz,
  add column courier text,
  add column tracking_no text,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column discount integer not null default 0,
  add column coupon_id bigint;

create table public.order_events (            -- 상태 변경 이력
  id bigint generated always as identity primary key,
  order_id text not null references public.orders (id) on delete cascade,
  from_status text, to_status text not null,
  actor uuid, note text,
  created_at timestamptz not null default now()
);
-- 정책: 주문 소유자/관리자 조회, 쓰기는 RPC/트리거만

-- 005: 이미지 (F5)
create table public.product_images (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on delete cascade,
  path text not null,                         -- Storage 경로
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
-- 정책: 조회 누구나 / 변경 관리자

-- 006: 찜, 장바구니, 배송지 (F9, F12, F13)
create table public.wishlists (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  size text not null,
  qty integer not null check (qty between 1 and 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id, size)
);
create table public.addresses (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default '',
  recipient text not null, phone text not null,
  zip text not null, addr1 text not null, addr2 text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
-- 정책(공통): 본인만 select/insert/update/delete. 기본 배송지는 회원당 1개(부분 유니크 인덱스).

-- 007: 리뷰 (F10)
create table public.reviews (
  id bigint generated always as identity primary key,
  product_id text not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_item_id bigint not null unique references public.order_items (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  image_paths text[] not null default '{}',
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
-- 정책: 조회 = 숨김 아님 또는 본인/관리자. 작성 = 본인 + 해당 order_item이 본인의 delivered 주문.
-- 트리거: products.rating / products.reviews 재집계, products.likes는 wishlists 트리거로 갱신

-- 008: 쿠폰 (F15)
create table public.coupons (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('amount', 'percent')),
  value integer not null check (value > 0),
  min_order integer not null default 0,
  max_discount integer,
  starts_at timestamptz, ends_at timestamptz,
  total_limit integer, per_user_limit integer not null default 1,
  is_active boolean not null default true
);
create table public.coupon_redemptions (
  id bigint generated always as identity primary key,
  coupon_id bigint not null references public.coupons (id),
  user_id uuid references public.profiles (id) on delete set null,
  order_id text not null references public.orders (id) on delete cascade,
  status text not null default 'used' check (status in ('used', 'restored')),
  created_at timestamptz not null default now()
);
-- 정책: 쿠폰 조회는 활성 쿠폰만 코드 검증 RPC로 노출(목록 직접 select 금지), 변경은 관리자

-- 009: 콘텐츠·Q&A·감사 (F16, F17, F19)
-- product_questions(id, product_id, user_id, body, is_secret, answer, answered_at, ...)
-- banners(id, image_path, link_url, starts_at, ends_at, sort_order, is_active)
-- notices(id, title, body, is_pinned, created_at), faqs(id, question, answer, sort_order)
-- audit_logs(id, actor, table_name, row_id, action, before jsonb, after jsonb, created_at)
--   정책: 관리자 select만. insert는 트리거(security definer), update/delete 불가.
```

**기존 RPC 변경**
| RPC | 변경 |
|---|---|
| `create_order` | 재고 차감(행 잠금), 쿠폰 검증·할인 적용, 배송지 선택 지원. 반환값에 `discount` 추가 |
| `mark_order_paid` | 일반 사용자 호출 금지(서비스 롤 전용) — `confirm-payment`가 사용 |
| `mark_order_failed` | 재고·쿠폰 복구 포함 |
| 신규 `cancel_order_db` | 취소 확정 시 상태/재고/쿠폰 복구를 한 트랜잭션으로(Edge Function 전용) |
| 신규 `validate_coupon(code, subtotal)` | 쿠폰 유효성·예상 할인액 반환(표시용) |
| 신규 `merge_cart(items)` | 로그인 시 장바구니 병합 |
| 신규 `admin_sales_summary(from, to, unit)` 등 | 대시보드 집계(관리자 전용) |

**Edge Functions**
| 함수 | 용도 | 시크릿 |
|---|---|---|
| `confirm-payment` | 토스 결제 승인 → `paid` | 토스 시크릿 키 |
| `cancel-payment` | 토스 결제 취소 → `canceled` | 토스 시크릿 키 |
| `payment-webhook` | 토스 웹훅 수신·동기화 | 토스 시크릿 키 |
| `send-email` | 주문/배송/취소 메일 | 메일 서비스 API 키 |
| `delete-account` | 회원 탈퇴 | 서비스 롤 키(함수 환경) |

---

## 6. 화면 변경 요약

| 화면 | 변경 |
|---|---|
| 공통 헤더 | 검색창, 찜 아이콘, 공지 링크 |
| `tops/pants/shoes.html` + `list.js` | 필터·정렬, 찜 버튼, 품절 뱃지 (3파일 동일 수정) |
| `search.html` (신규) | 검색 결과 |
| `product.html` + `product.js` | 이미지 갤러리, 사이즈별 품절, 리뷰, Q&A, 찜 |
| `cart.html` | 서버 동기화, 품절·재고 초과 경고 |
| `checkout.html` + `checkout.js` | 배송지 선택, 쿠폰 입력, 할인 반영 금액 → `setAmount` |
| `success.html` | `confirm-payment` 호출, 승인 실패 처리 |
| `mypage.html` | 주문 취소, 배송 타임라인, 리뷰 작성, 찜, 배송지, 비밀번호/탈퇴 |
| `login.html` | 구글 로그인, 비밀번호 찾기 |
| `admin.html` + `admin.js` | 재고, 이미지, 배송·운송장, 쿠폰, 공지/배너, Q&A 답변, 대시보드, 감사 로그, CSV, Realtime |
| `notice.html`, `faq.html` (신규) | 공지/FAQ |

---

## 7. 비기능 요구사항

- **보안**: 시크릿 키는 Edge Function secret에만. 브라우저에는 publishable 키만. `api.tosspayments.com`을 브라우저에서 직접 호출하지 않는다. 모든 신규 테이블 RLS 필수, 구현 후 `get_advisors`(보안/성능)로 점검한다.
- **정합성**: 금액·재고·쿠폰은 서버(DB)가 단일 진실. 클라이언트 값은 신뢰하지 않는다.
- **성능**: 목록 조회 p95 1초 이내(자주 쓰는 컬럼 인덱스, 검색은 `pg_trgm` GIN 인덱스). 이미지는 썸네일 변환 사용.
- **접근성/호환**: 기존 반응형 레이아웃 유지, 최신 Chrome/Safari/Edge.
- **관측성**: Edge Function 로그(`query_logs`)로 승인/취소 실패 추적. 결제 실패 사유를 `orders`/`order_events`에 남긴다.
- **개인정보**: 탈퇴·보존기간 정책 문서화(§8-5). 리뷰 사진 등 업로드물에 대한 삭제 연쇄 처리.
- **환경 분리**: 스키마 변경은 Supabase Branching(개발 브랜치)에서 검증 후 병합하는 것을 권장한다.

---

## 8. 확정된 결정 사항

아래 9개 항목은 모두 기본안 그대로 확정되었다. (2026-10-20)

| # | 질문 | 확정안 |
|---|---|---|
| 1 | 메일 발송 서비스는? (Resend / SendGrid / Supabase 커스텀 SMTP만) | Resend |
| 2 | 부분 취소(일부 상품만 환불)를 이번에 지원할까? | 전액 취소만 |
| 3 | 로그인 시 장바구니 병합 규칙 | 같은 상품+사이즈 수량 합산(상한 99) |
| 4 | 구글 로그인 이메일이 기존 이메일 가입 계정과 같을 때 | 자동 연결(Supabase 기본, 동일 이메일 인증 전제) |
| 5 | 탈퇴 후 주문 내 개인정보 보존 기간 | 전자상거래법상 5년 보존 후 파기(이름·연락처는 마스킹) |
| 6 | 쿠폰 할인 후 무료배송 판정 기준 | 할인 **후** 금액 기준 |
| 7 | 재고 차감 시점 | 주문 생성(pending) 시 차감, 실패/만료 시 복구 |
| 8 | 리뷰 작성 가능 시점 | `delivered` 상태 후, 기간 제한 없음 |
| 9 | 관리자 역할 세분화(운영/CS) | 이번 범위 제외, 단일 `admin` 유지 |

---

## 9. Future (이번 범위 제외)
- 적립금(`points` 원장)과 회원 등급 — 결제 금액 계산 규칙이 쿠폰과 얽히므로 쿠폰 안정화 이후 별도 PRD.
- 네이버·카카오 로그인, 부분 취소·교환/반품 프로세스, 관리자 역할 세분화, 택배사 실시간 조회 API, 최근 본 상품·인기 랭킹, 실결제(라이브 키) 전환.

---

## 10. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| 승인 API 호출 후 DB 갱신 실패(불일치) | 결제됐는데 `pending` | 웹훅으로 재동기화, `order_events`와 함수 로그로 추적, 멱등 처리 |
| 재고 동시성 | 초과 판매 | `select ... for update` 행 잠금 + `check (stock >= 0)` |
| 배송비/할인 규칙 중복 정의 | 화면 금액과 결제금액 불일치 | `create_order`와 `common.js` 동시 수정 원칙, 최종 금액은 항상 서버 반환값 사용 |
| RLS 누락 | 데이터 노출 | 테이블별 정책 리뷰 + `get_advisors` 점검을 완료 조건에 포함 |
| 대시보드 집계 부하 | 관리자 화면 지연 | 인덱스, 필요 시 머티리얼라이즈드 뷰 |
| Supabase 대시보드 수동 설정 누락 (Google OAuth, SMTP, 리다이렉트 URL) | 로그인/메일 미동작 | 체크리스트를 릴리스 절차에 포함 |

---

## 11. 완료 정의 (Definition of Done)
- [x] 마이그레이션 파일이 `supabase/migrations/`에 번호 순으로 기록되고 실제 DB에 적용됨 (Phase 1~3: 004~009)
- [x] 신규 테이블 RLS 활성 + 정책 검증, `get_advisors` 점검 (남은 경고는 §12의 의도된 항목뿐)
- [ ] 기능별 수용 기준을 브라우저에서 직접 확인(테스트 도구가 없으므로 수동 시나리오 기록) — 비로그인 화면과 결제 흐름은 확인, 로그인 필요 화면은 SQL 시뮬레이션으로 대체(§12)
- [x] 결제 승인은 토스 테스트 환경에서 end-to-end 확인, 취소는 토스 취소 API 호출과 DB 처리를 각각 확인 (함수 경유 UI 취소는 미확인)
- [x] `CLAUDE.md`(아키텍처, 새 테이블/RPC/Edge Function, 규칙)를 변경 사항에 맞게 갱신 (Phase 1~3)

---

## 12. 구현 현황 (2026-10-20 기준)

### 12.1 단계별 상태
| 단계 | 상태 | 비고 |
|---|---|---|
| Phase 1 (F1~F4) | 구현 완료 | 마이그레이션 `004`, Edge Function `confirm-payment`·`cancel-payment` |
| Phase 2 (F5~F8) | 구현 완료 | `006`, `007`(상태 전이 검사 수정), Edge Function `send-email`. 메일은 `RESEND_API_KEY` 설정 후 동작 |
| Phase 3 (F9~F14) | 구현 완료 | `008`, `009`, Edge Function `delete-account`. Google 로그인은 대시보드 설정 후 동작 |
| Phase 4 (F15~F20) | 구현 완료 | 마이그레이션 `010`, 쿠폰·Q&A·배너/공지/FAQ·대시보드·감사 로그·CSV/일괄 처리 |

### 12.2 PRD와 달라진 점 / 추가된 결정
- **마이그레이션 번호**: §5 초안의 번호(004~009)와 실제가 다르다. 실제: 004 결제·재고, 005 가입 자동 인증, 006 이미지·배송·Realtime, 007 상태 전이 검사 수정, 008 찜·장바구니·배송지·리뷰·검색, 009 FK 인덱스. Phase 4는 `010`부터.
- **이메일 인증 제거(요구 추가)**: 가입·로그인은 비밀번호 인증만 사용한다. DB 트리거 `auto_confirm_email`로 가입 즉시 인증 처리하고 가입 직후 자동 로그인한다. 이메일 소유 검증이 없으므로 타인 이메일로도 가입할 수 있다(대시보드 "Confirm email"도 끌 수 있다).
- **상태 전이 검사**: 클라이언트가 직접 바꿀 수 있는 전이는 관리자의 `paid→shipping→delivered`뿐이고 `shipping`에는 택배사·운송장이 필수다. 취소·실패·결제완료는 서비스 롤/RPC 경로로만 일어난다(security invoker 트리거 `orders_transition_guard`).
- **재고 초기값**: 기존 상품은 사이즈별 10개로 시작했고, 새 상품은 관리자 폼에서 입력한다(기본 입력값 10).
- **`mark_order_failed`**: 결제창을 닫은 클라이언트가 호출해야 해서 비회원도 호출할 수 있다. 대상은 `pending` 주문뿐이다.
- **토스 시크릿 키**: 함수 secret `TOSS_SECRET_KEY`가 없으면 토스 문서의 공개 테스트 키로 대체하며 `test_`가 아니면 거부한다.
- **이미지 변환**: Storage 이미지 변환은 Pro 플랜 기능이라 사용하지 않고 원본을 지연 로딩한다(§F5의 썸네일 요구는 미충족).
- **웹훅**: `payment-webhook`(선택)은 구현하지 않았다. 승인 후 DB 갱신 실패는 함수 로그로만 추적한다.
- **로그아웃 시 장바구니**: 공용 PC 보호를 위해 로컬 장바구니를 비운다(§F12의 "캐시 유지"는 로그인 상태에서만 적용).
- **리뷰 집계**: 첫 후기가 달리면 `rating`/`reviews`가 실제 후기 기준으로 재계산되어 기존 더미 값은 사라진다.
- **탈퇴 제한**: 진행 중 주문(`pending`/`paid`/`shipping`)이 있거나 관리자인 계정은 탈퇴할 수 없다. 후기·찜·장바구니·배송지는 삭제되고 주문은 `user_id`만 null이 된다. 개인정보 마스킹 배치는 아직 없다(§8-5).

### 12.2.1 Phase 4 구현 메모
- **쿠폰**: 결제 화면에서 코드 직접 입력(`validate_coupon` 표시용, 실제 할인은 `create_order(p_items, p_customer, p_coupon_code)`). `user_coupons`(보유) 테이블은 만들지 않았다. 로그인 회원만 사용 가능, 실패/취소/만료 시 `orders_status_guard`가 사용 이력을 `restored`로 되돌린다. 배송비·할인 규칙은 `create_order`와 `calcOrder(items, couponDiscount)` 두 곳.
- **Q&A**: 비밀글은 RLS로 작성자·관리자에게만 조회되어 다른 사용자 목록에는 행 자체가 보이지 않는다.
- **감사 로그**: 상품·재고·쿠폰은 관리자가 한 변경만, 주문 상태·회원 권한/상태는 항상 기록(`audit_row` 트리거). 수정/삭제 권한 없음.
- **대시보드**: `admin_dashboard(from, to, unit)`(security invoker, 관리자 전용). 매출은 paid~delivered, 취소는 취소율에만 사용, 기준일은 결제일(KST).
- **일괄 처리**: 같은 상태 주문만 다음 단계로(배송 시작은 택배사 1회 + 주문별 운송장 입력).
- 시뮬레이션 확인(롤백): 정률 할인·1인 한도·실패 시 복구·복구 후 재사용. 브라우저 확인: 공지/FAQ/상품 Q&A 화면 렌더. **미확인**: 로그인 후 관리자 화면 클릭 흐름, 배너 업로드, 결제 화면 쿠폰 적용 UI.

### 12.3 남은 수동 작업 (릴리스 체크리스트)
- [ ] Supabase 함수 secret `RESEND_API_KEY`(필요 시 `EMAIL_FROM`) 등록 → 주문·배송·취소 메일 동작
- [ ] Google OAuth 클라이언트 생성 + Supabase Providers에서 Google 활성화 + 리다이렉트 URL 등록
- [ ] 필요 시 SMTP 설정(비밀번호 재설정 메일 발송 한도)
- [ ] 로그인이 필요한 화면(마이페이지, 관리자 상품·이미지·배송·후기, 장바구니 동기화, 탈퇴)을 사람이 직접 확인
- [ ] 대시보드의 "Leaked password protection" 활성화
- [ ] 관리자로 로그인해 쿠폰 등록 → 결제 화면 적용, 배너·공지·FAQ 등록, Q&A 답변, 대시보드, CSV, 일괄 배송 처리를 직접 확인

### 12.4 확인한 범위
- **직접 확인(브라우저·함수 호출)**: 토스 테스트 결제 승인, 승인 재호출 멱등, 잘못된 paymentKey 거부, 상품·검색·필터 화면, 로그인 화면의 비밀번호 찾기·Google 안내, 익명 업로드/호출 거부.
- **SQL 시뮬레이션(롤백)**: 재고 차감·초과 판매 차단·복구·만료, 상태 전이 제한, 찜·배송지·장바구니 병합·리뷰 정책과 집계, 검색 오타 허용.
- **미확인**: 로그인이 필요한 화면의 실제 클릭 흐름, 이미지 실제 업로드, 메일 발송, Realtime 토스트.
