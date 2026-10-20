// 일반 배송은 주문 금액이 5만 원 이상일 때 무료입니다.
// 빠른 배송은 주문 금액과 관계없이 별도 요금을 받습니다.
export function shippingFee(orderTotal, delivery = "standard") {
  if (!Number.isFinite(orderTotal) || orderTotal < 0) {
    throw new Error("주문 금액을 확인해 주세요.");
  }
  if (delivery === "express") return 5000;
  return orderTotal >= 50000 ? 0 : 3000;
}
