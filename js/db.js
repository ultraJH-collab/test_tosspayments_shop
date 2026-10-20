/* Supabase 연동: 클라이언트, 상품 로드, 회원 세션 */

// 공개용(publishable) 키입니다. 브라우저에 노출되어도 되며, 데이터 접근은 DB의 RLS 정책으로 제한됩니다.
// service_role / secret 키는 절대 여기에 넣지 마세요.
const SUPABASE_URL = "https://fnzrwjiiwcstilaxiish.supabase.co";
const SUPABASE_KEY = "sb_publishable_Y0LpFr4-FHwJIIdhY0u7gA_savFZmPk";

const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const ORDER_STATUS = {
  pending: "결제대기",
  paid: "결제완료",
  shipping: "배송중",
  delivered: "배송완료",
  canceled: "주문취소",
  failed: "결제실패",
};

// 택배사 조회 링크(외부 링크만 제공, 실시간 API 연동은 하지 않는다)
const COURIERS = {
  "CJ대한통운": (n) => "https://trace.cjlogistics.com/next/tracking.html?wblNo=" + encodeURIComponent(n),
  "한진택배": (n) => "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=" + encodeURIComponent(n),
  "우체국택배": (n) => "https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=" + encodeURIComponent(n),
  "롯데택배": () => "https://www.lotteglogis.com/home/reservation/tracking/index",
  "로젠택배": () => "https://www.ilogen.com/web/personal/trace",
};
function trackingUrl(courier, no) {
  return COURIERS[courier] ? COURIERS[courier](no) : null;
}

/* ---------- 회원 세션 ---------- */
const Auth = {
  user: null,
  profile: null,
  get isAdmin() {
    return !!this.profile && this.profile.role === "admin" && this.profile.status === "active";
  },
  displayName() {
    return (this.profile && this.profile.name) || (this.user && this.user.email.split("@")[0]) || "";
  },
};

async function loadSession() {
  const { data } = await sb.auth.getSession();
  Auth.user = (data.session && data.session.user) || null;
  Auth.profile = null;
  if (!Auth.user) return;
  const { data: profile } = await sb.from("profiles").select("*").eq("id", Auth.user.id).maybeSingle();
  Auth.profile = profile || null;
  if (profile && profile.status === "blocked") {
    await sb.auth.signOut();
    Auth.user = Auth.profile = null;
    setTimeout(() => toast("이용이 정지된 계정입니다. 고객센터에 문의해 주세요."), 0);
  }
}

async function signOut() {
  await sb.auth.signOut();
  // 공용 PC에서 다음 사람에게 장바구니가 보이지 않도록 로컬 캐시를 비운다(서버 장바구니는 유지).
  try { localStorage.removeItem("fr_cart"); sessionStorage.removeItem("fr_cart_merged"); } catch (e) {}
  location.href = "index.html";
}

// 로그인이 필요한 페이지에서 호출: 로그인 후 현재 페이지로 돌아온다.
function loginUrl() {
  const page = location.pathname.split("/").pop() || "index.html";
  if (page === "login.html") return "login.html";
  return "login.html?next=" + encodeURIComponent(page + location.search);
}

/* ---------- 상품 ---------- */
async function loadProducts() {
  const [{ data, error }, { data: stockRows }, { data: imageRows }] = await Promise.all([
    sb.from("products").select("*").order("id"),
    sb.from("product_stock").select("product_id, size, stock"),
    sb.from("product_images").select("product_id, path").order("sort_order").order("id"),
  ]);
  // 상품별 이미지 경로(대표 1 + 상세 N, 정렬순)
  const images = {};
  (imageRows || []).forEach((r) => (images[r.product_id] = images[r.product_id] || []).push(r.path));
  if (error) throw error;
  // 상품별 사이즈 재고 { [size]: n }. 재고를 못 읽으면 stock 은 null(제한 없음으로 취급).
  const stock = {};
  (stockRows || []).forEach((r) => ((stock[r.product_id] = stock[r.product_id] || {})[r.size] = r.stock));
  // 관리자는 숨김 상품도 조회되지만, 매장 화면에는 판매중 상품만 보여준다.
  PRODUCTS.splice(0, PRODUCTS.length, ...data.filter((p) => p.is_active).map((p) => ({ ...p, rating: Number(p.rating), images: images[p.id] || [], stock: stockRows ? stock[p.id] || {} : null })));
}

// 사이즈 재고(stock이 null이면 알 수 없음 → 제한하지 않음). 실제 차감/검증은 create_order 가 한다.
function stockOf(p, size) {
  return p.stock ? p.stock[size] || 0 : Infinity;
}
function isSoldOut(p) {
  return !!p.stock && p.sizes.every((s) => stockOf(p, s) <= 0);
}

/* ---------- 찜(위시리스트) ---------- */
const Wish = {
  ids: new Set(),
  has(id) {
    return this.ids.has(id);
  },
  async load() {
    this.ids = new Set();
    if (!Auth.user) return;
    const { data } = await sb.from("wishlists").select("product_id");
    (data || []).forEach((r) => this.ids.add(r.product_id));
  },
  // 비회원은 로그인 화면으로 보낸다. 성공 시 새 찜 상태(true/false)를 돌려준다.
  async toggle(id) {
    if (!Auth.user) {
      location.href = loginUrl();
      return null;
    }
    const on = !this.has(id);
    const { error } = on
      ? await sb.from("wishlists").insert({ user_id: Auth.user.id, product_id: id })
      : await sb.from("wishlists").delete().eq("product_id", id);
    if (error) {
      toast(error.message);
      return this.has(id);
    }
    on ? this.ids.add(id) : this.ids.delete(id);
    return on;
  },
};

/* ---------- 앱 초기화 ---------- */
const App = {
  online: !!sb,
  ready: (async () => {
    if (!sb) {
      console.warn("Supabase SDK를 불러오지 못해 대체 상품 데이터로 표시합니다.");
      PRODUCTS.push(...SEED_PRODUCTS);
      return;
    }
    // 세션을 먼저 확인해야 관리자 여부에 맞는 RLS로 상품을 조회한다.
    try {
      await loadSession();
    } catch (e) {
      console.error("세션 확인 실패", e);
    }
    try {
      await Promise.all([loadProducts(), Wish.load()]);
    } catch (e) {
      console.error("상품 데이터를 불러오지 못했습니다.", e);
      App.online = false;
      PRODUCTS.push(...SEED_PRODUCTS);
    }
  })(),
};

// 페이지 스크립트는 DOMContentLoaded 대신 onReady로 시작한다(상품/세션 로드 이후 실행).
function onReady(fn) {
  document.addEventListener("DOMContentLoaded", () => App.ready.then(fn));
}

if (sb) {
  sb.auth.onAuthStateChange((event) => {
    // 다른 탭에서 로그인/로그아웃한 경우 헤더를 맞춘다. (콜백 안에서 바로 await하지 않는다)
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
      setTimeout(async () => {
        await loadSession().catch(() => {});
        renderHeader(document.body.dataset.page || "");
      }, 0);
    }
  });
}
