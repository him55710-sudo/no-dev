// Try 49999, 50000, 60000, 70000 before and after changing the threshold.
export const freeShippingThreshold = 50000;
export const shippingFee = 3000;
export function calculateShipping(subtotal: number) {
  if (subtotal < 0) throw new Error("Subtotal cannot be negative");
  if (subtotal >= freeShippingThreshold) return 0;
  return shippingFee;
}
