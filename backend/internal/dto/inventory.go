package dto

type MovementInput struct {
	ProductID         string `json:"productId"`
	Type              string `json:"type"`
	QuantityDelta     int64  `json:"quantityDelta"`
	Reason            string `json:"reason"`
	LowStockThreshold *int64 `json:"lowStockThreshold"`
}
