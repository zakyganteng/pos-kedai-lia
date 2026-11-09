package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerWebhookRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.POST("/webhooks/payments/:provider", a.Webhook)
}

func registerSaleAndPaymentRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/sales", a.ListSales)
	rg.POST("/sales", a.CreateSale)
	rg.GET("/sales/:id", a.GetSale)
	rg.POST("/sales/:id/void", a.VoidSale)

	rg.GET("/payments/:id", a.GetPayment)
	rg.GET("/payments/reconciliation", a.ListReconciliation)
}
