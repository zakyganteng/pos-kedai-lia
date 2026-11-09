package dto

import "time"

type VoidSaleRequest struct {
	Reason string `json:"reason"`
}

type ItemInput struct {
	ItemType string  `json:"itemType"`
	ItemID   string  `json:"itemId"`
	Quantity int     `json:"quantity"`
	StaffID  *string `json:"staffId,omitempty"`
}

type SaleInput struct {
	Items         []ItemInput `json:"items"`
	CustomerID    *string     `json:"customerId,omitempty"`
	PaymentMethod string      `json:"paymentMethod"`
	CashReceived  *int64      `json:"cashReceived,omitempty"`
}

type Event struct {
	EventID           string    `json:"eventId"`
	Provider          string    `json:"provider,omitempty"`
	PaymentID         string    `json:"paymentId"`
	MerchantReference string    `json:"merchantReference"`
	Amount            int64     `json:"amount"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"`
	OccurredAt        time.Time `json:"occurredAt"`
}
