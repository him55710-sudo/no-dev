// Change 0.1 to 0.15. A member's discount on 10000 changes from 1000 to 1500.
export const memberDiscount = 0.1;
export function calculateDiscount(subtotal: number, isMember: boolean) {
  if (isMember) return subtotal * memberDiscount;
  return 0;
}
