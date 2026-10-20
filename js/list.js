/* 상품 리스트 (tops.html / pants.html / shoes.html / search.html 공용)
   필터·정렬 UI는 여기서 .toolbar 안에 주입하므로 각 HTML은 data-page 외에 같은 마크업이면 된다. */
onReady(async () => {
  const cat = document.body.dataset.page;
  const isSearch = cat === "search";
  const q = (qs("q") || "").trim();
  const info = isSearch ? { name: q ? `'${q}' 검색 결과` : "검색" } : CATEGORIES[cat];

  let all;
  if (isSearch) {
    // pg_trgm 부분 일치/오타 완화 검색 → 이미 로드된 상품(이미지·재고 포함)과 매칭한다.
    let ids = [];
    if (q && sb) {
      const { data, error } = await sb.rpc("search_products", { q });
      if (error) toast(error.message);
      else ids = data.map((r) => r.id);
    } else if (q) {
      ids = PRODUCTS.filter((p) => (p.name + p.brand).toLowerCase().includes(q.toLowerCase())).map((p) => p.id);
    }
    all = ids.map((id) => findProduct(id)).filter(Boolean);
  } else {
    all = PRODUCTS.filter((p) => p.cat === cat);
  }
  const brands = [...new Set(all.map((p) => p.brand))];
  const allSizes = [...new Set(all.flatMap((p) => p.sizes))];

  const state = { brand: "전체", sort: isSearch ? "rel" : "rec", price: "", size: "", color: "", inStock: false };

  document.getElementById("cat-title").textContent = info.name;
  document.getElementById("cat-crumb").textContent = isSearch ? "검색" : info.name;
  document.title = `${info.name} | FITROOM`;

  const chips = document.getElementById("chips");
  chips.innerHTML = ["전체", ...brands]
    .map((b) => `<button type="button" class="chip${b === "전체" ? " on" : ""}" data-brand="${escapeHtml(b)}">${escapeHtml(b)}</button>`)
    .join("");
  chips.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    state.brand = btn.dataset.brand;
    chips.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === btn));
    render();
  });

  /* 색상: #rrggbb 를 대표 색상군으로 분류 */
  const COLORS = { black: "블랙", white: "화이트", gray: "그레이", beige: "베이지", brown: "브라운", red: "레드", green: "그린", blue: "블루", other: "기타" };
  function colorGroup(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
    if (!m) return "other";
    const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510, d = max - min;
    if (l < 0.16) return "black";
    if (d < 24) return l > 0.88 ? "white" : "gray";
    const h = d === 0 ? 0 : max === r ? (((g - b) / d) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
    const hue = (h + 360) % 360;
    if (hue < 20 || hue >= 340) return "red";
    if (hue < 50) return l > 0.6 ? "beige" : "brown";
    if (hue < 70) return l > 0.6 ? "beige" : "green";
    if (hue < 170) return "green";
    if (hue < 260) return "blue";
    return "other";
  }
  const colorGroups = [...new Set(all.map((p) => colorGroup(p.color)))];

  /* 필터/정렬 UI 주입 */
  const PRICES = [["", "전체 가격"], ["0-50000", "5만원 이하"], ["50000-100000", "5~10만원"], ["100000-150000", "10~15만원"], ["150000-", "15만원 이상"]];
  const SORTS = [["rec", "인기순"], ["new", "최신순"], ["low", "낮은 가격순"], ["high", "높은 가격순"], ["rate", "할인율순"], ["review", "리뷰 많은 순"]];
  if (isSearch) SORTS.unshift(["rel", "정확도순"]);
  const toolbar = document.querySelector(".toolbar");
  toolbar.insertAdjacentHTML(
    "afterend",
    `<div class="filters" id="filters">
      <select id="f-price" aria-label="가격대">${PRICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <select id="f-size" aria-label="사이즈"><option value="">전체 사이즈</option>${allSizes.map((s) => `<option>${escapeHtml(s)}</option>`).join("")}</select>
      <select id="f-color" aria-label="색상"><option value="">전체 색상</option>${colorGroups.map((c) => `<option value="${c}">${COLORS[c]}</option>`).join("")}</select>
      <label class="check"><input type="checkbox" id="f-stock" /> 품절 제외</label>
    </div>`
  );
  const sortEl = document.getElementById("sort");
  sortEl.innerHTML = SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  sortEl.value = state.sort;
  sortEl.addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  document.getElementById("filters").addEventListener("change", () => {
    state.price = document.getElementById("f-price").value;
    state.size = document.getElementById("f-size").value;
    state.color = document.getElementById("f-color").value;
    state.inStock = document.getElementById("f-stock").checked;
    render();
  });

  const sorters = {
    rel: () => 0, // 검색 RPC가 유사도순으로 돌려준 순서를 유지
    rec: (a, b) => b.likes - a.likes,
    new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    low: (a, b) => a.sale - b.sale,
    high: (a, b) => b.sale - a.sale,
    rate: (a, b) => discountRate(b) - discountRate(a),
    review: (a, b) => b.reviews - a.reviews,
  };

  function passes(p) {
    if (state.brand !== "전체" && p.brand !== state.brand) return false;
    if (state.price) {
      const [lo, hi] = state.price.split("-");
      if (p.sale < Number(lo || 0) || (hi && p.sale > Number(hi))) return false;
    }
    if (state.size && !p.sizes.includes(state.size)) return false;
    if (state.size && stockOf(p, state.size) <= 0 && state.inStock) return false;
    if (state.color && colorGroup(p.color) !== state.color) return false;
    if (state.inStock && isSoldOut(p)) return false;
    return true;
  }

  function render() {
    const list = all.filter(passes).sort(sorters[state.sort]);
    document.getElementById("count").textContent = num(list.length);
    document.getElementById("grid").innerHTML = list.length
      ? list.map((p) => productCard(p)).join("")
      : `<li class="empty" style="grid-column:1/-1"><p>${isSearch && !q ? "검색어를 입력해 주세요." : "조건에 맞는 상품이 없습니다."}</p></li>`;
  }

  render();
});
