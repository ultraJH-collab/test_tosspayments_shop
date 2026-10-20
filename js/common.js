/* 공통: 헤더/푸터, 포맷, 장바구니, 상품 이미지/카드 (js/db.js 다음에 로드) */
// 배송비 규칙은 DB 함수 create_order와 같아야 한다(실제 결제 금액은 DB가 계산).
const SHIPPING_FREE_OVER = 50000;
const SHIPPING_FEE = 3000;

const won = (n) => n.toLocaleString("ko-KR") + "원";
const num = (n) => n.toLocaleString("ko-KR");
const discountRate = (p) => Math.round((1 - p.sale / p.price) * 100);
const compact = (n) => (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, "") + "만" : num(n));
const qs = (key) => new URLSearchParams(location.search).get(key);
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 스토리지 (실패해도 동작하도록) ---------- */
function storeGet(storage, key, fallback) {
  try {
    const v = storage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function storeSet(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

/* ---------- 장바구니 ---------- */
const Cart = {
  KEY: "fr_cart",
  items() {
    return storeGet(localStorage, this.KEY, []).filter((i) => findProduct(i.id));
  },
  save(items) {
    storeSet(localStorage, this.KEY, items);
    updateCartBadge();
    this.push(items);
  },
  // 로그인 회원은 변경을 서버 장바구니에 반영한다(연속 변경은 묶어서 한 번만).
  push(items) {
    if (!Auth.user || !sb || !sessionStorage.getItem("fr_cart_merged")) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => sb.rpc("set_cart", { p_items: items }).then(({ error }) => error && console.warn("장바구니 동기화 실패", error.message)), 400);
  },
  // 로그인 직후 1회: 로컬 장바구니를 서버와 합치고(수량 합산, 상한 99) 결과를 로컬 캐시로 둔다.
  async mergeOnLogin() {
    if (!Auth.user || !sb || sessionStorage.getItem("fr_cart_merged") === Auth.user.id) return;
    const { data, error } = await sb.rpc("merge_cart", { p_items: storeGet(localStorage, this.KEY, []) });
    if (error) return console.warn("장바구니 병합 실패", error.message);
    storeSet(localStorage, this.KEY, data);
    try { sessionStorage.setItem("fr_cart_merged", Auth.user.id); } catch (e) {}
    updateCartBadge();
  },
  add(id, size, qty) {
    const items = this.items();
    const found = items.find((i) => i.id === id && i.size === size);
    if (found) found.qty = Math.min(99, found.qty + qty);
    else items.push({ id, size, qty });
    this.save(items);
  },
  count() {
    return this.items().reduce((s, i) => s + i.qty, 0);
  },
};

function calcOrder(items) {
  const lines = items.map((i) => {
    const p = findProduct(i.id);
    return { ...i, product: p, lineTotal: p.sale * i.qty, lineOrigin: p.price * i.qty };
  });
  const origin = lines.reduce((s, l) => s + l.lineOrigin, 0);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shipping = subtotal === 0 || subtotal >= SHIPPING_FREE_OVER ? 0 : SHIPPING_FEE;
  return { lines, origin, discount: origin - subtotal, subtotal, shipping, total: subtotal + shipping };
}

/* ---------- 상품 이미지 (SVG 일러스트) ---------- */
const SHAPES = {
  tops:
    '<path d="M140 110 L98 126 L52 178 L90 218 L122 196 L122 392 L278 392 L278 196 L310 218 L348 178 L302 126 L260 110 Q200 152 140 110 Z"/>' +
    '<path d="M140 110 Q200 152 260 110" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="4"/>',
  pants:
    '<path d="M134 96 L266 96 L288 404 L214 404 L200 206 L186 404 L112 404 Z"/>' +
    '<path d="M134 122 L266 122" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="4"/>',
  shoes:
    '<path d="M66 330 L66 268 Q72 238 108 232 L168 222 Q198 196 232 202 L262 214 Q292 250 334 264 Q362 274 362 302 L362 330 Z"/>' +
    '<path d="M60 330 L368 330 L368 350 Q368 360 356 360 L72 360 Q60 360 60 350 Z" fill="#fafafa" stroke="rgba(0,0,0,.15)" stroke-width="2"/>' +
    '<path d="M182 232 L214 262 M200 222 L232 252 M218 214 L246 240" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="5" stroke-linecap="round"/>',
};

// Storage 공개 URL. (이미지 변환 /render/image 는 Pro 플랜 기능이라 원본을 쓰고 lazy 로딩한다.)
function imageUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/product-images/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function productImage(p, variant = 0) {
  // 업로드된 이미지가 있으면 <img>, 없거나 해당 순번이 없으면 기존 SVG 일러스트로 폴백한다.
  const path = p.images && p.images[variant];
  if (path) return `<img class="pimg" src="${escapeHtml(imageUrl(path))}" alt="${escapeHtml(p.name)}" loading="lazy" />`;
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c) ? c : d);
  const bgs = [hex(p.tone, "#f2f2f2"), "#f4f4f4", "#e9e9e9", "#ffffff"];
  const scale = [1, 1.25, 0.85, 1][variant % 4];
  const t = `translate(200 250) scale(${scale}) translate(-200 -250)`;
  return (
    `<svg viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(p.name)}">` +
    `<rect width="400" height="500" fill="${bgs[variant % 4]}"/>` +
    `<g transform="${t}" fill="${hex(p.color, "#888888")}" stroke="rgba(0,0,0,.12)" stroke-width="2">${SHAPES[p.cat]}</g>` +
    `</svg>`
  );
}

