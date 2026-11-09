package model

import "time"

type Person struct {
	ID             string    `json:"id"`
	BusinessLineID string    `json:"businessLineId"`
	Name           string    `json:"name"`
	Phone          *string   `json:"phone,omitempty"`
	Active         bool      `json:"active"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
