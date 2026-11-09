package dto

type ReportGroup struct {
	Key    string `json:"key" db:"key"`
	Amount int64  `json:"amount" db:"amount"`
	Count  int    `json:"count" db:"count"`
}

type Report struct {
	BusinessLineID   string        `json:"businessLineId"`
	From             string        `json:"from"`
	To               string        `json:"to"`
	TotalSales       int64         `json:"totalSales"`
	TransactionCount int           `json:"transactionCount"`
	Groups           []ReportGroup `json:"groups"`
	Timezone         string        `json:"timezone"`
}
