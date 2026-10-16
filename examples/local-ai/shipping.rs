pub fn shipping_fee(subtotal: i64) -> Result<i64, &'static str> {
    if subtotal < 0 { return Err("negative subtotal"); }
    if subtotal >= 50000 { return Ok(0); }
    Ok(3000)
}
