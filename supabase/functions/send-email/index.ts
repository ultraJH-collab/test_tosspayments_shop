// 주문 확인/배송 시작/주문 취소 메일(Resend). 호출자: confirm-payment·cancel-payment(서비스 롤 키) 또는 관리자(JWT).
// secrets: RESEND_API_KEY (없으면 발송을 건너뜀), EMAIL_FROM (기본 onboarding@resend.dev)
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const won = (n: number) => n.toLocaleString("ko-KR") + "원";

const SUBJECT: Record<string, string> = {
  paid: "[FITROOM] 주문이 완료되었습니다",
  shipping: "[FITROOM] 상품이 발송되었습니다",
  canceled: "[FITROOM] 주문이 취소되었습니다",
};
// 메일 종류별로 주문이 실제로 그 상태일 때만 보낸다(임의 메일 발송 방지).
const STATUS_FOR: Record<string, string> = { paid: "paid", shipping: "shipping", canceled: "canceled" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(url, serviceKey);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (token !== serviceKey) {
    const { data: u } = await db.auth.getUser(token);
    const { data: me } = u?.user ? await db.from("profiles").select("role, status").eq("id", u.user.id).maybeSingle() : { data: null };
    if (!me || me.role !== "admin" || me.status !== "active") return json({ error: "권한이 없습니다." }, 403);
  }

  const { orderId, type } = await req.json().catch(() => ({}));
  if (!orderId || !SUBJECT[type]) return json({ error: "잘못된 요청입니다." }, 400);

  const { data: o } = await db.from("orders").select("*, order_items(*)").eq("id", orderId).maybeSingle();
  if (!o) return json({ error: "주문을 찾을 수 없습니다." }, 404);
  if (o.status !== STATUS_FOR[type] && !(type === "shipping" && o.status === "delivered")) return json({ skipped: "status_mismatch" });
  if (!o.customer_email) return json({ skipped: "no_email" });

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("RESEND_API_KEY 미설정: 메일 발송을 건너뜁니다.", orderId, type);
    return json({ skipped: "no_api_key" });
  }

  const items = (o.order_items as Array<Record<string, unknown>>)
    .map((i) => `<li>${esc(i.brand)} ${esc(i.product_name)} · ${esc(i.size)} · ${esc(i.qty)}개</li>`).join("");
  const extra = type === "shipping" && o.tracking_no ? `<p>택배사: ${esc(o.courier)} / 운송장 번호: <b>${esc(o.tracking_no)}</b></p>` : "";
  const cancel = type === "canceled" ? `<p>취소 사유: ${esc(o.cancel_reason)}<br>결제 금액은 전액 환불됩니다.</p>` : "";
  const html = `<div style="font-family:sans-serif"><h2>${esc(SUBJECT[type].replace("[FITROOM] ", ""))}</h2>
    <p>${esc(o.customer_name)}님, 주문번호 <b>${esc(o.id)}</b></p><ul>${items}</ul>
    <p>결제금액: <b>${won(o.amount)}</b></p>${extra}${cancel}</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("EMAIL_FROM") ?? "FITROOM <onboarding@resend.dev>", to: [o.customer_email], subject: SUBJECT[type], html }),
  });
  if (!res.ok) {
    console.error("resend failed", orderId, type, res.status, await res.text());
    return json({ error: "메일 발송에 실패했습니다." }, 502);
  }
  return json({ sent: true });
});
