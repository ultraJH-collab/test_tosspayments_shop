/* SEO / AEO / GEO: 동적 메타 태그와 구조화 데이터(JSON-LD).
   정적 메타(description, Open Graph, robots)는 각 HTML <head>에 있고, 여기서는 상품/카테고리 데이터가 필요한 부분과
   canonical·og:url 같은 주소 의존 값을 채운다. (js/common.js 다음에 로드) */
const SITE_NAME = "FITROOM";
// 프로덕션 주소(Vercel). canonical·구조화 데이터는 미리보기 배포에서도 이 주소를 가리켜 중복 색인을 막는다.
// sitemap.xml / robots.txt / llms.txt 의 주소와 같아야 한다.
const SITE_URL = "https://testtosspaymentsshop-six.vercel.app/";
const SEO = {
  // 로컬 개발(localhost)에서는 현재 폴더 주소, 그 외에는 프로덕션 주소. 끝에 / 포함.
  base() {
    return /^(localhost|127.0.0.1|[::1])$/.test(location.hostname) ? location.origin + location.pathname.replace(/[^/]*$/, "") : SITE_URL;
  },
  page() {
    return location.pathname.split("/").pop() || "index.html";
  },
  abs(path) {
    return /^https?:/.test(path) ? path : this.base() + path;
  },
  meta(attr, key, value) {
    if (!value) return;
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", value);
  },
  canonical(url) {
    let el = document.head.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement("link");
      el.rel = "canonical";
      document.head.appendChild(el);
    }
    el.href = url;
    this.meta("property", "og:url", url);
  },
  // 제목·설명·이미지를 한 번에 갱신(일반 meta + Open Graph + Twitter).
  set({ title, description, image, url, type }) {
    if (title) {
      document.title = title;
      this.meta("property", "og:title", title);
      this.meta("name", "twitter:title", title);
    }
    if (description) {
      this.meta("name", "description", description);
      this.meta("property", "og:description", description);
      this.meta("name", "twitter:description", description);
    }
    if (image) {
      this.meta("property", "og:image", image);
      this.meta("name", "twitter:image", image);
      this.meta("name", "twitter:card", "summary_large_image");
    }
    if (type) this.meta("property", "og:type", type);
    if (url) this.canonical(url);
  },
  // id 별로 하나의 <script type="application/ld+json">을 유지한다(다시 호출하면 교체).
  jsonLd(id, data) {
    let el = document.getElementById("ld-" + id);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = "ld-" + id;
      document.head.appendChild(el);
    }
    // </script> 로 조기 종료되지 않도록 < 를 이스케이프한다.
    el.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
  },
  breadcrumb(items) {
    this.jsonLd("breadcrumb", {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: items.map(([name, url], i) => ({ "@type": "ListItem", position: i + 1, name, item: url })),
    });
  },
  imageOf(p) {
    return p.images && p.images[0] ? imageUrl(p.images[0]) : undefined;
  },

  /* 상품 상세: Product(가격·재고·평점·후기) + 답변된 공개 Q&A(FAQPage) + 빵부스러기 */
  product(p, { reviews = [], qna = [] } = {}) {
    const url = this.base() + "product.html?id=" + encodeURIComponent(p.id);
    const cat = CATEGORIES[p.cat];
    const image = this.imageOf(p);
    const desc = `${p.brand} ${p.name} — ${num(p.sale)}원${discountRate(p) > 0 ? ` (${discountRate(p)}% 할인)` : ""}. ${cat.name} · 사이즈 ${p.sizes.join(", ")}. FITROOM에서 5만원 이상 무료배송.`;
    this.set({ title: `${p.brand} ${p.name} | FITROOM`, description: desc, image, url, type: "product" });
    const data = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: p.name,
      sku: p.id,
      brand: { "@type": "Brand", name: p.brand },
      category: cat.name,
      description: desc,
      url,
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: "KRW",
        price: p.sale,
        availability: isSoldOut(p) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    };
    if (p.images && p.images.length) data.image = p.images.map((x) => imageUrl(x));
    // 평점은 실제 후기가 있을 때만 노출한다(없는 값을 꾸며내지 않는다).
    if (reviews.length) {
      const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
      data.aggregateRating = { "@type": "AggregateRating", ratingValue: Number(avg.toFixed(1)), reviewCount: reviews.length, bestRating: 5, worstRating: 1 };
      data.review = reviews.slice(0, 5).map((r) => ({
        "@type": "Review",
        author: { "@type": "Person", name: r.author },
        datePublished: r.created_at.slice(0, 10),
        reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
        reviewBody: r.body,
      }));
    }
    this.jsonLd("product", data);
    this.breadcrumb([["홈", this.base()], [cat.name, this.base() + cat.page], [p.name, url]]);
    const answered = qna.filter((q) => q.answer && !q.is_secret);
    if (answered.length) {
      this.jsonLd("qna", {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: answered.slice(0, 10).map((q) => ({ "@type": "Question", name: q.body, acceptedAnswer: { "@type": "Answer", text: q.answer } })),
      });
    }
  },

  /* 카테고리/검색 목록: CollectionPage + ItemList */
  collection(key) {
    const cat = CATEGORIES[key];
    const list = PRODUCTS.filter((p) => p.cat === key);
    const url = this.base() + cat.page;
    this.set({
      title: `${cat.name} 랭킹·신상 | FITROOM`,
      description: `FITROOM ${cat.name} ${list.length}개 상품. 인기순·최신순·가격순 정렬, 사이즈·색상·가격 필터, 5만원 이상 무료배송.`,
      url,
      type: "website",
    });
    this.jsonLd("collection", {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: `${cat.name} | ${SITE_NAME}`,
      url,
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: list.length,
        itemListElement: list.slice(0, 30).map((p, i) => ({ "@type": "ListItem", position: i + 1, url: this.base() + "product.html?id=" + encodeURIComponent(p.id), name: `${p.brand} ${p.name}` })),
      },
    });
    this.breadcrumb([["홈", this.base()], [cat.name, url]]);
  },

  /* 홈: 사이트/조직 정보와 사이트 검색(SearchAction) */
  home() {
    const base = this.base();
    this.set({ url: base, type: "website" });
    this.jsonLd("site", {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", "@id": base + "#org", name: SITE_NAME, url: base, description: "상의·바지·신발을 모은 패션 스토어 FITROOM (결제는 토스페이먼츠 테스트 환경)" },
        {
          "@type": "WebSite",
          "@id": base + "#site",
          url: base,
          name: SITE_NAME,
          inLanguage: "ko-KR",
          publisher: { "@id": base + "#org" },
          potentialAction: { "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: base + "search.html?q={search_term_string}" }, "query-input": "required name=search_term_string" },
        },
      ],
    });
  },
};

// 모든 페이지: canonical(쿼리 제외, 상품은 product()가 덮어쓴다)과 공통 Open Graph
document.addEventListener("DOMContentLoaded", () => {
  const page = SEO.page();
  SEO.canonical(page === "index.html" ? SEO.base() : SEO.base() + page);
  SEO.meta("property", "og:site_name", SITE_NAME);
  SEO.meta("property", "og:locale", "ko_KR");
  if (!document.head.querySelector('meta[property="og:type"]')) SEO.meta("property", "og:type", "website");
  if (!document.head.querySelector('meta[property="og:title"]')) SEO.meta("property", "og:title", document.title);
  const d = document.head.querySelector('meta[name="description"]');
  if (d && !document.head.querySelector('meta[property="og:description"]')) SEO.meta("property", "og:description", d.content);
  SEO.meta("name", "twitter:card", "summary");
  if (page === "index.html" || page === "") SEO.home();
});
onReady(() => {
  const key = document.body.dataset.page;
  if (CATEGORIES[key] && SEO.page() !== "product.html" && SEO.page() !== "search.html") SEO.collection(key);
});
