package lib

import "encoding/json"

const MaxAmount int64 = 1_000_000_000_000
const MaxStock int64 = 1_000_000_000

func Money(price int64, quantity int) (int64, error) {
	if price < 0 || price > MaxAmount || quantity < 1 || quantity > 1000 || price > MaxAmount/int64(quantity) {
		return 0, Invalid("Amount or quantity exceeds allowed bounds")
	}
	return price * int64(quantity), nil
}

func PaymentTransition(from, to string) bool {
	return from == "pending" && (to == "confirmed" || to == "failed" || to == "expired")
}

func QueueTransition(from, to string) bool {
	return (from == "waiting" && (to == "in_service" || to == "cancelled")) || (from == "in_service" && (to == "completed" || to == "cancelled"))
}

func Decode[T any](b []byte) (T, error) {
	var v T
	err := json.Unmarshal(b, &v)
	return v, err
}
