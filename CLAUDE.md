# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

무신사 스타일의 패션 쇼핑몰 "FITROOM" 퍼블리싱 프로젝트. 빌드 도구·프레임워크·패키지 없이 순수 HTML/CSS/JS로 작성되었고, 결제는 **토스페이먼츠 결제위젯 v2 테스트 환경**에만 연동되어 있다. 서버 코드는 없다.

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
`js/data.js` → `js/common.js` → 페이지 전용 스크립트. 모듈 시스템 없이 전역 함수/상수를 공유하므로 이 순서가 깨지면 `findProduct is not defined` 같은 오류가 난다.

- `js/data.js`: `CATEGORIES`(tops/pants/shoes)와 `PRODUCTS` 더미 데이터, `findProduct(id)`.
- `js/common.js`: 헤더/푸터를 `#site-header`, `#site-footer`에 JS로 렌더링, 가격 포맷(`won`, `num`), `Cart`(localStorage), `calcOrder`(합계·할인·배송비 계산), `productImage`(카테고리별 SVG 일러스트), `productCard`, `toast`.
- 현재 메뉴 활성화는 `<body data-page="...">` 값으로 결정된다. `product.html`은 상품 카테고리를 읽은 뒤 `renderHeader(p.cat)`로 헤더를 다시 그린다.

### 페이지 구성
- `tops.html` / `pants.html` / `shoes.html`: `data-page`만 다른 동일 마크업이며 모두 `js/list.js`를 사용한다. 하나를 수정하면 나머지 두 파일도 같이 맞춰야 한다.
- `product.html?id=<상품ID>`: 단일 상세 템플릿 + `js/product.js`.
- `cart.html` → `checkout.html` → `success.html` / `fail.html`.

### 상품 이미지
실제 이미지 파일이 없고, `productImage(p, variant)`가 상품의 `color`/`tone`과 카테고리별 SVG path(`SHAPES`)로 그린다. 실제 사진으로 교체할 때는 이 함수만 바꾸면 카드·상세·장바구니·결제 화면에 모두 반영된다.

### 장바구니 / 주문 상태
- `localStorage.fr_cart`: 장바구니 `[{id, size, qty}]`.
- `sessionStorage.fr_buynow`: 상세 페이지 "구매하기"로 바로 결제할 상품. `checkout.html?mode=buynow`일 때 장바구니 대신 사용.
- `sessionStorage.fr_pending_order`: 결제 요청 직전에 저장하는 `{orderId, orderName, amount, mode, items}`. `success.html`이 리다이렉트 파라미터(`orderId`, `amount`)와 비교해 금액 위변조를 확인하고, `mode === "cart"`면 장바구니를 비운다.
- 배송비 규칙: `SHIPPING_FREE_OVER`(50,000원) 이상 무료, 미만 `SHIPPING_FEE`(3,000원). `calcOrder`에서만 계산한다.

### 토스페이먼츠 연동 (`js/checkout.js`)
- SDK: `https://js.tosspayments.com/v2/standard` (checkout.html에서 로드).
- `TOSS_CLIENT_KEY`는 토스 문서에 공개된 결제위젯 테스트 키(`test_gck_docs_...`). `test_`로 시작하지 않으면 결제를 막도록 되어 있다 — 테스트 환경 전용이라는 요구사항이므로 이 가드를 유지한다.
- 흐름: `TossPayments(key).widgets({customerKey: ANONYMOUS})` → `setAmount` → `renderPaymentMethods` + `renderAgreement` → `requestPayment({orderId, orderName, successUrl, failUrl, ...})`.
- `successUrl`/`failUrl`은 현재 경로 기준으로 계산하므로 하위 경로에 배포해도 동작한다.
- **결제 승인 API(`POST /v1/payments/confirm`)는 미구현.** 시크릿 키가 필요해 서버에서 호출해야 하며, 호출하지 않으면 결제는 10분 후 만료된다. 서버를 추가한다면 `success.html`에서 `paymentKey`, `orderId`, `amount`를 서버로 넘겨 승인하도록 연결한다.

## MCP

`.mcp.json`에 `tosspayments-integration-guide`(`npx -y @tosspayments/integration-guide-mcp@latest`, Windows용 `cmd /c` 래핑)가 설정되어 있다. Node.js가 설치되어 있어야 연결되며, 토스페이먼츠 연동 코드를 수정할 때 이 서버의 공식 가이드를 우선 참고한다.
