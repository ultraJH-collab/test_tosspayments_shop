/* 공지사항 / FAQ (notice.html, faq.html 공용). 본문은 항상 텍스트로 출력한다. */
onReady(async () => {
  const root = document.getElementById("content-root");
  const isNotice = document.body.dataset.page === "notice";
  const query = isNotice
    ? sb.from("notices").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false })
    : sb.from("faqs").select("*").order("sort_order").order("id");
  const { data, error } = sb ? await query : { data: [] };
  if (error) return (root.innerHTML = `<p class="pay-error">${escapeHtml(error.message)}</p>`);
  if (!data.length) return (root.innerHTML = `<p class="muted">등록된 ${isNotice ? "공지사항" : "질문"}이 없습니다.</p>`);
  root.innerHTML = data
    .map((r) =>
      isNotice
        ? `<details class="c-item"><summary>${r.is_pinned ? '<span class="pill pill-on">고정</span> ' : ""}<b>${escapeHtml(r.title)}</b> <span class="muted">${new Date(r.created_at).toLocaleDateString("ko-KR")}</span></summary><p class="c-body">${escapeHtml(r.body)}</p></details>`
        : `<details class="c-item"><summary><b>Q. ${escapeHtml(r.question)}</b></summary><p class="c-body">${escapeHtml(r.answer)}</p></details>`
    )
    .join("");
});
