package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerCategoryRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/categories", a.ListCategories)
	rg.POST("/categories", a.CreateCategory)
	rg.GET("/categories/:id", a.GetCategory)
	rg.PATCH("/categories/:id", a.UpdateCategory)
	rg.DELETE("/categories/:id", a.DeleteCategory)
}
