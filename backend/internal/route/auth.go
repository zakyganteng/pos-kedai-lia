package route

import (
	"pos/internal/handler"

	"github.com/gin-gonic/gin"
)

func registerPublicAuthRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.POST("/auth/login", a.Login)
}

func registerAuthAndUserRoutes(rg *gin.RouterGroup, a *handler.API) {
	rg.POST("/auth/logout", a.Logout)
	rg.GET("/auth/me", a.Me)
	rg.GET("/business-lines", a.BusinessLines)

	rg.GET("/users", a.ListUsers)
	rg.GET("/users/:id", a.GetUser)
	rg.POST("/users", a.SaveUser)
	rg.PATCH("/users/:id", a.SaveUser)
	rg.DELETE("/users/:id", a.SaveUser)
}
