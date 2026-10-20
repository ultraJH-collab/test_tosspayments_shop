/* 카테고리 상품 리스트 (tops.html / pants.html / shoes.html 공용) */
document.addEventListener("DOMContentLoaded", () => {
  const cat = document.body.dataset.page;
  const info = CATEGORIES[cat];
  const all = PRODUCTS.filter((p) => p.cat === cat);
  const brands = [...new Set(all.map((p) => p.brand))];

  const state = { brand: "전체", sort: "rec" };

  document.getElementById("cat-title").textContent = info.name;
  document.getElementById("cat-crumb").textContent = info.name;
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

  document.getElementById("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });

  const sorters = {
    rec: (a, b) => b.likes - a.likes,
    low: (a, b) => a.sale - b.sale,
    high: (a, b) => b.sale - a.sale,
    rate: (a, b) => discountRate(b) - discountRate(a),
    review: (a, b) => b.reviews - a.reviews,
  };

  function render() {
    const list = all.filter((p) => state.brand === "전체" || p.brand === state.brand).sort(sorters[state.sort]);
    document.getElementById("count").textContent = num(list.length);
    document.getElementById("grid").innerHTML = list.map((p) => productCard(p)).join("");
  }

  render();
});
