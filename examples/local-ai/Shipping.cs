using System;

public static class Shipping {
    public static int Fee(int subtotal) {
        if (subtotal < 0) throw new ArgumentOutOfRangeException(nameof(subtotal));
        return subtotal >= 50000 ? 0 : 3000;
    }
}
