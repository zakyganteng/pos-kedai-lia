package middleware

import (
	"log/slog"
	"pos/internal/lib"
	"pos/internal/service"
	"pos/pkg/ginutil"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware(s *service.Service, logger *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := ginutil.Token(c)
		if token == "" {
			ginutil.Fail(c, logger, lib.Unauthorized)
			c.Abort()
			return
		}
		u, e := s.Authenticate(c.Request.Context(), token)
		if e != nil {
			ginutil.Fail(c, logger, e)
			c.Abort()
			return
		}
		c.Set(ginutil.UserKey, u)
		c.Next()
	}
}
