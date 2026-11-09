package handler

import (
	"encoding/json"
	"pos/pkg/ginutil"

	"github.com/gin-gonic/gin"
)

func (a *API) ListProducts(c *gin.Context) {
	f, e := a.filter(c, "products")
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) CreateProduct(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	m, e := ginutil.BodyMap(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.SaveProduct(c.Request.Context(), user(c), line, "", m, false)
	a.result(c, 201, out, e)
}

func (a *API) GetProduct(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.GetProduct(c.Request.Context(), user(c), id)
	a.result(c, 200, out, e)
}

func (a *API) UpdateProduct(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	m, e := ginutil.BodyMap(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.SaveProduct(c.Request.Context(), user(c), "", id, m, false)
	a.result(c, 200, out, e)
}

func (a *API) DeleteProduct(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	_, e = a.Service.SaveProduct(c.Request.Context(), user(c), "", id, map[string]json.RawMessage{}, true)
	a.result(c, 204, nil, e)
}
