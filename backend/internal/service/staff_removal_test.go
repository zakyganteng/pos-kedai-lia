package service

import (
	"context"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"pos/internal/repo"
	"testing"
)

func TestPostgresLegacyStaffSnapshotsRemainUsable(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	hair := f.service(t)
	now := f.svc.Now()
	member := model.Person{ID: lib.ID(), BusinessLineID: salon, Name: "Legacy fixture", Active: true, CreatedAt: now, UpdatedAt: now}
	change := int64(0)
	sale := model.Sale{
		ID: lib.ID(), BusinessLineID: salon, CashierID: f.owner.ID, Status: "paid",
		Subtotal: hair.Price, Total: hair.Price, CashReceived: &hair.Price, ChangeDue: &change, CreatedAt: now,
		Items: []model.Item{{ID: lib.ID(), ItemType: "service", ItemID: hair.ID, DisplayName: hair.Name, UnitPrice: hair.Price, Quantity: 1, LineTotal: hair.Price, StaffID: &member.ID}},
	}
	sale.Payment = model.Payment{ID: lib.ID(), SaleID: sale.ID, Method: "cash", Status: "confirmed", Amount: sale.Total, Currency: "IDR", CreatedAt: now, ConfirmedAt: &now}
	if err := f.repo.WithinTx(ctx, func(r *repo.Repo) error {
		if err := r.Put(ctx, "staff", member.ID, salon, member, true); err != nil {
			return err
		}
		return f.svc.saveSale(ctx, r, sale, true)
	}); err != nil {
		t.Fatal("seed legacy immutable sale", err)
	}
	entry, err := f.svc.CreateQueue(ctx, f.owner, salon, lib.ID(), dto.QueueInput{ServiceIDs: []string{hair.ID}})
	if err != nil {
		t.Fatal(err)
	}
	entry.StaffID = &member.ID
	if err := f.repo.Put(ctx, "queue", entry.ID, salon, entry, false); err != nil {
		t.Fatal("seed legacy queue", err)
	}
	if err := f.repo.Migrate(ctx); err != nil {
		t.Fatal("migrate existing data", err)
	}
	read, err := f.svc.Sale(ctx, f.owner, sale.ID)
	if err != nil || read.Items[0].StaffID == nil || *read.Items[0].StaffID != member.ID {
		t.Fatal("legacy receipt changed", read, err)
	}
	for _, status := range []string{"in_service", "completed"} {
		entry, err = f.svc.PatchQueue(ctx, f.owner, entry.ID, rawMap(map[string]any{"status": status}))
		if err != nil || entry.StaffID == nil || *entry.StaffID != member.ID {
			t.Fatal("legacy queue attribution lost", entry, err)
		}
	}
	date := now.In(f.svc.Zone).Format("2006-01-02")
	report, err := f.svc.SalesReport(ctx, f.owner, salon, date, date, "item")
	if err != nil || report.TotalSales != hair.Price || report.TransactionCount != 1 {
		t.Fatal("legacy sale missing from report", report, err)
	}
	voided, err := f.svc.VoidSale(ctx, f.owner, sale.ID, "Legacy fixture cancellation")
	if err != nil || voided.Status != "voided" || voided.Items[0].StaffID == nil || *voided.Items[0].StaffID != member.ID {
		t.Fatal("legacy snapshot cannot be voided", voided, err)
	}
}
