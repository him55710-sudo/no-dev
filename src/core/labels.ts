import { words, type Lang } from "./types";
const dictionary: Record<string, [string, string]> = {
  freeShippingThreshold: ["무료 배송 기준", "Free shipping threshold"],
  shippingFee: ["기본 배송비", "Standard shipping fee"],
  subtotal: ["부분 합계", "Subtotal"],
  isMember: ["회원 여부", "Membership"],
  memberDiscount: ["회원 할인율", "Member discount"],
  total: ["합계", "Total"],
  price: ["가격", "Price"],
  quantity: ["수량", "Quantity"],
  discount: ["할인", "Discount"],
  calculateShipping: ["배송비 계산", "Calculate shipping"],
  calculateTotal: ["합계 계산", "Calculate total"],
  calculateDiscount: ["할인 계산", "Calculate discount"],
  createOrder: ["주문 만들기", "Create order"],
  loadProducts: ["상품 불러오기", "Load products"],
  order: ["주문", "Order"],
  products: ["상품 목록", "Products"],
  amount: ["값", "Amount"],
  maxItems: ["최대 항목 수", "Maximum items"],
  welcomeMessage: ["환영 문구", "Welcome message"],
  enabled: ["사용 여부", "Enabled"],
  taxRate: ["세율", "Tax rate"],
  retryCount: ["재시도 횟수", "Retry count"],
  timeout: ["대기 시간", "Timeout"],
  user: ["사용자", "User"],
  name: ["이름", "Name"],
  email: ["이메일", "Email"],
  status: ["상태", "Status"],
  items: ["항목 목록", "Items"],
  shipping: ["배송", "Shipping"],
  result: ["결과", "Result"],
  response: ["응답", "Response"],
};
export function label(name: string) {
  const key = name.replace(/[_-]([a-z])/g, (_, c: string) => c.toUpperCase());
  const d = dictionary[key];
  return d
    ? words(d[0], d[1])
    : words(
        `「${name}」`,
        name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "),
      );
}
export function describeName(name: string, lang: Lang) {
  return label(name)[lang];
}
export function particle(
  text: string,
  kind: "subject" | "object" | "with" = "subject",
) {
  const end = text.replace(/[\s“”「」()\[\]]+$/g, "").at(-1) || "";
  const code = end.charCodeAt(0);
  const digitFinal = [
    true,
    true,
    false,
    true,
    false,
    false,
    true,
    true,
    true,
    false,
  ];
  const final = /\d/.test(end)
    ? digitFinal[Number(end)]
    : code >= 0xac00 && code <= 0xd7a3
      ? (code - 0xac00) % 28 !== 0
      : null;
  const pair =
    kind === "subject"
      ? ["이", "가"]
      : kind === "object"
        ? ["을", "를"]
        : ["과", "와"];
  return final === null ? `${text} 값${pair[0]}` : text + pair[final ? 0 : 1];
}
export const operators: Record<string, [string, string]> = {
  ">=": ["이상", "at least"],
  ">": ["초과", "greater than"],
  "<=": ["이하", "at most"],
  "<": ["미만", "less than"],
  "===": ["같음 (값과 종류)", "equal (value and type)"],
  "!==": ["다름 (값 또는 종류)", "not equal (value or type)"],
  "==": ["같음 (종류 변환 가능)", "loosely equal"],
  "!=": ["다름 (종류 변환 가능)", "loosely unequal"],
};
