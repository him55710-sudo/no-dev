export function Checkout({ quantity }) {
  return <button disabled={quantity === 0}>주문하기</button>;
}
