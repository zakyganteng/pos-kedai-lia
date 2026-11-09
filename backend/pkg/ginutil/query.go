package ginutil

import (
	"pos/internal/lib"
	"pos/internal/model"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// PathID extracts and validates UUID "id" path parameter from Gin context.
func PathID(c *gin.Context) (string, error) {
	id := c.Param("id")
	if !lib.UUID(id) {
		return "", lib.Invalid("Invalid UUID identifier")
	}
	return id, nil
}

// LineID extracts and validates "businessLineId" query parameter from Gin context.
func LineID(c *gin.Context) (string, error) {
	id := c.Query("businessLineId")
	if !lib.UUID(id) {
		return "", lib.Invalid("A valid businessLineId is required")
	}
	return id, nil
}

// Pagination parses page (1..1000000) and limit (1..100) from query parameters.
func Pagination(c *gin.Context) (int, int, error) {
	p, l := 1, 20
	var e error
	if v := c.Query("page"); v != "" {
		p, e = strconv.Atoi(v)
		if e != nil || p < 1 || p > 1000000 {
			return 0, 0, lib.Invalid("page must be 1 to 1000000")
		}
	}
	if v := c.Query("limit"); v != "" {
		l, e = strconv.Atoi(v)
		if e != nil || l < 1 || l > 100 {
			return 0, 0, lib.Invalid("limit must be 1 to 100")
		}
	}
	if len(c.Query("search")) > 100 {
		return 0, 0, lib.Invalid("search is too long")
	}
	return p, l, nil
}

// BoolQuery parses an optional boolean query param. Returns nil if absent.
func BoolQuery(c *gin.Context, k string) (*bool, error) {
	v := c.Query(k)
	if v == "" {
		return nil, nil
	}
	if v != "true" && v != "false" {
		return nil, lib.Invalid(k + " must be true or false")
	}
	b := v == "true"
	return &b, nil
}

// Token extracts Bearer token from Authorization header.
func Token(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(h, "Bearer ")
}

// User returns the model.User stored in Gin context.
func User(c *gin.Context) model.User {
	v, exists := c.Get(UserKey)
	if !exists {
		return model.User{}
	}
	u, _ := v.(model.User)
	return u
}
