package model

import "time"

type Item struct {
	ID          string `json:"id"`
	ItemType    string `json:"itemType"`
	ItemID      string `json:"itemId"`
	DisplayName string `json:"displayName"`
	UnitPrice   int64  `json:"unitPrice"`
	Quantity    int    `json:"quantity"`
	LineTotal   int64  `json:"lineTotal"`
	// Retained for immutable historical snapshots; new sales do not assign staff.
	StaffID      *string `json:"staffId"`
	StockTracked bool    `json:"stockTracked"`
}

type Payment struct {
	ID               string     `json:"id"`
	SaleID           string     `json:"saleId"`
	Method           string     `json:"method"`
	Status           string     `json:"status"`
	Amount           int64      `json:"amount"`
	Currency         string     `json:"currency"`
	GatewayReference *string    `json:"gatewayReference"`
	QRContent        *string    `json:"qrContent"`
	ExpiresAt        *time.Time `json:"expiresAt"`
	ConfirmedAt      *time.Time `json:"confirmedAt"`
	CreatedAt        time.Time  `json:"createdAt"`
	IntentAttempts   int        `json:"intentAttempts"`
	NextIntentAt     *time.Time `json:"nextIntentAt"`
	IntentError      *string    `json:"intentError"`
	Provider         string     `json:"provider,omitempty"`
	GatewayMode      string     `json:"gatewayMode,omitempty"`
	CustomerPays     *int64     `json:"customerPays,omitempty"`
	NextStatusAt     *time.Time `json:"nextStatusAt,omitempty"`
	StatusError      *string    `json:"statusError,omitempty"`
}

type Sale struct {
	ID             string    `json:"id"`
	BusinessLineID string    `json:"businessLineId"`
	CustomerID     *string   `json:"customerId"`
	CashierID      string    `json:"cashierId"`
	Status         string    `json:"status"`
	Items          []Item    `json:"items"`
	Subtotal       int64     `json:"subtotal"`
	Total          int64     `json:"total"`
	CashReceived   *int64    `json:"cashReceived"`
	ChangeDue      *int64    `json:"changeDue"`
	Payment        Payment   `json:"payment"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Reconciliation struct {
	ID                string    `json:"id"`
	EventID           string    `json:"eventId"`
	SaleID            string    `json:"saleId"`
	Outcome           string    `json:"outcome"`
	ProviderStatus    string    `json:"providerStatus"`
	ProviderPaymentID string    `json:"providerPaymentId"`
	Amount            int64     `json:"amount"`
	Currency          string    `json:"currency"`
	OccurredAt        time.Time `json:"occurredAt"`
	CreatedAt         time.Time `json:"createdAt"`
}

type Intent struct {
	PaymentID         string    `json:"paymentId"`
	MerchantReference string    `json:"merchantReference"`
	Amount            int64     `json:"amount"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"`
	QRContent         string    `json:"qrContent"`
	ExpiresAt         time.Time `json:"expiresAt"`
	Mode              string    `json:"mode,omitempty"`
	CustomerPays      *int64    `json:"customerPays,omitempty"`
}

type ProviderPayment struct {
	Reference    string
	Mode         string
	Status       string
	OrderAmount  int64
	CustomerPays int64
	PaidAt       *time.Time
}

type ProviderEvent struct {
	Reference string
	Mode      string
	Status    string
	Amount    int64
}
