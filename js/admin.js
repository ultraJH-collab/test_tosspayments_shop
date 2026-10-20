/* 관리자: 상품 / 회원 / 주문 관리
   화면 접근은 여기서 막지만, 실제 권한은 DB의 RLS(is_admin)가 강제한다. */
onReady(() => {
  const root = document.getElementById("admin-root");
  if (!Auth.user) return location.replace(loginUrl());
  if (!Auth.isAdmin) {
    root.innerHTML = `<div class="empty"><p>관리자만 접근할 수 있습니다.</p><a class="btn btn-black" href="index.html">홈으로</a></div>`;
    return;
  }

  const $ = (id) => document.getElementById(id);
  const fmtDate = (s) => new Date(s).toLocaleDateString("ko-KR");
  const fmtDateTime = (s) => new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  const includes = (q, ...fields) => !q || fields.some((f) => String(f || "").toLowerCase().includes(q));
  const state = { products: [], members: [], orders: [], loaded: {} };

  /* ---------- 탭 ---------- */
  const loaders = { products: loadProducts, members: loadMembers, orders: loadOrders };
  function showTab(tab) {
    document.querySelectorAll("#admin-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll(".admin-panel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + tab));
    if (!state.loaded[tab]) {
      state.loaded[tab] = true;
      loaders[tab]();
    }
    history.replaceState(null, "", "#" + tab);
  }
  $("admin-tabs").addEventListener("click", (e) => e.target.dataset.tab && showTab(e.target.dataset.tab));

  /* ---------- 상품 관리 ---------- */
  Object.entries(CATEGORIES).forEach(([k, c]) => {
    $("p-cat").insertAdjacentHTML("beforeend", `<option value="${k}">${c.name}</option>`);
    $("f-cat").insertAdjacentHTML("beforeend", `<option value="${k}">${c.name}</option>`);
  });

  async function loadProducts() {
    $("p-rows").innerHTML = `<tr><td colspan="9" class="muted">불러오는 중...</td></tr>`;
    const { data, error } = await sb.from("products").select("*").order("cat").order("id");
    if (error) return ($("p-rows").innerHTML = `<tr><td colspan="9" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    state.products = data.map((p) => ({ ...p, rating: Number(p.rating) }));
    renderProducts();
  }

  function renderProducts() {
    const q = $("p-search").value.trim().toLowerCase();
    const cat = $("p-cat").value;
    const active = $("p-active").value;
    const list = state.products.filter(
      (p) => includes(q, p.id, p.name, p.brand) && (!cat || p.cat === cat) && (!active || String(Number(p.is_active)) === active)
    );
    $("p-count").textContent = `${num(list.length)}개`;
    $("p-rows").innerHTML = list.length
      ? list.map((p) => `
        <tr class="${p.is_active ? "" : "row-off"}">
          <td><div class="a-thumb">${productImage(p)}</div></td>
          <td class="mono">${escapeHtml(p.id)}</td>
          <td>${CATEGORIES[p.cat].name}</td>
          <td><b>${escapeHtml(p.brand)}</b><br>${escapeHtml(p.name)}</td>
          <td class="num">${num(p.price)}</td>
          <td class="num">${num(p.sale)}${discountRate(p) > 0 ? ` <span class="rate">${discountRate(p)}%</span>` : ""}</td>
          <td>${p.tag || "-"}</td>
          <td><button type="button" class="pill ${p.is_active ? "pill-on" : ""}" data-toggle="${escapeHtml(p.id)}">${p.is_active ? "판매중" : "숨김"}</button></td>
          <td class="nowrap">
            <button type="button" class="link" data-edit="${escapeHtml(p.id)}">수정</button>
            <button type="button" class="link link-danger" data-del="${escapeHtml(p.id)}">삭제</button>
          </td>
        </tr>`).join("")
      : `<tr><td colspan="9" class="muted">조건에 맞는 상품이 없습니다.</td></tr>`;
  }
  ["p-search", "p-cat", "p-active"].forEach((id) => $(id).addEventListener("input", renderProducts));

  $("p-rows").addEventListener("click", async (e) => {
    const t = e.target;
    const byId = (id) => state.products.find((p) => p.id === id);
    if (t.dataset.edit) return openProductForm(byId(t.dataset.edit));
    if (t.dataset.toggle) {
      const p = byId(t.dataset.toggle);
      t.disabled = true;
      const { data, error } = await sb.from("products").update({ is_active: !p.is_active }).eq("id", p.id).select().single();
      if (error) {
        t.disabled = false;
        return toast(error.message);
      }
      Object.assign(p, data, { rating: Number(data.rating) });
      toast(p.is_active ? "매장에 노출합니다." : "매장에서 숨겼습니다.");
      return renderProducts();
    }
    if (t.dataset.del) {
      const p = byId(t.dataset.del);
      if (!confirm(`"${p.name}" 상품을 삭제할까요?\n삭제하면 되돌릴 수 없습니다. 판매만 멈추려면 '숨김'을 사용하세요.\n(이미 접수된 주문 내역은 그대로 남습니다.)`)) return;
      const { error } = await sb.from("products").delete().eq("id", p.id);
      if (error) return toast(error.message);
      state.products = state.products.filter((x) => x !== p);
      toast("상품을 삭제했습니다.");
      renderProducts();
    }
  });

  /* 상품 등록/수정 폼 */
  const dlg = $("p-dialog");
  const form = $("p-form");
  let editing = null;

  function formValue() {
    const f = form.elements;
    return {
      id: f.id.value.trim(),
      cat: f.cat.value,
      brand: f.brand.value.trim(),
      name: f.name.value.trim(),
      price: Number(f.price.value),
      sale: Number(f.sale.value),
      sizes: f.sizes.value.split(",").map((s) => s.trim()).filter(Boolean),
      color: f.color.value,
      tone: f.tone.value,
      tag: f.tag.value || null,
      rating: Number(f.rating.value) || 0,
      reviews: Number(f.reviews.value) || 0,
      likes: Number(f.likes.value) || 0,
      is_active: f.is_active.checked,
    };
  }
  function renderPreview() {
    const p = formValue();
    $("p-preview").innerHTML = productImage({ ...p, name: p.name || "미리보기" });
  }
  form.addEventListener("input", renderPreview);

  function openProductForm(p) {
    editing = p || null;
    const v = p || { id: "", cat: "tops", brand: "", name: "", price: "", sale: "", sizes: ["S", "M", "L", "XL"], color: "#555555", tone: "#f2f2f2", tag: "", rating: 0, reviews: 0, likes: 0, is_active: true };
    const f = form.elements;
    $("p-form-title").textContent = p ? "상품 수정" : "상품 등록";
    f.id.value = v.id;
    f.id.disabled = !!p;
    f.cat.value = v.cat;
    f.brand.value = v.brand;
    f.name.value = v.name;
    f.price.value = v.price;
    f.sale.value = v.sale;
    f.sizes.value = v.sizes.join(", ");
    f.color.value = v.color;
    f.tone.value = v.tone;
    f.tag.value = v.tag || "";
    f.rating.value = v.rating;
    f.reviews.value = v.reviews;
    f.likes.value = v.likes;
    f.is_active.checked = v.is_active;
    $("p-error").textContent = "";
    renderPreview();
    dlg.showModal();
  }
  $("p-new").onclick = () => openProductForm(null);
  dlg.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close") || e.target === dlg) dlg.close();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = formValue();
    const err = $("p-error");
    const fail = (msg) => (err.textContent = msg);
    if (!editing && !/^[a-z0-9_-]{2,40}$/.test(v.id)) return fail("상품 ID는 영문 소문자/숫자/-/_ 2~40자로 입력해 주세요.");
    if (!editing && state.products.some((p) => p.id === v.id)) return fail("이미 사용 중인 상품 ID입니다.");
    if (!v.brand || !v.name) return fail("브랜드와 상품명을 입력해 주세요.");
    if (!Number.isInteger(v.price) || !Number.isInteger(v.sale) || v.price <= 0 || v.sale <= 0) return fail("가격은 0보다 큰 정수로 입력해 주세요.");
    if (v.sale > v.price) return fail("판매가는 정가보다 클 수 없습니다.");
    if (!v.sizes.length) return fail("사이즈를 하나 이상 입력해 주세요.");
    if (v.rating < 0 || v.rating > 5) return fail("평점은 0~5 사이로 입력해 주세요.");

    $("p-save").disabled = true;
    const { id, ...fields } = v;
    const req = editing
      ? sb.from("products").update(fields).eq("id", editing.id).select().single()
      : sb.from("products").insert(v).select().single();
    const { data, error } = await req;
    $("p-save").disabled = false;
    if (error) return fail(error.message);

    const saved = { ...data, rating: Number(data.rating) };
    if (editing) Object.assign(editing, saved);
    else state.products.push(saved);
    dlg.close();
    toast(editing ? "상품을 수정했습니다." : "상품을 등록했습니다.");
    renderProducts();
  });

  /* ---------- 회원 관리 ---------- */
  async function loadMembers() {
    $("m-rows").innerHTML = `<tr><td colspan="7" class="muted">불러오는 중...</td></tr>`;
    const [{ data: members, error }, { data: orders }] = await Promise.all([
      sb.from("profiles").select("*").order("created_at", { ascending: false }),
      sb.from("orders").select("user_id, status"),
    ]);
    if (error) return ($("m-rows").innerHTML = `<tr><td colspan="7" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    const counts = {};
    (orders || []).forEach((o) => {
      if (o.user_id && o.status !== "failed") counts[o.user_id] = (counts[o.user_id] || 0) + 1;
    });
    state.members = members.map((m) => ({ ...m, orderCount: counts[m.id] || 0 }));
    renderMembers();
  }

  function renderMembers() {
    const q = $("m-search").value.trim().toLowerCase();
    const list = state.members.filter((m) => includes(q, m.email, m.name, m.phone));
    $("m-count").textContent = `${num(list.length)}명`;
    $("m-rows").innerHTML = list.length
      ? list.map((m) => {
          const self = m.id === Auth.user.id;
          return `
          <tr class="${m.status === "blocked" ? "row-off" : ""}">
            <td>${escapeHtml(m.email)}${self ? ' <span class="pill">나</span>' : ""}</td>
            <td>${escapeHtml(m.name) || "-"}</td>
            <td>${escapeHtml(m.phone) || "-"}</td>
            <td>${fmtDate(m.created_at)}</td>
            <td class="num">${num(m.orderCount)}</td>
            <td><select data-member="${m.id}" data-field="role" ${self ? "disabled" : ""}>
              <option value="user" ${m.role === "user" ? "selected" : ""}>일반회원</option>
              <option value="admin" ${m.role === "admin" ? "selected" : ""}>관리자</option>
            </select></td>
            <td><select data-member="${m.id}" data-field="status" ${self ? "disabled" : ""}>
              <option value="active" ${m.status === "active" ? "selected" : ""}>정상</option>
              <option value="blocked" ${m.status === "blocked" ? "selected" : ""}>이용정지</option>
            </select></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="7" class="muted">회원이 없습니다.</td></tr>`;
  }
  $("m-search").addEventListener("input", renderMembers);

  $("m-rows").addEventListener("change", async (e) => {
    const sel = e.target;
    if (!sel.dataset.member) return;
    const m = state.members.find((x) => x.id === sel.dataset.member);
    const field = sel.dataset.field;
    const label = sel.options[sel.selectedIndex].text;
    if (!confirm(`${m.email} 회원의 ${field === "role" ? "등급" : "상태"}을(를) '${label}'(으)로 변경할까요?`)) {
      sel.value = m[field];
      return;
    }
    sel.disabled = true;
    const { data, error } = await sb.from("profiles").update({ [field]: sel.value }).eq("id", m.id).select().single();
    sel.disabled = false;
    if (error || data[field] !== sel.value) {
      sel.value = m[field];
      return toast((error && error.message) || "변경 권한이 없습니다.");
    }
    Object.assign(m, data);
    toast("회원 정보를 변경했습니다.");
    renderMembers();
  });

  /* ---------- 주문 관리 ---------- */
  Object.entries(ORDER_STATUS).forEach(([k, v]) => $("o-status").insertAdjacentHTML("beforeend", `<option value="${k}">${v}</option>`));

  async function loadOrders() {
    $("o-rows").innerHTML = `<tr><td colspan="6" class="muted">불러오는 중...</td></tr>`;
    const [{ data: orders, error }, { data: members }] = await Promise.all([
      sb.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(500),
      sb.from("profiles").select("id, email"),
    ]);
    if (error) return ($("o-rows").innerHTML = `<tr><td colspan="6" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    const emails = Object.fromEntries((members || []).map((m) => [m.id, m.email]));
    state.orders = orders.map((o) => ({ ...o, memberEmail: emails[o.user_id] || "" }));
    renderOrders();
  }

  function renderOrders() {
    const q = $("o-search").value.trim().toLowerCase();
    const status = $("o-status").value;
    const list = state.orders.filter((o) => includes(q, o.id, o.customer_name, o.memberEmail, o.customer_phone) && (!status || o.status === status));
    const paidSum = list.filter((o) => ["paid", "shipping", "delivered"].includes(o.status)).reduce((s, o) => s + o.amount, 0);
    $("o-count").textContent = `${num(list.length)}건 · 결제 합계 ${won(paidSum)}`;
    $("o-rows").innerHTML = list.length
      ? list.map((o) => `
        <tr class="${["failed", "canceled"].includes(o.status) ? "row-off" : ""}">
          <td class="nowrap">${fmtDateTime(o.created_at)}</td>
          <td class="mono">${escapeHtml(o.id)}</td>
          <td>${escapeHtml(o.customer_name)}<br><small class="muted">${o.user_id ? escapeHtml(o.memberEmail || "회원") : "비회원"}</small></td>
          <td>
            <details>
              <summary>${escapeHtml(o.order_name)}</summary>
              <ul class="o-items">${o.order_items.map((i) => `<li>${escapeHtml(i.brand)} ${escapeHtml(i.product_name)} · ${escapeHtml(i.size)} · ${i.qty}개 · ${won(i.line_total)}</li>`).join("")}</ul>
              <p class="muted">${escapeHtml([o.zip, o.addr1, o.addr2].filter(Boolean).join(" ")) || "주소 없음"}${o.memo ? " · " + escapeHtml(o.memo) : ""}${o.customer_phone ? " · " + escapeHtml(o.customer_phone) : ""}</p>
            </details>
          </td>
          <td class="num">${won(o.amount)}</td>
          <td><select data-order="${escapeHtml(o.id)}">${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        </tr>`).join("")
      : `<tr><td colspan="6" class="muted">조건에 맞는 주문이 없습니다.</td></tr>`;
  }
  ["o-search", "o-status"].forEach((id) => $(id).addEventListener("input", renderOrders));

  $("o-rows").addEventListener("change", async (e) => {
    const sel = e.target;
    if (!sel.dataset.order) return;
    const o = state.orders.find((x) => x.id === sel.dataset.order);
    sel.disabled = true;
    const { data, error } = await sb.from("orders").update({ status: sel.value }).eq("id", o.id).select().single();
    sel.disabled = false;
    if (error) {
      sel.value = o.status;
      return toast(error.message);
    }
    o.status = data.status;
    toast(`주문 상태를 '${ORDER_STATUS[o.status]}'(으)로 변경했습니다.`);
    renderOrders();
  });

  const initial = location.hash.slice(1);
  showTab(loaders[initial] ? initial : "products");
});
