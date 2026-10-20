import assert from "node:assert/strict";
import { test } from "node:test";
import { shippingFee } from "../src/shipping.js";

test("일반 배송의 경계 금액", () => {
  assert.equal(shippingFee(49999), 3000);
  assert.equal(shippingFee(50000), 0);
  assert.equal(shippingFee(100), 3000);
});
test("빠른 배송은 별도 요금", () => {
  assert.equal(shippingFee(60000, "express"), 5000);
});
test("잘못된 주문 금액", () => {
  for (const value of [-1, NaN, Infinity, "100", null]) {
    assert.throws(() => shippingFee(value), /주문 금액/);
  }
});
