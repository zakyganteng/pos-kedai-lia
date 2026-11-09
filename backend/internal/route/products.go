package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerProductRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/products", a.ListProducts)
	rg.POST("/products", a.CreateProduct)
	rg.GET("/products/:id", a.GetProduct)
	rg.PATCH("/products/:id", a.UpdateProduct)
	rg.DELETE("/products/:id", a.DeleteProduct)
}
