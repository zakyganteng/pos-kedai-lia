package model

import "time"

type Service struct {
	ID              string    `json:"id"`
	BusinessLineID  string    `json:"businessLineId"`
	Name            string    `json:"name"`
	Description     *string   `json:"description"`
	DurationMinutes *int      `json:"durationMinutes"`
	Price           int64     `json:"price"`
	Active          bool      `json:"active"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}
