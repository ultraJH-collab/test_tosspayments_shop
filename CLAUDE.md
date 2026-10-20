# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

무신사 스타일의 패션 쇼핑몰 "FITROOM" 퍼블리싱 프로젝트. 빌드 도구·프레임워크·패키지 없이 순수 HTML/CSS/JS로 작성되었고, 결제는 **토스페이먼츠 결제위젯 v2 테스트 환경**에만 연동되어 있다. 백엔드는 **Supabase**(회원 인증, 상품, 주문)이며 별도 서버 코드는 없다.

## 실행

결제위젯은 `file://`에서 동작하지 않으므로 반드시 HTTP로 띄운다. 별도 의존성 없이 돌아가도록 PowerShell `HttpListener` 기반 정적 서버를 사용한다. (Node.js LTS는 `C:\Program Files\nodejs`에 설치되어 있지만 프로젝트는 Node에 의존하지 않는다.)

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1            # http://localhost:8080
powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
```

- Claude 브라우저 미리보기는 `.claude/launch.json`의 `shop` 구성(포트 8080)으로 시작한다.
- 빌드·린트·테스트 도구는 없다. 검증은 브라우저에서 직접 확인한다.
- Git은 `C:\Program Files\Git\cmd\git.exe`에 설치되어 있다(winget). 셸 PATH에 없으면 전체 경로를 쓴다. 원격: `https://github.com/ultraJH-collab/test_tosspayments_shop` (`main`).

## 아키텍처

### 스크립트 로드 순서 (모든 페이지 공통)
`js/data.js` → supabase-js CDN(`@supabase/supabase-js@2.45.4` UMD) → `js/db.js` → `js/common.js` → 페이지 전용 스크립트. 모듈 시스템 없이 전역 함수/상수를 공유하므로 이 순서가 깨지면 `findProduct is not defined` 같은 오류가 난다. 새 페이지를 만들 때도 이 다섯 줄을 그대로 쓴다.

- `js/data.js`: `CATEGORIES`(tops/pants/shoes), 빈 `PRODUCTS` 배열, `findProduct(id)`. `SEED_PRODUCTS`는 Supabase 연결 실패 시 대체 데이터.
- `js/db.js`: Supabase 클라이언트 `sb`, `Auth`(user/profile/isAdmin), `ORDER_STATUS` 라벨, `App.ready`(세션 → 판매중 상품을 `PRODUCTS`에 로드), `onReady(fn)`, `loginUrl()`, `signOut()`.
- **페이지 스크립트는 `DOMContentLoaded` 대신 `onReady`로 시작한다.** 상품이 비동기로 로드되므로 그 전에는 `PRODUCTS`가 비어 있다.
- `js/common.js`: 헤더/푸터를 `#site-header`, `#site-footer`에 JS로 렌더링, 가격 포맷(`won`, `num`), `Cart`(localStorage), `calcOrder`(합계·할인·배송비 계산), `productImage`(카테고리별 SVG 일러스트), `productCard`, `toast`.
- 현재 메뉴 활성화는 `<body data-page="...">` 값으로 결정된다. `product.html`은 상품 카테고리를 읽은 뒤 `renderHeader(p.cat)`로 헤더를 다시 그린다.

### 페이지 구성
- `tops.html` / `pants.html` / `shoes.html`: `data-page`만 다른 동일 마크업이며 모두 `js/list.js`를 사용한다. 하나를 수정하면 나머지 두 파일도 같이 맞춰야 한다.
- `product.html?id=<상품ID>`: 단일 상세 템플릿 + `js/product.js`.
- `cart.html` → `checkout.html` → `success.html` / `fail.html`.
- `login.html`(로그인/회원가입 탭, `?tab=signup`, `?next=<같은 폴더 .html>`), `mypage.html`(회원정보 수정 + 주문내역), `admin.html` + `js/admin.js`(상품 / 회원 / 주문 관리 탭, `#products|#members|#orders`).

