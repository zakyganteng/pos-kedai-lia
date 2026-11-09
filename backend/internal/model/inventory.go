package model

import "time"

type Stock struct {
	ProductID         string `json:"productId" db:"product_id"`
	ProductName       string `json:"productName" db:"product_name"`
	Quantity          int64  `json:"quantity" db:"quantity"`
	ReservedQuantity  int64  `json:"reservedQuantity" db:"reserved"`
	AvailableQuantity int64  `json:"availableQuantity" db:"-"`
	LowStockThreshold int64  `json:"lowStockThreshold" db:"threshold"`
}

type Movement struct {
	ID            string    `json:"id"`
	ProductID     string    `json:"productId"`
	Type          string    `json:"type"`
	QuantityDelta int64     `json:"quantityDelta"`
	Reason        string    `json:"reason"`
	ActorID       string    `json:"actorId"`
	SaleID        *string   `json:"saleId"`
	CreatedAt     time.Time `json:"createdAt"`
}
