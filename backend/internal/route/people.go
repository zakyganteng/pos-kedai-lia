package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerPeopleRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.GET("/customers", a.ListCustomers)
	rg.POST("/customers", a.CreateCustomer)
	rg.GET("/customers/:id", a.GetCustomer)
	rg.PATCH("/customers/:id", a.UpdateCustomer)
	rg.DELETE("/customers/:id", a.DeleteCustomer)
}
