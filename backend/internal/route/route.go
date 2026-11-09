package route

import (
	"log/slog"
	"net/http"
	"pos/internal/handler"
	"pos/internal/lib"
	"pos/internal/middleware"
	"pos/internal/service"

	"github.com/gin-gonic/gin"
)

func New(s *service.Service, logger *slog.Logger) http.Handler {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()

	a := handler.NewAPI(s, logger)

	router.Use(middleware.RequestMiddleware(logger))

	router.NoRoute(func(c *gin.Context) {
		a.Fail(c, lib.NotFound)
	})

	api := router.Group("/api/v1")

	// Public routes
	api.GET("/health/live", a.HealthLive)
	api.GET("/health/ready", a.HealthReady)
	registerPublicAuthRoutes(api, a)
	registerWebhookRoutes(api, a)

	// Secured routes
	secured := api.Group("", middleware.AuthMiddleware(s, logger))
	{
		registerAuthAndUserRoutes(secured, a)
		registerProductRoutes(secured, a)
		registerCategoryRoutes(secured, a)
		registerServiceRoutes(secured, a)
		registerPeopleRoutes(secured, a)
		registerInventoryRoutes(secured, a)
		registerSaleAndPaymentRoutes(secured, a)
		registerOperationRoutes(secured, a)
	}

	return router
}
