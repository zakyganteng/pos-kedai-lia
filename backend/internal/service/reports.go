package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"pos/pkg/csvutil"
	"pos/pkg/daterange"
	"strconv"
)

func (s *Service) SalesReport(ctx context.Context, u model.User, line, from, to, group string) (dto.Report, error) {
	if err := Authorize(u, line, ""); err != nil {
		return dto.Report{}, err
	}
	if group == "" {
		group = "day"
	}
	if group != "day" && group != "paymentMethod" && group != "item" && group != "staff" {
		return dto.Report{}, lib.Invalid("Invalid report grouping")
	}
	if u.Role == "cashier" && (group != "day" && group != "paymentMethod") {
		return dto.Report{}, lib.Forbidden()
	}
	start, end, e := daterange.Parse(from, to, s.Zone)
	if e != nil {
		return dto.Report{}, e
	}
	var out dto.Report
	e = s.Repo.WithinTx(ctx, func(r *repo.Repo) error {
		if e := r.Lock(ctx, "report:"+line); e != nil {
			return e
		}
		amount, count, groups, e := r.Report(ctx, line, start, end, group, s.Zone.String())
		if e != nil {
			return e
		}
		out = dto.Report{BusinessLineID: line, From: from, To: to, TotalSales: amount, TransactionCount: count, Groups: groups, Timezone: s.Zone.String()}
		return nil
	})
	return out, e
}

func (s *Service) SalesCSV(ctx context.Context, u model.User, line, from, to string) ([]byte, error) {
	if e := Admin(u); e != nil {
		return nil, e
	}
	if e := Authorize(u, line, ""); e != nil {
		return nil, e
	}
	start, end, e := daterange.Parse(from, to, s.Zone)
	if e != nil {
		return nil, e
	}
	sales, e := s.Repo.ConfirmedSales(ctx, line, start, end, 10001)
	if e != nil {
		return nil, e
	}
	if len(sales) > 10000 {
		return nil, &lib.Error{Status: 413, Code: "EXPORT_TOO_LARGE", Message: "CSV export exceeds 10000 sales; choose a smaller date range. No partial export was generated."}
	}
	var b bytes.Buffer
	w := csv.NewWriter(&b)
	if e = w.Write([]string{"saleId", "businessLineId", "createdAt", "paymentMethod", "total"}); e != nil {
		return nil, e
	}
	for _, sale := range sales {
		if e = w.Write([]string{csvutil.SafeCell(sale.ID), csvutil.SafeCell(sale.BusinessLineID), sale.CreatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"), csvutil.SafeCell(sale.Payment.Method), strconv.FormatInt(sale.Total, 10)}); e != nil {
			return nil, e
		}
	}
	w.Flush()
	return b.Bytes(), w.Error()
}
