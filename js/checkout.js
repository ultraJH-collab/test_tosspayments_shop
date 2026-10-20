/* 주문/결제 - 토스페이먼츠 결제위젯 v2 (테스트 환경) */

// 토스페이먼츠 문서에 공개된 "결제위젯 연동 키" 테스트용 클라이언트 키입니다.
// 내 상점 테스트 키로 바꾸려면 개발자센터 > API 키 > 결제위젯 연동 키(test_gck_...)를 넣으세요.
// test_ 로 시작하는 키만 허용합니다(라이브 키 사용 방지).
const TOSS_CLIENT_KEY = "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm";

onReady(async () => {
  const root = document.getElementById("checkout-root");
  const isBuyNow = qs("mode") === "buynow";
  const items = isBuyNow ? storeGet(sessionStorage, "fr_buynow", []).filter((i) => findProduct(i.id)) : Cart.items();

  if (!items.length) {
    root.innerHTML = `<div class="empty box"><p>주문할 상품이 없습니다.</p><a class="btn btn-black" href="index.html">쇼핑하러 가기</a></div>`;
    return;
  }

  const o = calcOrder(items);

  root.innerHTML = `
    <div class="order-layout">
      <div>
        <section class="box">
          <div class="box-title">주문 상품 ${o.lines.length}개</div>
          ${o.lines.map((l) => `
            <div class="line-item">
              <div class="li-img">${productImage(l.product)}</div>
              <div>
                <p class="li-brand">${escapeHtml(l.product.brand)}</p>
                <p class="li-name">${escapeHtml(l.product.name)}</p>
                <p class="li-opt">옵션: ${escapeHtml(l.size)} / 수량: ${l.qty}개</p>
              </div>
              <div class="li-price">${l.lineOrigin !== l.lineTotal ? `<del>${won(l.lineOrigin)}</del>` : ""}<b>${won(l.lineTotal)}</b></div>
            </div>`).join("")}
        </section>

        <section class="box" style="margin-top:40px">
          <div class="box-title">주문자 / 배송 정보
            ${Auth.user ? "" : `<a class="guest-login" href="${loginUrl()}">로그인하고 주문내역 저장하기 ›</a>`}
          </div>
          <div class="form-grid">
            <label for="c-name">받는 분</label><input id="c-name" placeholder="이름" autocomplete="name" />
            <label for="c-phone">휴대폰</label><input id="c-phone" placeholder="숫자만 입력 (예: 01012345678)" inputmode="numeric" autocomplete="tel" />
            <label for="c-email">이메일</label><input id="c-email" type="email" placeholder="주문 안내를 받을 이메일" autocomplete="email" />
            <label for="c-zip">주소</label>
            <div class="inline"><input id="c-zip" placeholder="우편번호" readonly /><button type="button" class="btn btn-line" id="btn-zip">주소 검색</button></div>
            <span></span><input id="c-addr1" placeholder="기본 주소" readonly />
            <span></span><input id="c-addr2" placeholder="상세 주소" />
            <label for="c-memo">배송 메모</label>
            <select id="c-memo">
              <option>배송 메모를 선택해 주세요</option>
              <option>문 앞에 놓아주세요</option>
              <option>경비실에 맡겨주세요</option>
              <option>배송 전 연락 바랍니다</option>
            </select>
          </div>
        </section>

        <section class="box" style="margin-top:40px">
          <div class="box-title">결제 수단</div>
          <div id="payment-method"></div>
          <div id="agreement"></div>
        </section>
      </div>

      <aside class="summary">
        <h3>결제 금액</h3>
        <div class="sum-row"><span>상품 금액</span><span>${won(o.origin)}</span></div>
        <div class="sum-row disc"><span>할인 금액</span><span>-${won(o.discount)}</span></div>
        <div class="sum-row"><span>배송비</span><span>${o.shipping ? won(o.shipping) : "무료"}</span></div>
        <div class="sum-total"><span>최종 결제 금액</span><strong>${won(o.total)}</strong></div>
        <button type="button" class="btn btn-blue" id="btn-pay" disabled>결제 준비 중...</button>
        <p class="pay-error" id="pay-error"></p>
      </aside>
    </div>`;

  const payBtn = document.getElementById("btn-pay");
  const errEl = document.getElementById("pay-error");
  const showError = (msg) => (errEl.textContent = msg);

  // 로그인 회원은 회원 정보로 미리 채운다.
  if (Auth.user) {
    document.getElementById("c-name").value = (Auth.profile && Auth.profile.name) || "";
    document.getElementById("c-phone").value = (Auth.profile && Auth.profile.phone) || "";
    document.getElementById("c-email").value = Auth.user.email || "";
  }

  document.getElementById("btn-zip").onclick = () => {
    document.getElementById("c-zip").value = "06236";
    document.getElementById("c-addr1").value = "서울특별시 강남구 테헤란로 000 (예시 주소)";
    toast("퍼블리싱 데모: 예시 주소를 입력했어요.");
  };

  /* ---------- 토스페이먼츠 결제위젯 ---------- */
  if (location.protocol === "file:") {
    payBtn.textContent = "결제 불가";
    return showError("결제위젯은 file:// 에서 동작하지 않습니다. serve.ps1 로 로컬 서버(http://localhost)를 실행한 뒤 접속해 주세요.");
  }
  if (typeof TossPayments === "undefined") {
    payBtn.textContent = "결제 불가";
    return showError("토스페이먼츠 SDK를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
  }
  if (!TOSS_CLIENT_KEY.startsWith("test_")) {
    payBtn.textContent = "결제 불가";
    return showError("테스트 키(test_...)만 사용할 수 있습니다.");
  }
  if (!App.online) {
    payBtn.textContent = "결제 불가";
    return showError("주문 서버(Supabase)에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.");
  }

  let widgets;
  try {
    const tossPayments = TossPayments(TOSS_CLIENT_KEY);
    // 회원은 회원 ID를 customerKey로 써서 토스 쪽에서도 구매자를 구분한다.
    widgets = tossPayments.widgets({ customerKey: Auth.user ? Auth.user.id : TossPayments.ANONYMOUS });
    await widgets.setAmount({ currency: "KRW", value: o.total });

    const [, agreement] = await Promise.all([
      widgets.renderPaymentMethods({ selector: "#payment-method", variantKey: "DEFAULT" }),
      widgets.renderAgreement({ selector: "#agreement", variantKey: "AGREEMENT" }),
    ]);

    payBtn.disabled = false;
    payBtn.textContent = `${won(o.total)} 결제하기`;

    agreement.on("agreementStatusChange", (status) => {
      payBtn.disabled = !status.agreedRequiredTerms;
    });
  } catch (err) {
    console.error(err);
    payBtn.textContent = "결제 불가";
    return showError(`결제위젯 로딩 실패: ${err.message || err}`);
  }

  payBtn.addEventListener("click", async () => {
    showError("");
    const name = document.getElementById("c-name").value.trim();
    const phone = document.getElementById("c-phone").value.replace(/\D/g, "");
    const email = document.getElementById("c-email").value.trim();
    if (!name) return showError("받는 분 이름을 입력해 주세요.");
    if (phone && !/^01\d{8,9}$/.test(phone)) return showError("휴대폰 번호를 확인해 주세요.");

    const memo = document.getElementById("c-memo");
    payBtn.disabled = true;

    // DB에 결제대기 주문을 만든다. 주문번호와 결제 금액은 DB가 상품가로 다시 계산해 돌려준다.
    const { data: order, error } = await sb.rpc("create_order", {
      p_items: items,
      p_customer: {
        name,
        phone,
        email,
        zip: document.getElementById("c-zip").value,
        addr1: document.getElementById("c-addr1").value,
        addr2: document.getElementById("c-addr2").value.trim(),
        memo: memo.selectedIndex > 0 ? memo.value : "",
      },
    });
    if (error) {
      payBtn.disabled = false;
      return showError(error.message || "주문을 생성하지 못했습니다.");
    }
    if (order.amount !== o.total) {
      payBtn.disabled = false;
      return showError("상품 가격이 변경되었습니다. 페이지를 새로고침한 뒤 다시 결제해 주세요.");
    }
    const orderId = order.order_id;

    // 결제 성공 후 금액 위변조 확인용으로 주문 정보를 보관합니다.
    storeSet(sessionStorage, "fr_pending_order", {
      orderId,
      orderName: order.order_name,
      amount: order.amount,
      mode: isBuyNow ? "buynow" : "cart",
      items,
    });

    try {
      await widgets.requestPayment({
        orderId,
        orderName: order.order_name,
        successUrl: location.origin + location.pathname.replace(/checkout\.html$/, "success.html"),
        failUrl: location.origin + location.pathname.replace(/checkout\.html$/, "fail.html"),
        customerName: name,
        customerEmail: email || undefined,
        customerMobilePhone: phone || undefined,
      });
    } catch (err) {
      // 사용자가 결제창을 닫은 경우 등. 결제대기 주문은 실패로 남긴다.
      sb.rpc("mark_order_failed", { p_order_id: orderId }).then(() => {});
      payBtn.disabled = false;
      showError(err.message || "결제가 취소되었습니다.");
    }
  });
});
