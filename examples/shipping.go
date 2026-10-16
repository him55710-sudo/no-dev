package shipping

import "errors"

const freeShippingThreshold = 50_000
const shippingFee = 3_000

func CalculateShipping(subtotal int) (int, error) {
	if subtotal < 0 {
		return 0, errors.New("negative subtotal")
	}
	if subtotal >= freeShippingThreshold {
		return 0, nil
	}
	return shippingFee, nil
}
