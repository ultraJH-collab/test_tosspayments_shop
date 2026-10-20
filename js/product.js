/* 상품 상세 */
onReady(() => {
  const p = findProduct(qs("id"));
  if (!p) {
    document.getElementById("pd-root").innerHTML = `<div class="empty"><p>판매 중이 아니거나 존재하지 않는 상품입니다.</p><a class="btn btn-black" href="index.html">홈으로</a></div>`;
    return;
  }
  const cat = CATEGORIES[p.cat];
  document.body.dataset.page = p.cat;
  renderHeader(p.cat);
  SEO.product(p); // 제목·설명·Product JSON-LD(후기/Q&A는 로드 후 다시 반영)

  const $ = (id) => document.getElementById(id);
  const state = { size: null, qty: 1, view: 0 };

  $("crumb-cat").textContent = cat.name;
  $("crumb-cat").href = cat.page;
  $("pd-brand").textContent = p.brand;
  $("pd-brand").href = cat.page;
  $("pd-name").textContent = p.name;
  $("pd-review").innerHTML = `<span class="star">★</span> <b>${p.rating}</b> · 후기 ${num(p.reviews)}개 · <span style="color:#ff0000">♥</span> ${compact(p.likes)}`;
  const rate = discountRate(p);
  $("pd-origin").textContent = rate > 0 ? won(p.price) : "";
  $("pd-rate").textContent = rate > 0 ? rate + "%" : "";
  $("pd-sale").textContent = won(p.sale);
  $("pd-point").textContent = won(Math.floor(p.sale * 0.05));

  /* 갤러리 */
  function renderGallery() {
    const views = p.images && p.images.length ? p.images.map((_, i) => i) : [0, 1, 2, 3];
    $("thumbs").innerHTML = views
      .map((v) => `<button type="button" class="${v === state.view ? "on" : ""}" data-v="${v}" aria-label="이미지 ${v + 1}">${productImage(p, v)}</button>`)
      .join("");
    $("main-img").innerHTML = productImage(p, state.view);
  }
  $("thumbs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    state.view = Number(b.dataset.v);
    renderGallery();
  });
  renderGallery();

  /* 사이즈 */
  $("sizes").innerHTML = p.sizes
    .map((s) => `<button type="button" class="size-btn" data-size="${escapeHtml(s)}"${stockOf(p, s) <= 0 ? " disabled" : ""}>${escapeHtml(s)}${stockOf(p, s) <= 0 ? " (품절)" : ""}</button>`)
    .join("");
  $("sizes").addEventListener("click", (e) => {
    const b = e.target.closest(".size-btn");
    if (!b || b.disabled) return;
    state.size = b.dataset.size;
    setQty(state.qty);
    $("sizes").querySelectorAll(".size-btn").forEach((x) => x.classList.toggle("on", x === b));
  });

  /* 수량 */
  function setQty(n) {
    const max = state.size ? Math.min(99, stockOf(p, state.size)) : 99;
    state.qty = Math.max(1, Math.min(max, Number(n) || 1));
    $("qty").value = state.qty;
    $("pd-total").textContent = won(p.sale * state.qty);
  }
  $("qty-minus").onclick = () => setQty(state.qty - 1);
  $("qty-plus").onclick = () => setQty(state.qty + 1);
  $("qty").addEventListener("change", (e) => setQty(e.target.value));
  setQty(1);

  $("btn-like").classList.toggle("on", Wish.has(p.id));
  $("btn-like").onclick = async (e) => {
    const btn = e.currentTarget;
    const on = await Wish.toggle(p.id);
    if (on === null) return;
    btn.classList.toggle("on", on);
    toast(on ? "찜 목록에 추가했어요." : "찜을 취소했어요.");
  };

  function requireSize() {
    if (isSoldOut(p)) { toast("품절된 상품입니다."); return false; }
    if (state.size) return true;
    toast("사이즈를 선택해 주세요.");
    $("sizes").scrollIntoView({ behavior: "smooth", block: "center" });
    return false;
  }
  $("btn-cart").onclick = () => {
    if (!requireSize()) return;
    Cart.add(p.id, state.size, state.qty);
    toast("장바구니에 담았어요.");
  };
  $("btn-buy").onclick = () => {
    if (!requireSize()) return;
    storeSet(sessionStorage, "fr_buynow", [{ id: p.id, size: state.size, qty: state.qty }]);
    location.href = "checkout.html?mode=buynow";
  };

  /* 상세 정보 */
  $("detail-imgs").innerHTML = (p.images && p.images.length ? p.images.map((_, i) => i) : [0, 1, 2]).map((v) => productImage(p, v)).join("");
  $("detail-text").innerHTML =
    `${escapeHtml(p.brand)}의 ${escapeHtml(p.name)}입니다. 데일리로 활용하기 좋은 실루엣과 탄탄한 소재로 제작되었습니다.<br>` +
    `· 소재: ${p.cat === "shoes" ? "천연 가죽 / 러버 아웃솔" : "코튼 100%"}<br>· 제조국: 대한민국<br>· 세탁: 라벨의 세탁 방법을 확인해 주세요.`;

  /* 사이즈 표 */
  const sizeCols = p.cat === "shoes" ? ["사이즈", "발길이", "발볼"] : p.cat === "pants" ? ["사이즈", "총장", "허리단면", "허벅지단면", "밑단단면"] : ["사이즈", "총장", "어깨너비", "가슴단면", "소매길이"];
  $("size-table").innerHTML =
    `<thead><tr>${sizeCols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
    p.sizes
      .map((s, i) => {
        const vals = p.cat === "shoes" ? [Number(s) / 10 + 0.5, "보통"] : p.cat === "pants" ? [100 + i * 2, 36 + i * 2, 32 + i * 1.5, 22 + i] : [68 + i * 2, 50 + i * 2, 56 + i * 3, 22 + i];
        return `<tr><td><b>${escapeHtml(s)}</b></td>${vals.map((v) => `<td>${v}</td>`).join("")}</tr>`;
      })
      .join("") +
    `</tbody>`;

  /* 후기: 구매확정(delivered) 주문의 리뷰만 존재한다. 숨김 처리된 리뷰는 RLS로 일반 사용자에게 보이지 않는다. */
  const reviewImg = (path) => `${SUPABASE_URL}/storage/v1/object/public/review-images/${path.split("/").map(encodeURIComponent).join("/")}`;
  const rvState = { sort: "new", list: [] };
  let qnaRows = [];
  const seoRefresh = () => SEO.product(p, { reviews: rvState.list.filter((r) => !r.is_hidden), qna: qnaRows });
  function renderReviews() {
    const list = rvState.list.slice().sort(rvState.sort === "rating" ? (a, b) => b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at) : (a, b) => new Date(b.created_at) - new Date(a.created_at));
    const n = rvState.list.length;
    const avg = n ? rvState.list.reduce((s, r) => s + r.rating, 0) / n : 0;
    $("review-count").textContent = num(n);
    $("pd-review").innerHTML = `<span class="star">★</span> <b>${n ? avg.toFixed(1) : "-"}</b> · 후기 ${num(n)}개 · <span style="color:#ff0000">♥</span> ${compact(p.likes)}`;
    if (!n) return ($("reviews").innerHTML = `<p class="muted">아직 후기가 없습니다. 상품을 받으신 뒤 마이페이지 주문내역에서 후기를 작성할 수 있어요.</p>`);
    const dist = [5, 4, 3, 2, 1].map((s) => [s, rvState.list.filter((r) => r.rating === s).length]);
    $("reviews").innerHTML =
      `<div class="rv-summary"><div><div class="avg">${avg.toFixed(1)}</div><span class="star">${"★".repeat(Math.round(avg))}</span></div>
        <div class="rv-bars">${dist.map(([s, c]) => `<div><span>${s}점</span><i><b style="width:${(c / n) * 100}%"></b></i><span>${c}</span></div>`).join("")}</div>
        <select id="rv-sort" aria-label="후기 정렬"><option value="new" ${rvState.sort === "new" ? "selected" : ""}>최신순</option><option value="rating" ${rvState.sort === "rating" ? "selected" : ""}>별점순</option></select></div>` +
      list.map((v) => `<div class="review"><div class="r-top"><span class="star">${"★".repeat(v.rating)}${"☆".repeat(5 - v.rating)}</span><span>${escapeHtml(v.author)}</span><span>${new Date(v.created_at).toLocaleDateString("ko-KR")}</span>${v.is_hidden ? "<span class='pill'>숨김(나에게만 보임)</span>" : ""}</div><p>${escapeHtml(v.body)}</p>${
        v.image_paths.length ? `<div class="r-imgs">${v.image_paths.map((x) => `<img src="${escapeHtml(reviewImg(x))}" alt="후기 사진" loading="lazy" />`).join("")}</div>` : ""
      }</div>`).join("");
  }
  document.addEventListener("change", (e) => {
    if (e.target.id !== "rv-sort") return;
    rvState.sort = e.target.value;
    renderReviews();
  });
  $("reviews").innerHTML = `<p class="muted">후기를 불러오는 중...</p>`;
  (sb ? sb.from("reviews").select("*").eq("product_id", p.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] })).then(({ data, error }) => {
    if (error) return ($("reviews").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`);
    rvState.list = data;
    renderReviews();
    seoRefresh();
  });

  /* 상품 Q&A: 비밀글은 작성자/관리자에게만 조회된다(RLS). 수정 불가·삭제만 가능. */
  const qnaList = async () => {
    const { data, error } = sb ? await sb.from("product_questions").select("*").eq("product_id", p.id).order("created_at", { ascending: false }) : { data: [] };
    if (error) return ($("qna").innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`);
    $("qna-count").textContent = num(data.length);
    qnaRows = data;
    seoRefresh();
    $("qna").innerHTML = data.length
      ? data.map((q) => `<div class="qna"><div class="q-top"><span>${q.answered_at ? "답변완료" : "답변대기"}</span><span>${escapeHtml(q.author)}</span><span>${new Date(q.created_at).toLocaleDateString("ko-KR")}</span>${q.is_secret ? '<span class="pill">비밀글</span>' : ""}${Auth.user && (q.user_id === Auth.user.id || Auth.isAdmin) ? `<button type="button" class="link-btn" data-qdel="${q.id}">삭제</button>` : ""}</div><p>${escapeHtml(q.body)}</p>${q.answer ? `<div class="q-answer"><b>판매자 답변</b><br>${escapeHtml(q.answer)}</div>` : ""}</div>`).join("")
      : `<p class="muted">등록된 문의가 없습니다.</p>`;
  };
  $("qna-form-box").innerHTML = Auth.user
    ? `<form class="qna-form" id="qna-form"><textarea id="qna-body" maxlength="1000" placeholder="상품에 대해 궁금한 점을 남겨 주세요." required></textarea><label class="check"><input type="checkbox" id="qna-secret" /> 비밀글</label><button type="submit" class="btn btn-black btn-sm">문의 등록</button></form>`
    : `<p class="muted"><a class="guest-login" href="${loginUrl()}">로그인하고 문의하기 ›</a></p>`;
  const qform = $("qna-form");
  if (qform) {
    qform.addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = $("qna-body").value.trim();
      if (!body) return;
      const { error } = await sb.from("product_questions").insert({ product_id: p.id, user_id: Auth.user.id, body, is_secret: $("qna-secret").checked });
      if (error) return toast(error.message);
      qform.reset();
      toast("문의를 등록했어요.");
      qnaList();
    });
  }
  $("qna").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-qdel]");
    if (!b || !confirm("이 문의를 삭제할까요?")) return;
    const { error } = await sb.from("product_questions").delete().eq("id", Number(b.dataset.qdel));
    if (error) return toast(error.message);
    qnaList();
  });
  qnaList();

  /* 추천 */
  $("related").innerHTML = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id)
    .slice(0, 4)
    .map((x) => productCard(x))
    .join("");

  /* 탭 활성화 */
  const tabs = [...document.querySelectorAll("#pd-tabs a")];
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) tabs.forEach((t) => t.classList.toggle("on", t.getAttribute("href") === "#" + en.target.id));
      });
    },
    { rootMargin: "-120px 0px -60% 0px" }
  );
  document.querySelectorAll(".pd-section").forEach((s) => io.observe(s));
});