function priceHtml(p) {
  const rate = discountRate(p);
  return (
    `<div class="price">` +
    (rate > 0 ? `<span class="rate">${rate}%</span>` : "") +
    `<span class="sale">${num(p.sale)}원</span></div>`
  );
}

function productCard(p, rank) {
  return `
    <li class="card">
      <a href="product.html?id=${p.id}">
        <div class="card-thumb">
          ${productImage(p)}
          ${rank ? `<span class="rank">${rank}</span>` : ""}
          ${p.tag ? `<span class="badge badge-${p.tag.toLowerCase()}">${p.tag}</span>` : ""}
          <button type="button" class="wish-btn${Wish.has(p.id) ? " on" : ""}" data-wish="${p.id}" aria-label="찜하기">♥</button>
          ${isSoldOut(p) ? `<span class="soldout-mask">품절</span>` : ""}
        </div>
        <div class="card-info">
          <p class="brand">${escapeHtml(p.brand)}</p>
          <p class="name">${escapeHtml(p.name)}</p>
          ${priceHtml(p)}
          <p class="meta"><span class="heart">♥</span> ${compact(p.likes)} <span class="star">★</span> ${p.rating} (${num(p.reviews)})</p>
        </div>
      </a>
    </li>`;
}

/* ---------- 헤더 / 푸터 ---------- */
function renderHeader(active) {
  const nav = [
    { key: "home", label: "홈", href: "index.html" },
    { key: "tops", label: "상의", href: "tops.html" },
    { key: "pants", label: "바지", href: "pants.html" },
    { key: "shoes", label: "신발", href: "shoes.html" },
  ];
  const el = document.getElementById("site-header");
  if (!el) return;
  el.innerHTML = `
    <div class="topbar">
      <div class="inner topbar-inner">
        <a href="index.html" class="logo">FITROOM</a>
        <form class="search" action="search.html" method="get">
          <input type="search" name="q" value="${escapeHtml(qs("q") || "")}" placeholder="브랜드, 상품명 검색" aria-label="검색" />
          <button type="submit" aria-label="검색">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          </button>
        </form>
        <div class="top-actions">
          ${
            Auth.user
              ? (Auth.isAdmin ? `<a href="admin.html" class="ta ta-admin">관리자</a>` : "") +
                `<a href="mypage.html#wish" class="ta" aria-label="찜한 상품">♥ 찜</a>` +
                `<a href="mypage.html" class="ta">${escapeHtml(Auth.displayName())}님</a>` +
                `<button type="button" class="ta" id="btn-logout">로그아웃</button>`
              : `<a href="${loginUrl()}" class="ta">로그인</a><a href="login.html?tab=signup" class="ta">회원가입</a>`
          }
          <a href="cart.html" class="ta cart-link">장바구니<span class="cart-badge" id="cart-badge">0</span></a>
        </div>
      </div>
    </div>
    <nav class="gnb">
      <div class="inner gnb-inner">
        ${nav.map((n) => `<a href="${n.href}" class="${n.key === active ? "on" : ""}">${n.label}</a>`).join("")}
        <span class="gnb-sub">랭킹</span><span class="gnb-sub">세일</span><span class="gnb-sub">브랜드</span>
      </div>
    </nav>`;
  const logout = document.getElementById("btn-logout");
  if (logout) logout.onclick = signOut;
  updateCartBadge();
}

function updateCartBadge() {
  const b = document.getElementById("cart-badge");
  if (!b) return;
  const c = Cart.count();
  b.textContent = c;
  b.hidden = c === 0;
}

function renderFooter() {
  const el = document.getElementById("site-footer");
  if (!el) return;
  el.innerHTML = `
    <div class="inner footer-inner">
      <div class="footer-links">
        <a href="#">회사소개</a><a href="#">이용약관</a><a href="#"><b>개인정보처리방침</b></a><a href="#">고객센터</a>
      </div>
      <p>FITROOM (퍼블리싱 데모) · 이 사이트의 결제는 토스페이먼츠 <b>테스트 환경</b>에서만 처리되며 실제로 청구되지 않습니다.</p>
      <p class="copy">© FITROOM. All rights reserved.</p>
    </div>`;
}

function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2000);
}

// 카드의 찜 버튼(이벤트 위임). 링크 이동을 막고 토글한다.
document.addEventListener("click", async (e) => {
  const b = e.target.closest(".wish-btn");
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const on = await Wish.toggle(b.dataset.wish);
  if (on === null) return;
  document.querySelectorAll(`.wish-btn[data-wish="${b.dataset.wish}"]`).forEach((x) => x.classList.toggle("on", on));
  toast(on ? "찜 목록에 추가했어요." : "찜을 취소했어요.");
});

document.addEventListener("DOMContentLoaded", () => {
  renderHeader(document.body.dataset.page || "");
  renderFooter();
});
// 로그인 직후 장바구니 병합이 끝난 뒤에 페이지 스크립트가 실행되도록 ready 를 이어 붙인다.
App.ready = App.ready.then(() => Cart.mergeOnLogin()).catch((e) => console.warn(e));
// 세션/상품 로드 후 로그인 상태와 장바구니 수량을 반영해 다시 그린다.
onReady(() => renderHeader(document.body.dataset.page || ""));
