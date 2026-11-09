package handler

import (
	"encoding/json"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/pkg/ginutil"

	"github.com/gin-gonic/gin"
)

func (a *API) Inventory(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	page, limit, e := ginutil.Pagination(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	low, e := ginutil.BoolQuery(c, "lowStock")
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.Inventory(c.Request.Context(), user(c), line, low != nil && *low)
	if e != nil {
		a.fail(c, e)
		return
	}
	data := []json.RawMessage{}
	for _, v := range out {
		b, _ := json.Marshal(v)
		data = append(data, b)
	}
	total := len(data)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}
	respond(c, 200, dto.Page{
		Data: data[start:end],
		Pagination: dto.Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: (total + limit - 1) / limit,
		},
	})
}

func (a *API) ListMovements(c *gin.Context) {
	f, e := a.filter(c, "movements")
	if e == nil {
		f.ProductID = c.Query("productId")
		if f.ProductID != "" && !lib.UUID(f.ProductID) {
			e = lib.Invalid("Invalid productId")
		}
	}
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) CreateMovement(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	var v dto.MovementInput
	if e = ginutil.Decode(c, &v); e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.Adjust(c.Request.Context(), user(c), line, v)
	a.result(c, 201, out, e)
}
