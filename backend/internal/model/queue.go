package model

import "time"

type Queue struct {
	ID             string     `json:"id"`
	BusinessLineID string     `json:"businessLineId"`
	QueueNumber    int        `json:"queueNumber"`
	Date           string     `json:"date"`
	CustomerID     *string    `json:"customerId"`
	ServiceIDs     []string   `json:"serviceIds"`
	StaffID        *string    `json:"staffId"`
	SaleID         *string    `json:"saleId"`
	Note           *string    `json:"note"`
	Status         string     `json:"status"`
	CreatedAt      time.Time  `json:"createdAt"`
	StartedAt      *time.Time `json:"startedAt"`
	CompletedAt    *time.Time `json:"completedAt"`
}
