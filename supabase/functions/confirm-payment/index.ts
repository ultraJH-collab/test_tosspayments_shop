// 토스 결제 승인: success.html 이 호출한다. 시크릿 키는 함수 secret(TOSS_SECRET_KEY)에서만 읽는다.
import { createClient } from "jsr:@supabase/supabase-js@2";

// 미설정 시 토스 문서에 공개된 테스트 시크릿 키(client key test_gck_docs_... 와 짝)를 쓴다.
const SECRET = Deno.env.get("TOSS_SECRET_KEY") ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const basic = "Basic " + btoa(SECRET + ":");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SECRET.startsWith("test_")) return json({ error: "테스트 키(test_...)만 사용할 수 있습니다." }, 500);

  let body: { orderId?: string; paymentKey?: string; amount?: number };
  try { body = await req.json(); } catch { return json({ error: "잘못된 요청입니다." }, 400); }
  const { orderId, paymentKey } = body;
  const amount = Number(body.amount);
  if (!orderId || !paymentKey || !Number.isInteger(amount)) return json({ error: "잘못된 요청입니다." }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: order } = await db.from("orders").select("id, status, amount, payment_key").eq("id", orderId).maybeSingle();
  if (!order) return json({ error: "주문을 찾을 수 없습니다." }, 404);

  const result = (o: { id: string; order_name?: string; amount: number; status: string }) =>
    json({ order_id: o.id, order_name: o.order_name, amount: o.amount, status: o.status });

  // 멱등: 이미 같은 결제키로 승인된 주문은 현재 상태를 돌려준다.
  if (order.status !== "pending") {
    if (order.payment_key === paymentKey && order.amount === amount && ["paid", "shipping", "delivered"].includes(order.status)) {
      const { data } = await db.from("orders").select("id, order_name, amount, status").eq("id", orderId).single();
      return result(data!);
    }
    return json({ error: "처리할 수 없는 주문 상태입니다. (만료되었거나 이미 처리됨)" }, 409);
  }
  if (order.amount !== amount) return json({ error: "결제 금액이 주문 금액과 일치하지 않습니다." }, 400);

  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: { Authorization: basic, "Content-Type": "application/json", "Idempotency-Key": `confirm-${orderId}-${paymentKey}`.slice(0, 300) },
    body: JSON.stringify({ orderId, paymentKey, amount }),
  });
  let pay = await res.json().catch(() => ({}));

  // 이미 승인된 결제(중복 호출)는 조회로 확인한다.
  if (!res.ok && pay.code === "ALREADY_PROCESSED_PAYMENT") {
    const r = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`, { headers: { Authorization: basic } });
    pay = await r.json().catch(() => ({}));
    if (!r.ok || pay.status !== "DONE") return json({ error: "결제 상태를 확인할 수 없습니다." }, 502);
  } else if (!res.ok) {
    console.error("toss confirm failed", orderId, res.status, pay.code, pay.message);
    // 확정적 거절(4xx)만 주문을 실패 처리한다. 5xx/네트워크 오류는 재시도 가능하도록 둔다(미처리 시 10분 후 만료).
    if (res.status >= 400 && res.status < 500) {
      await db.rpc("mark_order_failed", { p_order_id: orderId, p_reason: `${pay.code ?? "CONFIRM_FAILED"}: ${pay.message ?? ""}` });
    }
    return json({ error: pay.message ?? "결제 승인에 실패했습니다.", code: pay.code }, res.status >= 500 ? 502 : 402);
  }

  if (pay.orderId !== orderId || pay.totalAmount !== amount || pay.status !== "DONE") {
    console.error("toss response mismatch", orderId, pay.orderId, pay.totalAmount, pay.status);
    return json({ error: "승인 응답이 주문 정보와 일치하지 않습니다." }, 502);
  }

  const { data: paid, error } = await db.rpc("mark_order_paid", {
    p_order_id: orderId, p_payment_key: paymentKey, p_amount: amount,
    p_method: pay.method ?? null, p_approved_at: pay.approvedAt ?? null,
  });
  if (error) {
    console.error("mark_order_paid failed after toss approval", orderId, error.message);
    return json({ error: "결제는 승인되었으나 주문 처리에 실패했습니다. 고객센터에 문의해 주세요." }, 500);
  }

  // 메일 알림(실패해도 결제/취소 결과에는 영향 없음)
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, type: "paid" }),
  }).catch((e) => console.error("send-email", e));
  return json(paid);
});
