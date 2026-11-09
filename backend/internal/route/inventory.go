package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerInventoryRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/inventory", a.Inventory)
	rg.GET("/inventory/movements", a.ListMovements)
	rg.POST("/inventory/movements", a.CreateMovement)
}
