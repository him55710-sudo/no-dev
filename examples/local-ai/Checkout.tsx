export function Checkout({ quantity }: { quantity: number }) {
  return <button disabled={quantity === 0}>주문하기</button>;
}
