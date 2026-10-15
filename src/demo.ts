import type { SourceFile } from "./core/types";
export const demo: SourceFile[] = [
  {
    path: "src/shipping.ts",
    content: `// 주문 금액에 따른 배송비 정책
export const freeShippingThreshold = 50000;
export const shippingFee = 3000;

export function calculateShipping(subtotal: number) {
  if (subtotal < 0) {
    throw new Error("상품 합계는 0 이상이어야 합니다.");
  }
  if (subtotal >= freeShippingThreshold) {
    return 0;
  }
  return shippingFee;
}
`,
  },
  {
    path: "src/pricing.ts",
    content: `export const memberDiscount = 0.1;

export function calculateDiscount(subtotal: number, isMember: boolean) {
  if (isMember) {
    return subtotal * memberDiscount;
  }
  return 0;
}
`,
  },
  {
    path: "src/order.ts",
    content: `import { calculateShipping } from './shipping';
import { calculateDiscount } from './pricing';

export function createOrder(subtotal: number, isMember: boolean) {
  const discount = calculateDiscount(subtotal, isMember);
  const shipping = calculateShipping(subtotal);
  const total = subtotal - discount + shipping;
  return { subtotal, discount, shipping, total };
}
`,
  },
  {
    path: "src/products.ts",
    content: `export const maxItems = 20;
export const welcomeMessage = "반가워요, 작은 상점입니다.";

export async function loadProducts() {
  const response = await fetch('/api/products');
  const products = await response.json();
  return products.slice(0, maxItems);
}
`,
  },
  {
    path: "package.json",
    content: JSON.stringify(
      {
        name: "little-store",
        version: "1.0.0",
        description: "설명을 읽고 규칙을 바꿔보는 예제 프로젝트",
      },
      null,
      2,
    ),
  },
];
