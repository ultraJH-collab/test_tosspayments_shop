// 회원 탈퇴: 로그인한 본인의 auth 계정을 삭제한다(서비스 롤은 함수 환경에서만 사용).
// profiles/찜/장바구니/배송지/후기는 FK cascade 로 삭제되고, 주문은 user_id 가 null 이 되어 거래 기록만 남는다.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "로그인이 필요합니다." }, 401);

  const { data: me } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (me?.role === "admin") return json({ error: "관리자 계정은 탈퇴할 수 없습니다. 먼저 권한을 변경해 주세요." }, 403);

  // 결제 완료 후 배송 전인 주문이 있으면 먼저 취소/배송 완료를 처리해야 한다.
  const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).in("status", ["pending", "paid", "shipping"]);
  if (count) return json({ error: "진행 중인 주문이 있어 탈퇴할 수 없습니다. 주문을 취소하거나 배송 완료 후 다시 시도해 주세요." }, 409);

  const { error } = await db.auth.admin.deleteUser(u.user.id);
  if (error) {
    console.error("deleteUser failed", u.user.id, error.message);
    return json({ error: "탈퇴 처리에 실패했습니다." }, 500);
  }
  return json({ ok: true });
});
