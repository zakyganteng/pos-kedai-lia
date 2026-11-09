package middleware

import (
	"log/slog"
	"pos/internal/lib"
	"pos/pkg/ginutil"
	"time"

	"github.com/gin-gonic/gin"
)

func RequestMiddleware(logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if !lib.UUID(id) {
			id = lib.ID()
		}
		c.Set(ginutil.RequestKey, id)

		w := c.Writer
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("Cache-Control", "no-store")
		if c.Request.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}

		start := time.Now()
		defer func() {
			if v := recover(); v != nil {
				ginutil.Fail(c, logger, &lib.Error{Status: 500, Code: "INTERNAL_ERROR", Message: "Unexpected server error"})
				c.Abort()
			}
			if logger != nil {
				logger.Info("http request",
					"requestId", id,
					"method", c.Request.Method,
					"route", c.FullPath(),
					"status", c.Writer.Status(),
					"durationMs", time.Since(start).Milliseconds(),
				)
			}
		}()
		c.Next()
	}
}
