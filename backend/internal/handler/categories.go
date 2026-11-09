package handler

import (
	"encoding/json"
	"pos/pkg/ginutil"

	"github.com/gin-gonic/gin"
)

func (a *API) ListCategories(c *gin.Context) {
	f, e := a.filter(c, "categories")
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.ListCategories(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) CreateCategory(c *gin.Context) {
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
	out, e := a.Service.SaveCategory(c.Request.Context(), user(c), line, "", m, false)
	a.result(c, 201, out, e)
}

func (a *API) GetCategory(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.GetCategory(c.Request.Context(), user(c), id)
	a.result(c, 200, out, e)
}

func (a *API) UpdateCategory(c *gin.Context) {
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
	out, e := a.Service.SaveCategory(c.Request.Context(), user(c), "", id, m, false)
	a.result(c, 200, out, e)
}

func (a *API) DeleteCategory(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	_, e = a.Service.SaveCategory(c.Request.Context(), user(c), "", id, map[string]json.RawMessage{}, true)
	a.result(c, 204, nil, e)
}
