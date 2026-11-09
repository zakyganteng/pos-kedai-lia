package model

import "time"

// Category groups products inside one food & beverage business line. ProductCount is derived
// from the products currently assigned to the category and is never accepted from a client.
type Category struct {
	ID             string    `json:"id"`
	BusinessLineID string    `json:"businessLineId"`
	Name           string    `json:"name"`
	Active         bool      `json:"active"`
	ProductCount   int       `json:"productCount"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
