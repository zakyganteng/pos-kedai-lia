package dto

type QueueInput struct {
	CustomerID *string  `json:"customerId"`
	ServiceIDs []string `json:"serviceIds"`
	Note       *string  `json:"note"`
}
