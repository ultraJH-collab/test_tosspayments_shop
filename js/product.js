/* 상품 상세 */
document.addEventListener("DOMContentLoaded", () => {
  const p = findProduct(qs("id")) || PRODUCTS[0];
  const cat = CATEGORIES[p.cat];
  document.body.dataset.page = p.cat;
  renderHeader(p.cat);
  document.title = `${p.brand} ${p.name} | FITROOM`;

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
    $("thumbs").innerHTML = [0, 1, 2, 3]
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
  $("sizes").innerHTML = p.sizes.map((s) => `<button type="button" class="size-btn" data-size="${s}">${s}</button>`).join("");
  $("sizes").addEventListener("click", (e) => {
    const b = e.target.closest(".size-btn");
    if (!b) return;
    state.size = b.dataset.size;
    $("sizes").querySelectorAll(".size-btn").forEach((x) => x.classList.toggle("on", x === b));
  });

  /* 수량 */
  function setQty(n) {
    state.qty = Math.max(1, Math.min(99, Number(n) || 1));
    $("qty").value = state.qty;
    $("pd-total").textContent = won(p.sale * state.qty);
  }
  $("qty-minus").onclick = () => setQty(state.qty - 1);
  $("qty-plus").onclick = () => setQty(state.qty + 1);
  $("qty").addEventListener("change", (e) => setQty(e.target.value));
  setQty(1);

  $("btn-like").onclick = (e) => {
    e.currentTarget.classList.toggle("on");
    toast(e.currentTarget.classList.contains("on") ? "좋아요 목록에 추가했어요." : "좋아요를 취소했어요.");
  };

  function requireSize() {
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
  $("detail-imgs").innerHTML = [0, 1, 2].map((v) => productImage(p, v)).join("");
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
        return `<tr><td><b>${s}</b></td>${vals.map((v) => `<td>${v}</td>`).join("")}</tr>`;
      })
      .join("") +
    `</tbody>`;

  /* 후기 */
  const reviews = [
    { r: 5, who: "fit***", size: p.sizes[1] || p.sizes[0], text: "핏이 정말 예쁘고 소재도 좋아요. 재구매 의사 있습니다." },
    { r: 5, who: "mu0***", size: p.sizes[2] || p.sizes[0], text: "사진이랑 색감 똑같아요. 배송도 빨랐습니다." },
    { r: 4, who: "day***", size: p.sizes[0], text: "생각보다 살짝 크게 나온 편이에요. 반 사이즈 작게 추천합니다." },
  ];
  $("review-count").textContent = num(p.reviews);
  $("reviews").innerHTML = reviews
    .map((v) => `<div class="review"><div class="r-top"><span class="star">${"★".repeat(v.r)}${"☆".repeat(5 - v.r)}</span><span>${v.who}</span><span>구매옵션: ${v.size}</span></div><p>${v.text}</p></div>`)
    .join("");

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
