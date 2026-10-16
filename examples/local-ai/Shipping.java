public class Shipping {
    public static int fee(int subtotal) {
        if (subtotal < 0) throw new IllegalArgumentException("Negative subtotal");
        return subtotal >= 50000 ? 0 : 3000;
    }
}
