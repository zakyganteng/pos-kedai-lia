package model

import (
	"context"
	"time"
)

type Notification struct {
	ID                string    `json:"id"`
	SaleID            string    `json:"saleId"`
	Status            string    `json:"status"`
	DestinationMasked *string   `json:"destinationMasked"`
	AttemptCount      int       `json:"attemptCount"`
	LastError         *string   `json:"lastError"`
	CreatedAt         time.Time `json:"createdAt"`
}

type Delivery struct {
	ID, LineID, Destination, Message, ClaimToken string
	Attempts, Failures                           int
	Notification                                 Notification
}

type PaymentProvider interface {
	Name() string
	Create(context.Context, Sale) (Intent, error)
	Verify([]byte, string) error
}

type NotificationProvider interface {
	Name() string
	Send(context.Context, string, string, string) error
}
