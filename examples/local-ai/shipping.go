package shipping

import "errors"

func Fee(subtotal int) (int, error) {
    if subtotal < 0 { return 0, errors.New("negative subtotal") }
    if subtotal >= 50000 { return 0, nil }
    return 3000, nil
}
