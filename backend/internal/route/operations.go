package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerOperationRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/notifications", a.ListNotifications)
	rg.POST("/notifications/:id/retry", a.RetryNotification)

	rg.GET("/reports/sales", a.SalesReport)
	rg.GET("/reports/inventory", a.InventoryReport)
	rg.GET("/reports/sales.csv", a.SalesCSV)

	rg.GET("/salon/queue", a.ListQueue)
	rg.POST("/salon/queue", a.CreateQueue)
	rg.PATCH("/salon/queue/:id", a.PatchQueue)

	rg.GET("/integrations", a.Integrations)
}
