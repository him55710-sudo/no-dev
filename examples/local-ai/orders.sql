SELECT id, subtotal,
       CASE WHEN subtotal >= 50000 THEN 0 ELSE 3000 END AS shipping_fee
FROM orders
WHERE status = 'paid';
