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
  const state = { products: [], members: [], orders: [], reviews: [], loaded: {}, productView: [], memberView: [], orderView: [], selected: new Set() };

  // CSV 내보내기: 엑셀 한글 깨짐 방지 BOM, 수식 주입 방지를 위해 = + - @ 로 시작하는 값은 ' 를 붙인다.
  function downloadCsv(name, columns, rows) {
    const cell = (v) => {
      let t = v == null ? "" : String(v);
      if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return '"' + t.replace(/"/g, '""') + '"';
    };
    const csv = "﻿" + [columns.map((c) => cell(c[0])).join(","), ...rows.map((r) => columns.map((c) => cell(c[1](r))).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------- 탭 ---------- */
  const loaders = { products: loadProducts, members: loadMembers, orders: loadOrders, reviews: loadReviews, qna: loadQna, coupons: loadCoupons, content: loadContent, dashboard: loadDashboard, audit: loadAudit };
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
    state.productView = list;
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

  // 사이즈 입력값에 맞춰 재고 입력칸을 만든다(이미 입력한 값은 유지).
  function parseSizes() {
    return [...new Set(form.elements.sizes.value.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  function renderStock(values) {
    const cur = values || stockValues();
    $("f-stock").innerHTML = parseSizes()
      .map((s) => `<label class="check" style="gap:4px">${escapeHtml(s)} <input type="number" min="0" data-size="${escapeHtml(s)}" value="${cur[s] ?? 0}" style="width:70px" /></label>`)
      .join("");
  }
  /* 이미지: items = [{ id?, path?, file?, url }] (저장 시 업로드/정렬/삭제 반영) */
  let imgItems = [];
  let removedImages = [];
  function renderImages() {
    $("f-images").innerHTML = imgItems
      .map((it, i) => `<div class="im"><img src="${escapeHtml(it.url)}" alt="" />${i === 0 ? "대표" : i + 1}<br>
        <button type="button" data-im="left" data-i="${i}" ${i === 0 ? "disabled" : ""}>◀</button><button type="button" data-im="del" data-i="${i}">삭제</button><button type="button" data-im="right" data-i="${i}" ${i === imgItems.length - 1 ? "disabled" : ""}>▶</button></div>`)
      .join("");
  }
  $("f-images").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-im]");
    if (!b) return;
    const i = Number(b.dataset.i);
    if (b.dataset.im === "del") {
      const [it] = imgItems.splice(i, 1);
      if (it.id) removedImages.push(it);
    } else {
      const j = b.dataset.im === "left" ? i - 1 : i + 1;
      [imgItems[i], imgItems[j]] = [imgItems[j], imgItems[i]];
    }
    renderImages();
  });
  $("f-image-files").addEventListener("change", (e) => {
    for (const file of e.target.files) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { toast(`${file.name}: jpg/png/webp만 올릴 수 있습니다.`); continue; }
      if (file.size > 5 * 1024 * 1024) { toast(`${file.name}: 5MB를 넘습니다.`); continue; }
      imgItems.push({ file, url: URL.createObjectURL(file) });
    }
    e.target.value = "";
    renderImages();
  });
  async function saveImages(productId) {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    for (const it of imgItems) {
      if (it.file) {
        const path = `${productId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext[it.file.type]}`;
        const { error } = await sb.storage.from("product-images").upload(path, it.file, { contentType: it.file.type });
        if (error) throw error;
        it.path = path;
      }
    }
    if (removedImages.length) {
      await sb.storage.from("product-images").remove(removedImages.map((r) => r.path));
      const { error } = await sb.from("product_images").delete().in("id", removedImages.map((r) => r.id));
      if (error) throw error;
    }
    for (const [i, it] of imgItems.entries()) {
      const { data, error } = it.id
        ? await sb.from("product_images").update({ sort_order: i }).eq("id", it.id).select().single()
        : await sb.from("product_images").insert({ product_id: productId, path: it.path, sort_order: i }).select().single();
      if (error) throw error;
      it.id = data.id;
    }
  }
  function stockValues() {
    const v = {};
    $("f-stock").querySelectorAll("input").forEach((i) => (v[i.dataset.size] = Math.max(0, parseInt(i.value, 10) || 0)));
    return v;
  }
  form.elements.sizes.addEventListener("input", () => renderStock());

  async function openProductForm(p) {
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
    let cur = {};
    if (p) {
      const { data: rows } = await sb.from("product_stock").select("size, stock").eq("product_id", p.id);
      (rows || []).forEach((r) => (cur[r.size] = r.stock));
    } else {
      v.sizes.forEach((s) => (cur[s] = 10));
    }
    renderStock(cur);
    removedImages = [];
    imgItems = [];
    if (p) {
      const { data: imgs } = await sb.from("product_images").select("id, path").eq("product_id", p.id).order("sort_order").order("id");
      imgItems = (imgs || []).map((r) => ({ id: r.id, path: r.path, url: imageUrl(r.path) }));
    }
    renderImages();
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

    // 재고 저장: 입력한 사이즈는 upsert, 빠진 사이즈는 삭제
    const stock = stockValues();
    const rows = Object.entries(stock).map(([size, qty]) => ({ product_id: data.id, size, stock: qty }));
    const { error: stockErr } = await sb.from("product_stock").upsert(rows);
    if (!stockErr) {
      const keep = Object.keys(stock).map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",");
      await sb.from("product_stock").delete().eq("product_id", data.id).not("size", "in", `(${keep})`);
    }
    if (stockErr) toast("상품은 저장했지만 재고 저장에 실패했습니다: " + stockErr.message);
    try {
      await saveImages(data.id);
    } catch (imgErr) {
      toast("상품은 저장했지만 이미지 저장에 실패했습니다: " + imgErr.message);
    }

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
    state.memberView = list;
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
    $("o-rows").innerHTML = `<tr><td colspan="7" class="muted">불러오는 중...</td></tr>`;
    const [{ data: orders, error }, { data: members }] = await Promise.all([
      sb.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(500),
      sb.from("profiles").select("id, email"),
    ]);
    if (error) return ($("o-rows").innerHTML = `<tr><td colspan="7" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    const emails = Object.fromEntries((members || []).map((m) => [m.id, m.email]));
    state.orders = orders.map((o) => ({ ...o, memberEmail: emails[o.user_id] || "" }));
    renderOrders();
  }

  // 직접 바꿀 수 있는 상태는 paid → shipping → delivered 뿐. 취소는 결제 취소(Edge Function)로만 한다.
  const NEXT_STATUS = { paid: "shipping", shipping: "delivered" };
  function orderStatusCell(o) {
    const next = NEXT_STATUS[o.status];
    return `<span class="status status-${o.status}">${ORDER_STATUS[o.status]}</span>${
      next ? ` <button type="button" class="btn-cancel-order" data-advance="${escapeHtml(o.id)}">${ORDER_STATUS[next]}으로</button>` : ""
    }${o.status === "paid" ? ` <button type="button" class="btn-cancel-order" data-cancel="${escapeHtml(o.id)}">결제 취소</button>` : ""}${
      o.tracking_no ? `<br><small class="muted">${escapeHtml(o.courier || "")} ${escapeHtml(o.tracking_no)}</small>` : ""
    }${
      o.fail_reason ? `<br><small class="muted">${escapeHtml(o.fail_reason)}</small>` : o.cancel_reason ? `<br><small class="muted">${escapeHtml(o.cancel_reason)}</small>` : ""
    }`;
  }

  function renderOrders() {
    const q = $("o-search").value.trim().toLowerCase();
    const status = $("o-status").value;
    const list = state.orders.filter((o) => includes(q, o.id, o.customer_name, o.memberEmail, o.customer_phone) && (!status || o.status === status));
    state.orderView = list;
    const paidSum = list.filter((o) => ["paid", "shipping", "delivered"].includes(o.status)).reduce((s, o) => s + o.amount, 0);
    $("o-count").textContent = `${num(list.length)}건 · 결제 합계 ${won(paidSum)}`;
    $("o-rows").innerHTML = list.length
      ? list.map((o) => `
        <tr class="${["failed", "canceled"].includes(o.status) ? "row-off" : ""}">
          <td><input type="checkbox" data-sel="${escapeHtml(o.id)}" ${NEXT_STATUS[o.status] ? "" : "disabled"} ${state.selected.has(o.id) ? "checked" : ""} aria-label="선택" /></td>
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
          <td class="num">${won(o.amount)}${o.discount ? `<br><small class="muted">쿠폰 -${won(o.discount)}</small>` : ""}</td>
          <td>${orderStatusCell(o)}</td>
        </tr>`).join("")
      : `<tr><td colspan="7" class="muted">조건에 맞는 주문이 없습니다.</td></tr>`;
  }
  ["o-search", "o-status"].forEach((id) => $(id).addEventListener("input", renderOrders));

  $("o-rows").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const o = state.orders.find((x) => x.id === (btn.dataset.advance || btn.dataset.cancel));
    if (!o) return;
    btn.disabled = true;
    if (btn.dataset.advance) {
      const patch = { status: NEXT_STATUS[o.status] };
      if (patch.status === "shipping") {
        const courier = prompt(`택배사를 입력해 주세요. (${Object.keys(COURIERS).join(" / ")})`, "CJ대한통운");
        if (courier === null) return (btn.disabled = false);
        const no = prompt("운송장 번호를 입력해 주세요.");
        if (no === null) return (btn.disabled = false);
        patch.courier = courier.trim();
        patch.tracking_no = no.trim();
      }
      const { data, error } = await sb.from("orders").update(patch).eq("id", o.id).select().single();
      if (error) {
        btn.disabled = false;
        return toast(error.message);
      }
      Object.assign(o, data);
      sb.functions.invoke("send-email", { body: { orderId: o.id, type: o.status } }); // 배송 시작/완료 알림(실패해도 무시)
      toast(`주문 상태를 '${ORDER_STATUS[o.status]}'(으)로 변경했습니다.`);
    } else {
      const reason = prompt("취소 사유를 입력해 주세요. 토스 결제가 전액 취소되고 재고가 복구됩니다.", "관리자 취소");
      if (reason === null) return (btn.disabled = false);
      const { error } = await sb.functions.invoke("cancel-payment", { body: { orderId: o.id, reason } });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).error || msg; } catch (err) {}
        btn.disabled = false;
        return toast(msg);
      }
      toast("결제를 취소했습니다.");
      state.loaded.products = false; // 재고가 복구되었으므로 다음에 다시 불러온다
      return loadOrders();
    }
    renderOrders();
  });

  /* ---------- 후기 관리(숨김/삭제) ---------- */
  async function loadReviews() {
    $("r-rows").innerHTML = `<tr><td colspan="6" class="muted">불러오는 중...</td></tr>`;
    const { data, error } = await sb.from("reviews").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) return ($("r-rows").innerHTML = `<tr><td colspan="6" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    state.reviews = data;
    renderReviews();
  }
  function renderReviews() {
    const q = $("r-search").value.trim().toLowerCase();
    const h = $("r-hidden").value;
    const list = state.reviews.filter((r) => includes(q, r.product_id, r.body, r.author) && (h === "" || String(r.is_hidden ? 1 : 0) === h));
    $("r-count").textContent = `${num(list.length)}건`;
    $("r-rows").innerHTML = list.length
      ? list.map((r) => `<tr class="${r.is_hidden ? "row-off" : ""}">
          <td class="nowrap">${fmtDate(r.created_at)}</td>
          <td class="mono">${escapeHtml(r.product_id)}</td>
          <td>${escapeHtml(r.author)}</td>
          <td>${"★".repeat(r.rating)}</td>
          <td>${escapeHtml(r.body)}${r.image_paths.length ? ` <small class="muted">(사진 ${r.image_paths.length})</small>` : ""}</td>
          <td><button type="button" class="btn-cancel-order" data-rv-hide="${r.id}">${r.is_hidden ? "노출" : "숨김"}</button> <button type="button" class="btn-cancel-order" data-rv-del="${r.id}">삭제</button></td>
        </tr>`).join("")
      : `<tr><td colspan="6" class="muted">후기가 없습니다.</td></tr>`;
  }
  ["r-search", "r-hidden"].forEach((id) => $(id).addEventListener("input", renderReviews));
  $("r-rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = Number(b.dataset.rvHide || b.dataset.rvDel);
    const r = state.reviews.find((x) => x.id === id);
    if (b.dataset.rvDel) {
      if (!confirm("이 후기를 삭제할까요? 되돌릴 수 없습니다.")) return;
      const { error } = await sb.from("reviews").delete().eq("id", id);
      if (error) return toast(error.message);
      if (r.image_paths.length) sb.storage.from("review-images").remove(r.image_paths);
      state.reviews = state.reviews.filter((x) => x.id !== id);
    } else {
      const { data, error } = await sb.from("reviews").update({ is_hidden: !r.is_hidden }).eq("id", id).select().single();
      if (error) return toast(error.message);
      Object.assign(r, data);
    }
    renderReviews();
  });

  /* ---------- CSV 내보내기 / 주문 일괄 처리 (F20) ---------- */
  $("p-csv").onclick = () => downloadCsv("products", [["ID", (p) => p.id], ["카테고리", (p) => p.cat], ["브랜드", (p) => p.brand], ["상품명", (p) => p.name], ["정가", (p) => p.price], ["판매가", (p) => p.sale], ["태그", (p) => p.tag], ["판매중", (p) => (p.is_active ? "Y" : "N")]], state.productView);
  $("m-csv").onclick = () => downloadCsv("members", [["이메일", (m) => m.email], ["이름", (m) => m.name], ["휴대폰", (m) => m.phone], ["가입일", (m) => fmtDate(m.created_at)], ["주문수", (m) => m.orderCount], ["등급", (m) => m.role], ["상태", (m) => m.status]], state.memberView);
  $("o-csv").onclick = () => downloadCsv("orders", [["주문일시", (o) => fmtDateTime(o.created_at)], ["주문번호", (o) => o.id], ["주문자", (o) => o.customer_name], ["이메일", (o) => o.memberEmail || o.customer_email], ["상품", (o) => o.order_name], ["상품금액", (o) => o.subtotal], ["쿠폰할인", (o) => o.discount], ["배송비", (o) => o.shipping], ["결제금액", (o) => o.amount], ["상태", (o) => ORDER_STATUS[o.status]], ["택배사", (o) => o.courier], ["운송장", (o) => o.tracking_no]], state.orderView);

  $("o-rows").addEventListener("change", (e) => {
    if (!e.target.dataset.sel) return;
    e.target.checked ? state.selected.add(e.target.dataset.sel) : state.selected.delete(e.target.dataset.sel);
  });
  $("o-all").addEventListener("change", (e) => {
    state.orderView.filter((o) => NEXT_STATUS[o.status]).forEach((o) => (e.target.checked ? state.selected.add(o.id) : state.selected.delete(o.id)));
    renderOrders();
  });
  // 선택한 주문을 다음 단계로(상태 전이 규칙은 DB 트리거가 강제한다). 같은 상태끼리만 처리한다.
  $("o-bulk").onclick = async () => {
    const list = state.orders.filter((o) => state.selected.has(o.id) && NEXT_STATUS[o.status]);
    if (!list.length) return toast("다음 단계로 보낼 주문을 선택해 주세요. (결제완료·배송중만 가능)");
    if (new Set(list.map((o) => o.status)).size > 1) return toast("같은 상태의 주문만 한 번에 처리할 수 있습니다.");
    const next = NEXT_STATUS[list[0].status];
    let courier = "";
    if (next === "shipping") {
      courier = prompt(`택배사를 입력해 주세요. (${Object.keys(COURIERS).join(" / ")})`, "CJ대한통운");
      if (courier === null) return;
    }
    if (!confirm(`${list.length}건을 '${ORDER_STATUS[next]}'(으)로 변경할까요?`)) return;
    let ok = 0;
    for (const o of list) {
      const patch = { status: next };
      if (next === "shipping") {
        const no = prompt(`${o.id} (${o.customer_name}) 운송장 번호 — 취소하면 남은 주문은 처리하지 않습니다.`);
        if (no === null) break;
        patch.courier = courier.trim();
        patch.tracking_no = no.trim();
      }
      const { error } = await sb.from("orders").update(patch).eq("id", o.id);
      if (error) { toast(`${o.id}: ${error.message}`); break; }
      sb.functions.invoke("send-email", { body: { orderId: o.id, type: next } });
      state.selected.delete(o.id);
      ok++;
    }
    toast(`${ok}건을 처리했습니다.`);
    loadOrders();
  };

  /* ---------- 상품 Q&A ---------- */
  async function loadQna() {
    $("q-rows").innerHTML = `<tr><td colspan="6" class="muted">불러오는 중...</td></tr>`;
    const { data, error } = await sb.from("product_questions").select("*").order("created_at", { ascending: false }).limit(500);
    if (error) return ($("q-rows").innerHTML = `<tr><td colspan="6" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    state.qna = data;
    renderQna();
  }
  function renderQna() {
    const q = $("q-search").value.trim().toLowerCase();
    const st = $("q-state").value;
    const list = (state.qna || []).filter((r) => includes(q, r.product_id, r.body, r.answer) && (st === "" || String(r.answered_at ? 1 : 0) === st));
    $("q-count").textContent = `${num(list.length)}건`;
    $("q-rows").innerHTML = list.length
      ? list.map((r) => `<tr><td class="nowrap">${fmtDate(r.created_at)}</td><td class="mono">${escapeHtml(r.product_id)}</td><td>${escapeHtml(r.author)}</td>
          <td>${r.is_secret ? '<span class="pill">비밀</span> ' : ""}${escapeHtml(r.body)}</td><td>${r.answer ? escapeHtml(r.answer) : '<span class="muted">답변대기</span>'}</td>
          <td class="nowrap"><button type="button" class="btn-cancel-order" data-q-answer="${r.id}">${r.answer ? "답변 수정" : "답변"}</button> <button type="button" class="btn-cancel-order" data-q-del="${r.id}">삭제</button></td></tr>`).join("")
      : `<tr><td colspan="6" class="muted">문의가 없습니다.</td></tr>`;
  }
  ["q-search", "q-state"].forEach((id) => $(id).addEventListener("input", renderQna));
  $("q-rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = Number(b.dataset.qAnswer || b.dataset.qDel);
    const r = state.qna.find((x) => x.id === id);
    if (b.dataset.qDel) {
      if (!confirm("이 문의를 삭제할까요?")) return;
      const { error } = await sb.from("product_questions").delete().eq("id", id);
      if (error) return toast(error.message);
      state.qna = state.qna.filter((x) => x.id !== id);
    } else {
      const answer = prompt("답변을 입력해 주세요. (비우면 답변 삭제)", r.answer || "");
      if (answer === null) return;
      const { data, error } = await sb.from("product_questions").update({ answer: answer.trim() || null }).eq("id", id).select().single();
      if (error) return toast(error.message);
      Object.assign(r, data);
    }
    renderQna();
  });

  /* ---------- 쿠폰 (할인 계산은 create_order 가 서버에서만 한다) ---------- */
  const isoOrNull = (v) => (v ? new Date(v).toISOString() : null);
  const intOrNull = (v) => (v === "" || v == null ? null : parseInt(v, 10));
  async function loadCoupons() {
    $("c-rows").innerHTML = `<tr><td colspan="8" class="muted">불러오는 중...</td></tr>`;
    const [{ data, error }, { data: red }] = await Promise.all([
      sb.from("coupons").select("*").order("id", { ascending: false }),
      sb.from("coupon_redemptions").select("coupon_id").eq("status", "used"),
    ]);
    if (error) return ($("c-rows").innerHTML = `<tr><td colspan="8" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    const used = {};
    (red || []).forEach((r) => (used[r.coupon_id] = (used[r.coupon_id] || 0) + 1));
    state.coupons = data.map((c) => ({ ...c, used: used[c.id] || 0 }));
    renderCoupons();
  }
  function renderCoupons() {
    $("c-rows").innerHTML = state.coupons.length
      ? state.coupons.map((c) => `<tr class="${c.is_active ? "" : "row-off"}"><td class="mono">${escapeHtml(c.code)}</td><td>${escapeHtml(c.name)}</td>
          <td>${c.kind === "amount" ? won(c.value) : c.value + "%" + (c.max_discount ? ` (최대 ${won(c.max_discount)})` : "")}</td>
          <td>${c.min_order ? won(c.min_order) + " 이상" : "-"} · 1인 ${c.per_user_limit}회</td>
          <td class="nowrap">${c.starts_at ? fmtDate(c.starts_at) : "즉시"} ~ ${c.ends_at ? fmtDate(c.ends_at) : "무기한"}</td>
          <td class="num">${num(c.used)}${c.total_limit ? " / " + num(c.total_limit) : ""}</td>
          <td><button type="button" class="pill ${c.is_active ? "pill-on" : ""}" data-c-toggle="${c.id}">${c.is_active ? "활성" : "중지"}</button></td>
          <td><button type="button" class="link link-danger" data-c-del="${c.id}">삭제</button></td></tr>`).join("")
      : `<tr><td colspan="8" class="muted">등록된 쿠폰이 없습니다.</td></tr>`;
  }
  $("c-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const fail = (m) => ($("c-error").textContent = m);
    fail("");
    const row = {
      code: f.code.value.trim().toUpperCase(), name: f.name.value.trim(), kind: f.kind.value, value: parseInt(f.value.value, 10),
      min_order: intOrNull(f.min_order.value) || 0, max_discount: intOrNull(f.max_discount.value), total_limit: intOrNull(f.total_limit.value),
      per_user_limit: intOrNull(f.per_user_limit.value) || 1, starts_at: isoOrNull(f.starts_at.value), ends_at: isoOrNull(f.ends_at.value),
    };
    if (!/^[A-Z0-9_-]{3,30}$/.test(row.code)) return fail("코드는 영문 대문자/숫자/-/_ 3~30자로 입력해 주세요.");
    if (!row.value || (row.kind === "percent" && row.value > 100)) return fail("할인값을 확인해 주세요. (정률은 1~100)");
    if (row.starts_at && row.ends_at && row.starts_at > row.ends_at) return fail("종료일이 시작일보다 빠릅니다.");
    const { error } = await sb.from("coupons").insert(row);
    if (error) return fail(error.message.includes("duplicate") ? "이미 있는 코드입니다." : error.message);
    e.target.reset();
    toast("쿠폰을 등록했습니다.");
    loadCoupons();
  });
  $("c-rows").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const c = state.coupons.find((x) => x.id === Number(b.dataset.cToggle || b.dataset.cDel));
    if (b.dataset.cDel) {
      if (!confirm(`쿠폰 ${c.code} 을(를) 삭제할까요? 사용 이력이 있으면 삭제할 수 없으니 '중지'를 사용하세요.`)) return;
      const { error } = await sb.from("coupons").delete().eq("id", c.id);
      return error ? toast("사용 이력이 있어 삭제할 수 없습니다. 중지해 주세요.") : loadCoupons();
    }
    const { error } = await sb.from("coupons").update({ is_active: !c.is_active }).eq("id", c.id);
    if (error) return toast(error.message);
    loadCoupons();
  });

  /* ---------- 배너 / 공지 / FAQ ---------- */
  const bannerUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/banners/${path.split("/").map(encodeURIComponent).join("/")}`;
  async function loadContent() {
    const [b, n, f] = await Promise.all([
      sb.from("banners").select("*").order("sort_order").order("id"),
      sb.from("notices").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false }),
      sb.from("faqs").select("*").order("sort_order").order("id"),
    ]);
    state.banners = b.data || []; state.notices = n.data || []; state.faqs = f.data || [];
    const empty = (cols, t) => `<tr><td colspan="${cols}" class="muted">${t}</td></tr>`;
    $("b-rows").innerHTML = state.banners.length ? state.banners.map((x) => `<tr class="${x.is_active ? "" : "row-off"}"><td><img src="${escapeHtml(bannerUrl(x.image_path))}" alt="" style="height:44px" /></td><td>${escapeHtml(x.title)}</td><td>${escapeHtml(x.link_url) || "-"}</td>
        <td class="nowrap">${x.starts_at ? fmtDate(x.starts_at) : "즉시"} ~ ${x.ends_at ? fmtDate(x.ends_at) : "무기한"}</td>
        <td><input type="number" value="${x.sort_order}" data-b-order="${x.id}" style="width:64px" /></td>
        <td><button type="button" class="pill ${x.is_active ? "pill-on" : ""}" data-b-toggle="${x.id}">${x.is_active ? "노출" : "숨김"}</button></td>
        <td><button type="button" class="link link-danger" data-b-del="${x.id}">삭제</button></td></tr>`).join("") : empty(7, "등록된 배너가 없습니다.");
    $("n-rows").innerHTML = state.notices.length ? state.notices.map((x) => `<tr><td class="nowrap">${fmtDate(x.created_at)}</td><td>${escapeHtml(x.title)}</td><td>${escapeHtml(x.body)}</td>
        <td><button type="button" class="pill ${x.is_pinned ? "pill-on" : ""}" data-n-pin="${x.id}">${x.is_pinned ? "고정" : "일반"}</button></td>
        <td><button type="button" class="link link-danger" data-n-del="${x.id}">삭제</button></td></tr>`).join("") : empty(5, "등록된 공지가 없습니다.");
    $("f-rows").innerHTML = state.faqs.length ? state.faqs.map((x) => `<tr><td><input type="number" value="${x.sort_order}" data-f-order="${x.id}" style="width:64px" /></td><td>${escapeHtml(x.question)}</td><td>${escapeHtml(x.answer)}</td>
        <td><button type="button" class="link link-danger" data-f-del="${x.id}">삭제</button></td></tr>`).join("") : empty(4, "등록된 FAQ가 없습니다.");
  }
  async function contentOp(promise, okMsg) {
    const { error } = await promise;
    if (error) return toast(error.message);
    if (okMsg) toast(okMsg);
    loadContent();
  }
  $("b-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const file = f.image.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return toast("jpg/png/webp만 올릴 수 있습니다.");
    if (file.size > 5 * 1024 * 1024) return toast("5MB를 넘습니다.");
    const link = f.link_url.value.trim();
    if (link && !/^(https?:\/\/|[\w./?=&#-]+$)/.test(link)) return toast("링크 형식을 확인해 주세요. (http(s):// 또는 상대경로)");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from("banners").upload(path, file, { contentType: file.type });
    if (up.error) return toast(up.error.message);
    await contentOp(sb.from("banners").insert({ title: f.title.value.trim(), image_path: path, link_url: link, starts_at: isoOrNull(f.starts_at.value), ends_at: isoOrNull(f.ends_at.value), sort_order: state.banners.length }), "배너를 등록했습니다.");
    e.target.reset();
  });
  $("n-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    await contentOp(sb.from("notices").insert({ title: f.title.value.trim(), body: f.body.value.trim(), is_pinned: f.is_pinned.checked }), "공지를 등록했습니다.");
    e.target.reset();
  });
  $("f-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    await contentOp(sb.from("faqs").insert({ question: f.question.value.trim(), answer: f.answer.value.trim(), sort_order: intOrNull(f.sort_order.value) || 0 }), "FAQ를 등록했습니다.");
    e.target.reset();
  });
  $("tab-content").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const d = btn.dataset;
    if (d.bToggle) { const x = state.banners.find((v) => v.id === Number(d.bToggle)); return contentOp(sb.from("banners").update({ is_active: !x.is_active }).eq("id", x.id)); }
    if (d.bDel) {
      if (!confirm("배너를 삭제할까요?")) return;
      const x = state.banners.find((v) => v.id === Number(d.bDel));
      await sb.storage.from("banners").remove([x.image_path]);
      return contentOp(sb.from("banners").delete().eq("id", x.id), "삭제했습니다.");
    }
    if (d.nPin) { const x = state.notices.find((v) => v.id === Number(d.nPin)); return contentOp(sb.from("notices").update({ is_pinned: !x.is_pinned }).eq("id", x.id)); }
    if (d.nDel && confirm("공지를 삭제할까요?")) return contentOp(sb.from("notices").delete().eq("id", Number(d.nDel)), "삭제했습니다.");
    if (d.fDel && confirm("FAQ를 삭제할까요?")) return contentOp(sb.from("faqs").delete().eq("id", Number(d.fDel)), "삭제했습니다.");
  });
  $("tab-content").addEventListener("change", (e) => {
    const t = e.target;
    const v = parseInt(t.value, 10) || 0;
    if (t.dataset.bOrder) contentOp(sb.from("banners").update({ sort_order: v }).eq("id", Number(t.dataset.bOrder)));
    if (t.dataset.fOrder) contentOp(sb.from("faqs").update({ sort_order: v }).eq("id", Number(t.dataset.fOrder)));
  });

  /* ---------- 매출 대시보드 (admin_dashboard RPC: 매출은 결제완료~배송완료만, 취소는 취소율에만 반영) ---------- */
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("d-to").value = ymd(new Date());
  $("d-from").value = ymd(new Date(Date.now() - 29 * 86400000));
  async function loadDashboard() {
    $("d-error").textContent = "";
    $("d-body").innerHTML = `<p class="muted">불러오는 중...</p>`;
    const { data, error } = await sb.rpc("admin_dashboard", { p_from: $("d-from").value, p_to: $("d-to").value, p_unit: $("d-unit").value });
    if (error) { $("d-body").innerHTML = ""; return ($("d-error").textContent = error.message); }
    const sm = data.summary;
    const max = Math.max(1, ...data.series.map((r) => r.revenue));
    const unitLabel = { day: "일", week: "주", month: "월" }[$("d-unit").value];
    $("d-body").innerHTML = `
      <div class="dash-cards">
        <div>매출<b>${won(Number(sm.revenue))}</b></div><div>주문 수<b>${num(sm.orders)}건</b></div>
        <div>객단가<b>${won(Number(sm.aov))}</b></div><div>취소율<b>${sm.cancel_rate}% <small class="muted">(${sm.canceled}건)</small></b></div>
      </div>
      <h3 class="admin-sub">${unitLabel}별 매출</h3>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>기간</th><th>주문</th><th>매출</th><th></th></tr></thead><tbody>${
        data.series.map((r) => `<tr><td>${escapeHtml(r.period)}</td><td class="num">${num(r.orders)}</td><td class="num">${won(Number(r.revenue))}</td><td><span class="dash-bar" style="width:${Math.round((r.revenue / max) * 100)}%"></span></td></tr>`).join("") || `<tr><td colspan="4" class="muted">해당 기간 매출이 없습니다.</td></tr>`
      }</tbody></table></div>
      <h3 class="admin-sub">카테고리별 판매</h3>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>카테고리</th><th>수량</th><th>매출</th></tr></thead><tbody>${
        data.categories.map((r) => `<tr><td>${escapeHtml(CATEGORIES[r.cat] ? CATEGORIES[r.cat].name : "기타(삭제된 상품)")}</td><td class="num">${num(r.qty)}</td><td class="num">${won(Number(r.revenue))}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">데이터가 없습니다.</td></tr>`
      }</tbody></table></div>
      <h3 class="admin-sub">베스트셀러 Top 10</h3>
      <div class="table-wrap"><table class="admin-table"><thead><tr><th>#</th><th>상품</th><th>수량</th><th>매출</th></tr></thead><tbody>${
        data.top_products.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(r.name)} <small class="muted mono">${escapeHtml(r.product_id)}</small></td><td class="num">${num(r.qty)}</td><td class="num">${won(Number(r.revenue))}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">데이터가 없습니다.</td></tr>`
      }</tbody></table></div>`;
  }
  $("d-run").onclick = loadDashboard;

  /* ---------- 감사 로그(조회 전용) ---------- */
  async function loadAudit() {
    $("a-rows").innerHTML = `<tr><td colspan="6" class="muted">불러오는 중...</td></tr>`;
    let q = sb.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
    if ($("a-table").value) q = q.eq("table_name", $("a-table").value);
    const [{ data, error }, { data: members }] = await Promise.all([q, sb.from("profiles").select("id, email")]);
    if (error) return ($("a-rows").innerHTML = `<tr><td colspan="6" class="pay-error">${escapeHtml(error.message)}</td></tr>`);
    const emails = Object.fromEntries((members || []).map((m) => [m.id, m.email]));
    const diff = (r) => {
      if (!r.before || !r.after) return r.action === "INSERT" ? "신규 등록" : "삭제";
      return Object.keys(r.after).filter((k) => JSON.stringify(r.before[k]) !== JSON.stringify(r.after[k]) && !["updated_at", "paid_at"].includes(k))
        .map((k) => `${k}: ${JSON.stringify(r.before[k])} → ${JSON.stringify(r.after[k])}`).join(", ");
    };
    $("a-count").textContent = `최근 ${num(data.length)}건`;
    $("a-rows").innerHTML = data.length
      ? data.map((r) => `<tr><td class="nowrap">${fmtDateTime(r.created_at)}</td><td>${escapeHtml(r.table_name)}</td><td class="mono">${escapeHtml(r.row_id || "")}</td><td>${r.action}</td><td>${r.actor ? escapeHtml(emails[r.actor] || r.actor.slice(0, 8)) : "시스템"}</td><td><small>${escapeHtml(diff(r)).slice(0, 300)}</small></td></tr>`).join("")
      : `<tr><td colspan="6" class="muted">기록이 없습니다.</td></tr>`;
  }
  $("a-table").addEventListener("input", loadAudit);

  /* 주문 변경 실시간 반영(Realtime). 구독도 RLS를 따르므로 관리자만 타인 주문을 받는다. */
  let refreshTimer = null;
  sb.channel("admin-orders")
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
      const o = payload.new || {};
      if (payload.eventType === "UPDATE" && o.status === "paid") toast(`새 주문이 결제되었습니다. (${o.order_name || o.id})`);
      else if (payload.eventType === "UPDATE" && o.status === "canceled") toast(`주문이 취소되었습니다. (${o.order_name || o.id})`);
      if (state.loaded.orders) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(loadOrders, 500);
      }
    })
    .subscribe();

  const initial = location.hash.slice(1);
  showTab(loaders[initial] ? initial : "products");
});
