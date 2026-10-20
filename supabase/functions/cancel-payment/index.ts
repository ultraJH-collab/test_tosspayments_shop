// 토스 결제 전액 취소: 주문 소유자 또는 관리자만 가능. 시크릿 키는 함수 secret(TOSS_SECRET_KEY).
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRET = Deno.env.get("TOSS_SECRET_KEY") ?? "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SECRET.startsWith("test_")) return json({ error: "테스트 키(test_...)만 사용할 수 있습니다." }, 500);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "로그인이 필요합니다." }, 401);

  let body: { orderId?: string; reason?: string };
  try { body = await req.json(); } catch { return json({ error: "잘못된 요청입니다." }, 400); }
  if (!body.orderId) return json({ error: "잘못된 요청입니다." }, 400);

  const { data: me } = await db.from("profiles").select("role, status").eq("id", u.user.id).maybeSingle();
  if (!me || me.status !== "active") return json({ error: "이용할 수 없는 계정입니다." }, 403);
  const isAdmin = me.role === "admin";

  const { data: order } = await db.from("orders").select("id, user_id, status, payment_key, amount").eq("id", body.orderId).maybeSingle();
  if (!order || (!isAdmin && order.user_id !== u.user.id)) return json({ error: "주문을 찾을 수 없습니다." }, 404);
  if (order.status !== "paid") return json({ error: "배송 전(결제완료) 주문만 취소할 수 있습니다. 배송 이후에는 고객센터에 문의해 주세요." }, 409);
  if (!order.payment_key) return json({ error: "결제 정보가 없는 주문입니다." }, 409);

  const reason = (body.reason ?? "").trim().slice(0, 200) || (isAdmin ? "관리자 취소" : "고객 요청");
  const res = await fetch(`https://api.tosspayments.com/v1/payments/${encodeURIComponent(order.payment_key)}/cancel`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(SECRET + ":"),
      "Content-Type": "application/json",
      "Idempotency-Key": `cancel-${order.id}`,
    },
    body: JSON.stringify({ cancelReason: reason }),
  });
  const pay = await res.json().catch(() => ({}));
  // 이미 토스에서 취소된 건은 DB만 맞춘다.
  if (!res.ok && pay.code !== "ALREADY_CANCELED_PAYMENT") {
    console.error("toss cancel failed", order.id, res.status, pay.code, pay.message);
    return json({ error: pay.message ?? "결제 취소에 실패했습니다.", code: pay.code }, res.status >= 500 ? 502 : 400);
  }

  const { data, error } = await db.rpc("cancel_order_db", { p_order_id: order.id, p_reason: reason });
  if (error) {
    console.error("cancel_order_db failed after toss cancel", order.id, error.message);
    return json({ error: "결제는 취소되었으나 주문 처리에 실패했습니다. 고객센터에 문의해 주세요." }, 500);
  }

  // 메일 알림(실패해도 결제/취소 결과에는 영향 없음)
  await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: order.id, type: "canceled" }),
  }).catch((e) => console.error("send-email", e));
  return json(data);
});
