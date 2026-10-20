/* 카테고리 + 상품 데이터
   상품은 Supabase products 테이블에서 불러와 PRODUCTS에 채운다(js/db.js).
   SEED_PRODUCTS는 DB 초기 데이터(supabase/migrations/002_seed_products.sql)와 같고,
   Supabase에 연결하지 못했을 때 화면을 보여주기 위한 대체 데이터로만 쓴다. */
const CATEGORIES = {
  tops: { name: "상의", en: "TOPS", page: "tops.html" },
  pants: { name: "바지", en: "PANTS", page: "pants.html" },
  shoes: { name: "신발", en: "SHOES", page: "shoes.html" },
};

const SEED_PRODUCTS = [
  // 상의
  { id: "t01", cat: "tops", brand: "LOWFIELD", name: "오버핏 헤비웨이트 반팔 티셔츠", price: 39000, sale: 29000, color: "#1a1a1a", tone: "#f2f2f2", sizes: ["S", "M", "L", "XL"], rating: 4.8, reviews: 2381, likes: 15400, tag: "BEST" },
  { id: "t02", cat: "tops", brand: "NORDHAUS", name: "릴렉스드 옥스포드 셔츠 스카이블루", price: 59000, sale: 47200, color: "#8fb3d9", tone: "#eef3f8", sizes: ["S", "M", "L", "XL"], rating: 4.7, reviews: 912, likes: 6210 },
  { id: "t03", cat: "tops", brand: "COVERSTUDIO", name: "피그먼트 다잉 후드 집업 차콜", price: 89000, sale: 62300, color: "#4a4a4a", tone: "#ececec", sizes: ["M", "L", "XL"], rating: 4.9, reviews: 1543, likes: 22100, tag: "NEW" },
  { id: "t04", cat: "tops", brand: "LOWFIELD", name: "베이직 크루넥 니트 오트밀", price: 69000, sale: 69000, color: "#d8c9ae", tone: "#f7f3ec", sizes: ["S", "M", "L"], rating: 4.6, reviews: 408, likes: 3320 },
  { id: "t05", cat: "tops", brand: "ARCHIVE 9", name: "로고 스웨트셔츠 멜란지 그레이", price: 72000, sale: 50400, color: "#a7a7a7", tone: "#f1f1f1", sizes: ["S", "M", "L", "XL"], rating: 4.8, reviews: 1120, likes: 9870 },
  { id: "t06", cat: "tops", brand: "NORDHAUS", name: "스트라이프 롱슬리브 티셔츠", price: 45000, sale: 36000, color: "#2c3e6b", tone: "#eef0f5", sizes: ["S", "M", "L", "XL"], rating: 4.5, reviews: 287, likes: 2140 },
  { id: "t07", cat: "tops", brand: "COVERSTUDIO", name: "워크 자켓 올리브", price: 139000, sale: 97300, color: "#6b6b3a", tone: "#f1f1e8", sizes: ["M", "L", "XL"], rating: 4.9, reviews: 654, likes: 11800, tag: "BEST" },
  { id: "t08", cat: "tops", brand: "ARCHIVE 9", name: "케이블 니트 가디건 아이보리", price: 98000, sale: 78400, color: "#ede6d6", tone: "#faf8f3", sizes: ["S", "M", "L"], rating: 4.7, reviews: 332, likes: 5410 },

  // 바지
  { id: "p01", cat: "pants", brand: "DENIMLAB", name: "와이드 데님 팬츠 미드블루", price: 79000, sale: 55300, color: "#4f6f9c", tone: "#eef2f7", sizes: ["28", "30", "32", "34"], rating: 4.8, reviews: 3201, likes: 28400, tag: "BEST" },
  { id: "p02", cat: "pants", brand: "LOWFIELD", name: "원턱 와이드 슬랙스 블랙", price: 59000, sale: 41300, color: "#1d1d1d", tone: "#efefef", sizes: ["S", "M", "L", "XL"], rating: 4.7, reviews: 2210, likes: 17600 },
  { id: "p03", cat: "pants", brand: "COVERSTUDIO", name: "나일론 카고 조거 팬츠", price: 69000, sale: 48300, color: "#3f4a3c", tone: "#eef0ed", sizes: ["S", "M", "L", "XL"], rating: 4.6, reviews: 845, likes: 7300, tag: "NEW" },
  { id: "p04", cat: "pants", brand: "DENIMLAB", name: "스트레이트 생지 데님 인디고", price: 89000, sale: 89000, color: "#22304d", tone: "#ebedf2", sizes: ["28", "30", "32", "34", "36"], rating: 4.9, reviews: 1189, likes: 12900 },
  { id: "p05", cat: "pants", brand: "NORDHAUS", name: "코튼 치노 팬츠 베이지", price: 55000, sale: 44000, color: "#c8b291", tone: "#f6f2ea", sizes: ["S", "M", "L", "XL"], rating: 4.5, reviews: 512, likes: 4100 },
  { id: "p06", cat: "pants", brand: "ARCHIVE 9", name: "스웨트 와이드 팬츠 그레이", price: 49000, sale: 34300, color: "#9a9a9a", tone: "#f2f2f2", sizes: ["S", "M", "L", "XL"], rating: 4.7, reviews: 1630, likes: 13300 },
  { id: "p07", cat: "pants", brand: "COVERSTUDIO", name: "파라슈트 팬츠 카키", price: 79000, sale: 63200, color: "#7a7452", tone: "#f2f1eb", sizes: ["M", "L", "XL"], rating: 4.6, reviews: 274, likes: 2980 },
  { id: "p08", cat: "pants", brand: "DENIMLAB", name: "버뮤다 데님 쇼츠 라이트블루", price: 49000, sale: 39200, color: "#9cb6d3", tone: "#f0f4f8", sizes: ["28", "30", "32", "34"], rating: 4.4, reviews: 198, likes: 1870 },

  // 신발
  { id: "s01", cat: "shoes", brand: "STRIDE", name: "레더 로우탑 스니커즈 화이트", price: 129000, sale: 99000, color: "#f4f4f4", tone: "#e9e9e9", sizes: ["240", "250", "260", "270", "280"], rating: 4.9, reviews: 4120, likes: 35200, tag: "BEST" },
  { id: "s02", cat: "shoes", brand: "STRIDE", name: "레트로 러닝화 그레이 네이비", price: 119000, sale: 95200, color: "#5a6a85", tone: "#eef0f4", sizes: ["240", "250", "260", "270", "280"], rating: 4.8, reviews: 1980, likes: 15100 },
  { id: "s03", cat: "shoes", brand: "OAKROW", name: "더비 슈즈 블랙 레더", price: 179000, sale: 143200, color: "#1b1b1b", tone: "#ededed", sizes: ["250", "260", "270", "280"], rating: 4.7, reviews: 640, likes: 6800 },
  { id: "s04", cat: "shoes", brand: "CANVAS CO.", name: "캔버스 하이탑 스니커즈 블랙", price: 69000, sale: 48300, color: "#222222", tone: "#f0f0f0", sizes: ["230", "240", "250", "260", "270", "280"], rating: 4.6, reviews: 2540, likes: 19900, tag: "NEW" },
  { id: "s05", cat: "shoes", brand: "OAKROW", name: "스웨이드 첼시 부츠 브라운", price: 199000, sale: 159200, color: "#7b5a3c", tone: "#f4efe9", sizes: ["250", "260", "270", "280"], rating: 4.8, reviews: 433, likes: 5200 },
  { id: "s06", cat: "shoes", brand: "STRIDE", name: "트레일 러닝화 올리브", price: 149000, sale: 119200, color: "#5d6a3e", tone: "#eff1ea", sizes: ["250", "260", "270", "280"], rating: 4.7, reviews: 389, likes: 4300 },
  { id: "s07", cat: "shoes", brand: "CANVAS CO.", name: "슬립온 스니커즈 체커보드", price: 59000, sale: 41300, color: "#3b3b3b", tone: "#f2f2f2", sizes: ["230", "240", "250", "260", "270"], rating: 4.5, reviews: 1210, likes: 8800 },
  { id: "s08", cat: "shoes", brand: "OAKROW", name: "페니 로퍼 버건디", price: 169000, sale: 135200, color: "#6a1f2b", tone: "#f5eced", sizes: ["250", "260", "270", "280"], rating: 4.6, reviews: 211, likes: 2600 },
];

const PRODUCTS = [];

function findProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}