### Supabase
- 프로젝트: `fitroom-shop` (ref `fnzrwjiiwcstilaxiish`, ap-northeast-2). `js/db.js`에는 **publishable 키만** 둔다. 권한은 전부 RLS로 강제하며, 화면 단 관리자 체크는 UX용이다.
- 스키마 기록: `supabase/migrations/*.sql` (Supabase MCP `apply_migration`으로 적용한 것과 동일). 스키마를 바꾸면 새 번호 파일을 추가하고 같은 내용을 적용한다.
- 테이블: `product_stock`(사이즈별 재고), `order_events`(주문 상태 이력), `product_images`(Storage `product-images` 경로, 정렬순), `wishlists`·`cart_items`·`addresses`(본인만, RLS), `reviews`(delivered 주문 항목당 1회·숨김은 관리자), `profiles`(auth.users 가입 시 트리거로 생성, `role` user/admin, `status` active/blocked), `products`, `orders`, `order_items`(주문 당시 상품 스냅샷, products FK 없음).
- `is_admin()`이 RLS의 기준. 일반 회원은 자기 `role`/`status`를 바꿀 수 없고(트리거 `protect_profile_fields`), 관리자는 자기 권한을 내릴 수 없다. SQL 편집기(auth.uid() 없음)에서는 자유롭게 바꿀 수 있다.
- 주문은 클라이언트가 insert하지 않고 RPC로만 만든다: `create_order(p_items, p_customer)`가 DB 상품가로 금액·배송비·주문명을 계산해 `pending` 주문을 만들고 `{order_id, order_name, amount}`를 돌려준다 → `success.html`이 Edge Function `confirm-payment`를 호출(토스 승인 API → 서비스 롤로 `mark_order_paid`, 일반 사용자 호출 불가), 실패/위젯 닫힘은 `mark_order_failed(order_id, reason)`. `create_order`는 `product_stock`을 조건부 UPDATE로 차감(재고 부족 시 예외)하고, 재고 복구·`order_events` 기록·상태 전이 검증은 `orders_status_guard` 트리거가 맡는다(클라이언트 직접 변경은 관리자의 paid→shipping→delivered만 허용하며 이 검사는 security **invoker** 트리거 `orders_transition_guard`가 한다 — definer 트리거 안에서는 `current_user`가 소유자라 역할 검사가 불가능하다. 배송중 전환엔 `courier`/`tracking_no` 필수). `pg_cron`이 매분 `expire_pending_orders()`로 10분 지난 pending을 failed 처리. 취소는 Edge Function `cancel-payment`(소유자/관리자 검증 → 토스 취소 → `cancel_order_db`). **배송비·쿠폰 할인 규칙은 `create_order`와 `common.js`(`calcOrder`) 두 곳에 있으므로 함께 바꾼다.**
- 관리자 지정: 회원가입 후 SQL로 `update public.profiles set role = 'admin' where email = '...';`
- 이메일 인증/리다이렉트 URL은 Supabase 대시보드 Authentication 설정에서 관리한다(MCP로 변경 불가).

### 상품 이미지
실제 이미지 파일이 없고, `productImage(p, variant)`가 상품의 `color`/`tone`과 카테고리별 SVG path(`SHAPES`)로 그린다. 실제 사진으로 교체할 때는 이 함수만 바꾸면 카드·상세·장바구니·결제 화면에 모두 반영된다.

### 장바구니 / 주문 상태
- `localStorage.fr_cart`: 장바구니 `[{id, size, qty}]`.
- `sessionStorage.fr_buynow`: 상세 페이지 "구매하기"로 바로 결제할 상품. `checkout.html?mode=buynow`일 때 장바구니 대신 사용.
- `sessionStorage.fr_pending_order`: 결제 요청 직전에 저장하는 `{orderId, orderName, amount, mode, items}`(orderId/amount는 `create_order` 결과). `success.html`이 리다이렉트 파라미터(`orderId`, `amount`)와 비교하고 DB(`mark_order_paid`)로 한 번 더 확인한 뒤, `mode === "cart"`면 장바구니를 비운다.
- 배송비 규칙: `SHIPPING_FREE_OVER`(50,000원) 이상 무료, 미만 `SHIPPING_FEE`(3,000원). `calcOrder`에서만 계산한다.

