package ginutil

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"pos/internal/lib"

	"github.com/gin-gonic/gin"
)

const (
	UserKey    = "domain_user"
	RequestKey = "request_id"
)

// Respond writes a JSON response with status code.
func Respond(c *gin.Context, status int, v any) {
	if status == http.StatusNoContent {
		c.Status(status)
		return
	}
	c.JSON(status, v)
}

// Result writes a success response or maps an error via Fail.
func Result(c *gin.Context, logger *slog.Logger, status int, v any, e error) {
	if e != nil {
		Fail(c, logger, e)
		return
	}
	Respond(c, status, v)
}

// Fail maps application errors or unexpected errors to consistent JSON error responses.
func Fail(c *gin.Context, logger *slog.Logger, e error) {
	var de *lib.Error
	if !errors.As(e, &de) {
		de = &lib.Error{Status: 500, Code: "INTERNAL_ERROR", Message: "Unexpected server error"}
		if logger != nil {
			logger.Error("request failed", "requestId", c.GetString(RequestKey), "errorType", fmt.Sprintf("%T", e))
		}
	}
	c.JSON(de.Status, gin.H{
		"error": gin.H{
			"code":      de.Code,
			"message":   de.Message,
			"requestId": c.GetString(RequestKey),
		},
	})
}
