"""Small Python example for local explanation and edit proposals; no external calls."""

FREE_SHIPPING_THRESHOLD = 50_000
SHIPPING_FEE = 3_000


def calculate_shipping(subtotal: int) -> int:
    if subtotal < 0:
        raise ValueError("Subtotal must not be negative")
    if subtotal >= FREE_SHIPPING_THRESHOLD:
        return 0
    return SHIPPING_FEE