### Phase 3 (구매 경험)
- 찜: `Wish`(db.js) + 카드의 `.wish-btn`(common.js 이벤트 위임). `products.likes`는 `wishlists` 트리거로만 변한다. 비회원은 `loginUrl()`로 이동.
- 장바구니: 로그인 직후 `Cart.mergeOnLogin()`이 `merge_cart` RPC로 병합(합산, 상한 99)하며 `App.ready`에 이어 붙어 있어 페이지 스크립트는 병합 후 실행된다. 이후 `Cart.save`가 `set_cart`로 서버에 반영. 병합 완료 표시는 `sessionStorage.fr_cart_merged`(**raw 문자열**, storeSet 금지). 로그아웃 시 로컬 장바구니를 비운다.
- 리뷰: `reviews` RLS가 "본인의 delivered 주문 항목"만 insert 허용, `rating/reviews`는 트리거 집계(숨김 제외). 사진은 `review-images/{user_id}/...`. 관리자 후기 탭에서 숨김/삭제.
- 검색/필터: `search_products(q)` RPC(pg_trgm, 오타 완화). `js/list.js`가 tops/pants/shoes/search 공용이며 필터·정렬 UI를 `.toolbar` 뒤에 주입한다(HTML은 data-page만 다르게). `search.html`은 tops.html 복사본.
- 배송지: `addresses`(최대 10, 기본 1개는 트리거). 결제 화면에서 선택/저장, 주문은 스냅샷.
- 계정: 로그인 화면의 Google 버튼(provider 활성화 여부를 `/auth/v1/settings`로 먼저 확인), 비밀번호 재설정(`reset-password.html`), 마이페이지 비밀번호 변경·탈퇴(Edge Function `delete-account` — 진행 중 주문·관리자는 거부). Google OAuth 클라이언트와 리다이렉트 URL은 대시보드 수동 설정.

### Phase 4 (성장·관리, 마이그레이션 010)
- 쿠폰: `coupons`(관리자만 직접 접근), `coupon_redemptions`(used/restored). `create_order(p_items, p_customer, p_coupon_code)`가 `coupon_apply`로 검증·할인 계산(한도 경쟁은 쿠폰 행 잠금), 결제 화면은 `validate_coupon` RPC로 표시만 한다. 할인은 상품금액에만, 무료배송은 할인 후 금액 기준. 취소·실패·만료 시 `orders_status_guard`가 쿠폰 복구.
- `product_questions`(비밀글 RLS, 답변은 관리자만 `answer` 컬럼 update), `banners`(노출 기간 RLS, Storage `banners`), `notices`, `faqs`. 페이지: `notice.html`, `faq.html`(`js/content.js`), 홈 배너, 상품 상세 Q&A.
- `audit_logs`: `audit_row()` 트리거로만 기록, 관리자 조회 전용. `admin_dashboard(from,to,unit)` RPC가 대시보드 집계. 관리자 탭: Q&A / 쿠폰 / 배너·공지·FAQ / 매출 대시보드 / 감사 로그, 상품·회원·주문 CSV 내보내기(`downloadCsv`), 주문 일괄 다음 단계.

