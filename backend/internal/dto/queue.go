package dto

type QueueInput struct {
	CustomerID *string  `json:"customerId"`
	ServiceIDs []string `json:"serviceIds"`
	StaffID    *string  `json:"staffId"`
	Note       *string  `json:"note"`
}
