package handler

import (
	"log/slog"
	"net/http"
	"pos/internal/model"
	"pos/internal/service"
	"pos/pkg/ginutil"
	"pos/pkg/ratelimit"

	"github.com/gin-gonic/gin"
)

type API struct {
	Service    *service.Service
	Logger     *slog.Logger
	limiter    ratelimit.Limiter
	loginSlots chan struct{}
}

type limiter = ratelimit.Limiter

func NewAPI(s *service.Service, logger *slog.Logger) *API {
	return &API{
		Service:    s,
		Logger:     logger,
		loginSlots: make(chan struct{}, 8),
	}
}

func user(c *gin.Context) model.User { return ginutil.User(c) }
func token(c *gin.Context) string    { return ginutil.Token(c) }

func respond(c *gin.Context, status int, v any) {
	ginutil.Respond(c, status, v)
}

func (a *API) Result(c *gin.Context, status int, v any, e error) {
	ginutil.Result(c, a.Logger, status, v, e)
}

func (a *API) Fail(c *gin.Context, e error) {
	ginutil.Fail(c, a.Logger, e)
}

func (a *API) result(c *gin.Context, status int, v any, e error) {
	a.Result(c, status, v, e)
}

func (a *API) fail(c *gin.Context, e error) {
	a.Fail(c, e)
}

func decode(c *gin.Context, v any) error { return ginutil.Decode(c, v) }
func uniqueJSON(b []byte) error          { return ginutil.UniqueJSON(b) }
func pagination(r *http.Request) (int, int, error) {
	c := &gin.Context{Request: r}
	return ginutil.Pagination(c)
}

func oneOf(v string, allowed ...string) bool {
	for _, a := range allowed {
		if v == a {
			return true
		}
	}
	return false
}