### SEO / AEO / GEO
- `js/seo.js`(common.js 다음에 로드, 모든 페이지): canonical·og:url·og:site_name 자동 설정, 홈 Organization+WebSite(SearchAction) JSON-LD, 카테고리 CollectionPage+ItemList, 상품 상세 Product(가격·재고·실제 후기 기반 AggregateRating/Review)+BreadcrumbList+답변된 공개 Q&A의 FAQPage(`SEO.product`, product.js가 후기/Q&A 로드 후 갱신). `faq.html`은 content.js가 FAQPage JSON-LD 생성. 정적 description/OG/robots 메타는 각 HTML `<head>`에 있다(새 페이지도 추가).
- 비공개 페이지(cart/checkout/success/fail/login/mypage/admin/reset-password)는 `noindex,nofollow`, search는 `noindex,follow`.
- `robots.txt`(주요 AI 크롤러 허용), `sitemap.xml`(고정 페이지+상품 24개, **상품을 추가/삭제하면 직접 갱신**), `llms.txt`. 이 세 파일의 절대 주소는 GitHub Pages 주소(`https://ultrajh-collab.github.io/test_tosspayments_shop`)를 가정한 값이며, 도메인이 다르면 바꾼다. 프로젝트 하위 경로 배포에서는 robots.txt가 도메인 루트에 있어야 적용된다.
- 한계: 상품/목록은 JS로 렌더링되므로 JS를 실행하지 않는 크롤러는 정적 HTML(메타, 홈 h1/noscript)만 본다.

### 이미지 / 배송 / 알림
- `productImage(p, variant)`: `p.images[variant]`(db.js가 `product_images`에서 로드)가 있으면 `<img>`(Storage 공개 URL, 변환은 Pro 플랜 기능이라 원본 사용), 없으면 SVG 폴백. 관리자 상품 폼에서 업로드/순서/삭제(Storage RLS는 관리자만).
- 마이페이지 주문 카드에 결제완료→배송중→배송완료 타임라인과 운송장 링크(`COURIERS`/`trackingUrl`, db.js). 관리자 주문 탭은 Realtime(`orders`)으로 갱신·토스트.
- Edge Function `send-email`(Resend, secret `RESEND_API_KEY`, 선택 `EMAIL_FROM`): confirm/cancel-payment가 서비스 롤 키로, 관리자가 배송 시작 시 JWT로 호출. 키가 없으면 발송을 건너뛴다. 인증 메일 SMTP는 대시보드 수동 설정.
- 회원가입은 이메일 인증 없음: `auto_confirm_email` 트리거(005)가 가입 즉시 인증 처리.

### 토스페이먼츠 연동 (`js/checkout.js`)
- SDK: `https://js.tosspayments.com/v2/standard` (checkout.html에서 로드).
- `TOSS_CLIENT_KEY`는 토스 문서에 공개된 결제위젯 테스트 키(`test_gck_docs_...`). `test_`로 시작하지 않으면 결제를 막도록 되어 있다 — 테스트 환경 전용이라는 요구사항이므로 이 가드를 유지한다.
- 흐름: `TossPayments(key).widgets({customerKey: 회원이면 Auth.user.id, 아니면 ANONYMOUS})` → `setAmount` → `renderPaymentMethods` + `renderAgreement` → 결제 버튼 클릭 시 `sb.rpc("create_order")` → `requestPayment({orderId, orderName, successUrl, failUrl, ...})`.
- `successUrl`/`failUrl`은 현재 경로 기준으로 계산하므로 하위 경로에 배포해도 동작한다.
- **결제 승인/취소는 Edge Function**(`supabase/functions/confirm-payment`, `cancel-payment`, verify_jwt=false — 취소는 함수 안에서 토큰 검증). 시크릿 키는 함수 secret `TOSS_SECRET_KEY`에서만 읽고, 미설정이면 토스 문서 공개 테스트 키로 폴백하며 `test_`가 아니면 거부한다. 내 상점 키를 쓰려면 secret을 설정한다. 함수는 MCP `deploy_edge_function`으로 배포하며 소스는 `supabase/functions/`에 기록한다. 웹훅(`payment-webhook`)은 아직 없다.

## MCP

`.mcp.json`에 `tosspayments-integration-guide`(`npx -y @tosspayments/integration-guide-mcp@latest`, Windows용 `cmd /c` 래핑)가 설정되어 있다. Node.js가 설치되어 있어야 연결되며, 토스페이먼츠 연동 코드를 수정할 때 이 서버의 공식 가이드를 우선 참고한다.
