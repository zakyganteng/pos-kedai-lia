package model

import "time"

type Product struct {
	ID               string    `json:"id"`
	BusinessLineID   string    `json:"businessLineId"`
	SKU              string    `json:"sku"`
	Name             string    `json:"name"`
	Unit             string    `json:"unit"`
	Price            int64     `json:"price"`
	StockTracked     bool      `json:"stockTracked"`
	Active           bool      `json:"active"`
	CategoryID       *string   `json:"categoryId"`
	StockOnHand      int64     `json:"stockOnHand"`
	ReservedQuantity int64     `json:"reservedQuantity"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}
