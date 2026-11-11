package handler

import (
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/pkg/ginutil"
	"time"

	"github.com/gin-gonic/gin"
)

func (a *API) ListNotifications(c *gin.Context) {
	f, e := a.filter(c, "notifications")
	if e != nil {
		a.fail(c, e)
		return
	}
	if f.Status != "" && !oneOf(f.Status, "queued", "sent", "failed") {
		a.fail(c, lib.Invalid("Invalid notification status"))
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) RetryNotification(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e == nil {
		e = a.Service.RetryNotification(c.Request.Context(), user(c), id)
	}
	a.result(c, 202, gin.H{"status": "queued"}, e)
}

func (a *API) SalesReport(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.SalesReport(c.Request.Context(), user(c), line, c.Query("from"), c.Query("to"), c.Query("groupBy"))
	a.result(c, 200, out, e)
}

func (a *API) InventoryReport(c *gin.Context) {
	line, e := ginutil.LineID(c)
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
	a.result(c, 200, map[string]any{"data": out}, e)
}

func (a *API) SalesCSV(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	b, e := a.Service.SalesCSV(c.Request.Context(), user(c), line, c.Query("from"), c.Query("to"))
	if e != nil {
		a.fail(c, e)
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=sales.csv")
	c.Data(200, "text/csv; charset=utf-8", b)
}

func (a *API) ListQueue(c *gin.Context) {
	f, e := a.filter(c, "queue")
	if e != nil {
		a.fail(c, e)
		return
	}
	f.Date = c.Query("date")
	if f.Date == "" {
		f.Date = a.Service.Now().In(a.Service.Zone).Format("2006-01-02")
	}
	if _, e = time.Parse("2006-01-02", f.Date); e != nil {
		a.fail(c, lib.Invalid("Invalid queue date"))
		return
	}
	if f.Status != "" && !oneOf(f.Status, "waiting", "in_service", "completed", "cancelled") {
		a.fail(c, lib.Invalid("Invalid queue status"))
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) CreateQueue(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	var v dto.QueueInput
	if e = ginutil.Decode(c, &v); e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.CreateQueue(c.Request.Context(), user(c), line, c.GetHeader("X-Idempotency-Key"), v)
	a.result(c, 201, out, e)
}

func (a *API) PatchQueue(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	m, e := ginutil.BodyMap(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.PatchQueue(c.Request.Context(), user(c), id, m)
	a.result(c, 200, out, e)
}

func (a *API) Integrations(c *gin.Context) {
	out, e := a.Service.Integrations(user(c))
	a.result(c, 200, out, e)
}

func (a *API) filter(c *gin.Context, kind string) (dto.Filter, error) {
	line, e := ginutil.LineID(c)
	if e != nil {
		return dto.Filter{}, e
	}
	page, limit, e := ginutil.Pagination(c)
	if e != nil {
		return dto.Filter{}, e
	}
	active, e := ginutil.BoolQuery(c, "active")
	if e != nil {
		return dto.Filter{}, e
	}
	if active != nil && !oneOf(kind, "products", "services", "customers", "categories") {
		return dto.Filter{}, lib.Invalid("active is not a supported filter for this resource")
	}
	f := dto.Filter{Kind: kind, LineID: line, Page: page, Limit: limit, Search: c.Query("search"), Active: active, Status: c.Query("status")}
	if e = categoryFilters(c, kind, &f); e != nil {
		return dto.Filter{}, e
	}
	if kind == "reconciliation" {
		if f.Status != "" {
			return f, lib.Invalid("status is not a supported filter for this resource; use outcome")
		}
		f.Outcome = c.Query("outcome")
		if f.Outcome != "" && !oneOf(f.Outcome, "applied", "duplicate_state", "mismatch", "terminal_conflict", "unmatched", "stale", "unresolved") {
			return f, lib.Invalid("Invalid reconciliation outcome")
		}
	}
	from, to := c.Query("from"), c.Query("to")
	if from != "" || to != "" {
		start, end, e := a.Service.DateRange(from, to)
		if e != nil {
			return f, e
		}
		f.From = &start
		f.To = &end
	}
	return f, nil
}

// categoryFilters parses the mutually exclusive categoryId and uncategorized product filters.
// Both are rejected outright on every other resource, including /services.
func categoryFilters(c *gin.Context, kind string, f *dto.Filter) error {
	query := c.Request.URL.Query()
	categoryValues, categorySet := query["categoryId"]
	uncategorizedValues, uncategorizedSet := query["uncategorized"]
	category := c.Query("categoryId")
	if categorySet && len(categoryValues) != 1 || uncategorizedSet && len(uncategorizedValues) != 1 {
		return lib.Invalid("Category filters must be supplied only once")
	}
	if !categorySet && !uncategorizedSet {
		return nil
	}
	if kind != "products" {
		return lib.Invalid("categoryId and uncategorized are not supported filters for this resource")
	}
	if categorySet && uncategorizedSet {
		return lib.Invalid("categoryId and uncategorized are mutually exclusive")
	}
	if categorySet {
		if !lib.UUID(category) {
			return lib.Invalid("categoryId must be a UUID")
		}
		f.CategoryID = category
		return nil
	}
	uncategorized, e := ginutil.BoolQuery(c, "uncategorized")
	if e != nil {
		return e
	}
	if uncategorized == nil {
		return lib.Invalid("uncategorized must be true or false")
	}
	f.Uncategorized = uncategorized
	return nil
}
