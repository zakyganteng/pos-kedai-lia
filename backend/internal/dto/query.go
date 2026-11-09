package dto

import (
	"encoding/json"
	"time"
)

type Filter struct {
	Kind, LineID, Search, Status, Date, ProductID, Outcome string
	CategoryID                                             string
	Active, Uncategorized                                  *bool
	From, To                                               *time.Time
	Page, Limit                                            int
	IncludeUnmatched                                       bool
}

type Pagination struct {
	Page       int `json:"page"`
	Limit      int `json:"limit"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

type Page struct {
	Data       []json.RawMessage `json:"data"`
	Pagination Pagination        `json:"pagination"`
}
