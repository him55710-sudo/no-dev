// In VS Code, change shippingFee to 4000 in Pureobom's Rules view.
// TypeScript reports that only 3000 or 5000 is allowed here.
// Review the editor report, jump to its source, then undo with Ctrl+Z.
export const shippingFee: 3000 | 5000 = 3000;

export function shippingCost() {
  return shippingFee;
}
