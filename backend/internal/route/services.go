package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerServiceRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/services", a.ListServices)
	rg.POST("/services", a.CreateService)
	rg.GET("/services/:id", a.GetService)
	rg.PATCH("/services/:id", a.UpdateService)
	rg.DELETE("/services/:id", a.DeleteService)
}
