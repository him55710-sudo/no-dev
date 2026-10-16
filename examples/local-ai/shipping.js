export function shippingFee(subtotal) {
  if (subtotal < 0) throw new Error("Negative subtotal");
  return subtotal >= 50000 ? 0 : 3000;
}
