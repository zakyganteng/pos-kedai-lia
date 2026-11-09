package paging

import (
	"encoding/json"
	"pos/internal/dto"
)

// Paginate slices a list of JSON raw messages and returns a dto.Page with pagination metadata.
func Paginate(data []json.RawMessage, page, limit int) dto.Page {
	total := len(data)
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	totalPages := 0
	if limit > 0 {
		totalPages = (total + limit - 1) / limit
	}
	return dto.Page{
		Data: data[start:end],
		Pagination: dto.Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages,
		},
	}
}
