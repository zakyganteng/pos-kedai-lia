package handler

import (
	"context"
	"encoding/json"
	"net"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/service"
	"pos/pkg/ginutil"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (a *API) HealthLive(c *gin.Context) {
	respond(c, 200, gin.H{"status": "alive"})
}

func (a *API) HealthReady(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if e := a.Service.Repo.Ping(ctx); e != nil {
		a.fail(c, &lib.Error{Status: 503, Code: "NOT_READY", Message: "Database unavailable"})
		return
	}
	respond(c, 200, gin.H{"status": "ready"})
}

func (a *API) Login(c *gin.Context) {
	var v dto.LoginRequest
	if e := ginutil.Decode(c, &v); e != nil {
		a.fail(c, e)
		return
	}
	host, _, _ := net.SplitHostPort(c.Request.RemoteAddr)
	if host == "" {
		host = c.Request.RemoteAddr
	}
	normEmail := strings.ToLower(strings.TrimSpace(v.Email))
	if !a.limiter.Allow(host, normEmail) {
		a.fail(c, &lib.Error{Status: 429, Code: "RATE_LIMITED", Message: "Too many login attempts; try again later"})
		return
	}
	select {
	case a.loginSlots <- struct{}{}:
		defer func() { <-a.loginSlots }()
	default:
		a.fail(c, &lib.Error{Status: 429, Code: "RATE_LIMITED", Message: "Login capacity reached; retry later"})
		return
	}
	out, e := a.Service.Login(c.Request.Context(), v.Email, v.Password)
	if e == nil {
		a.limiter.Reset(host, normEmail)
	}
	a.result(c, 200, out, e)
}

func (a *API) Logout(c *gin.Context) {
	e := a.Service.Logout(c.Request.Context(), token(c))
	a.result(c, 204, nil, e)
}

func (a *API) Me(c *gin.Context) {
	respond(c, 200, user(c))
}

func (a *API) BusinessLines(c *gin.Context) {
	respond(c, 200, gin.H{"data": user(c).BusinessLines})
}

func (a *API) ListUsers(c *gin.Context) {
	p, l, e := ginutil.Pagination(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.Users(c.Request.Context(), user(c), p, l, c.Query("search"))
	a.result(c, 200, out, e)
}

func (a *API) GetUser(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e == nil {
		e = service.Owner(user(c))
	}
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.UserGet(c.Request.Context(), user(c), id)
	a.result(c, 200, out, e)
}

func (a *API) SaveUser(c *gin.Context) {
	var id string
	var e error
	if c.Request.Method != "POST" {
		id, e = ginutil.PathID(c)
		if e != nil {
			a.fail(c, e)
			return
		}
	}
	m := map[string]json.RawMessage{}
	if c.Request.Method != "DELETE" {
		m, e = ginutil.BodyMap(c)
		if e != nil {
			a.fail(c, e)
			return
		}
	}
	out, e := a.Service.UserSave(c.Request.Context(), user(c), id, m, c.Request.Method == "DELETE")
	status := 200
	if c.Request.Method == "POST" {
		status = 201
	}
	if c.Request.Method == "DELETE" {
		status = 204
	}
	a.result(c, status, out, e)
}
