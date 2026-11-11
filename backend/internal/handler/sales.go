package handler

import (
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/pkg/ginutil"

	"github.com/gin-gonic/gin"
)

func (a *API) ListSales(c *gin.Context) {
	f, e := a.filter(c, "sales")
	if e != nil {
		a.fail(c, e)
		return
	}
	if f.Status != "" && !oneOf(f.Status, "pending_payment", "paid", "cancelled", "voided") {
		a.fail(c, lib.Invalid("Invalid sale status"))
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) CreateSale(c *gin.Context) {
	line, e := ginutil.LineID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	var v dto.SaleInput
	if e = ginutil.Decode(c, &v); e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.CreateSale(c.Request.Context(), user(c), line, c.GetHeader("X-Idempotency-Key"), v)
	a.result(c, 201, out, e)
}

func (a *API) GetSale(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.Sale(c.Request.Context(), user(c), id)
	a.result(c, 200, out, e)
}

func (a *API) VoidSale(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	var v dto.VoidSaleRequest
	if e = ginutil.Decode(c, &v); e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.VoidSale(c.Request.Context(), user(c), id, v.Reason)
	a.result(c, 200, out, e)
}

func (a *API) GetPayment(c *gin.Context) {
	id, e := ginutil.PathID(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.PaymentState(c.Request.Context(), user(c), id)
	a.result(c, 200, out, e)
}

func (a *API) ListReconciliation(c *gin.Context) {
	f, e := a.filter(c, "reconciliation")
	if e != nil {
		a.fail(c, e)
		return
	}
	out, e := a.Service.List(c.Request.Context(), user(c), f)
	a.result(c, 200, out, e)
}

func (a *API) Webhook(c *gin.Context) {
	b, e := ginutil.Body(c)
	if e != nil {
		a.fail(c, e)
		return
	}
	if c.Param("provider") == "borderpay" {
		out, err := a.Service.BorderpayWebhook(c.Request.Context(), c.GetHeader("x-borderpay-token"), c.GetHeader("x-borderpay-event"), c.GetHeader("x-borderpay-mode"), b)
		a.result(c, 200, map[string]string{"outcome": out}, err)
		return
	}
	out, e := a.Service.Webhook(c.Request.Context(), c.Param("provider"), c.GetHeader("X-Idempotency-Key"), c.GetHeader("X-Webhook-Signature"), b)
	a.result(c, 200, map[string]string{"outcome": out}, e)
}
