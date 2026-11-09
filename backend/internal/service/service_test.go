package service

import (
	"pos/internal/model"
	"testing"
	"time"
)

func TestAuthorization(t *testing.T) {
	u := model.User{Role: "cashier", BusinessLines: []model.Line{{ID: "kedai", Type: "food_beverage"}}}
	if Authorize(u, "kedai", "food_beverage") != nil || Authorize(u, "salon", "") == nil || Authorize(u, "kedai", "salon") == nil || Admin(u) == nil || Owner(u) == nil {
		t.Fatal("permission boundary")
	}
}

func TestDateRangeAndCSV(t *testing.T) {
	z, _ := time.LoadLocation("Asia/Jakarta")
	s := &Service{Zone: z}
	start, end, e := s.DateRange("2026-01-01", "2026-01-01")
	if e != nil || start.Format(time.RFC3339) != "2025-12-31T17:00:00Z" || end.Sub(start) != 24*time.Hour {
		t.Fatal(start, end, e)
	}
	if _, _, e = s.DateRange("2024-01-01", "2024-12-31"); e != nil {
		t.Fatal(e)
	}
	for _, dates := range [][2]string{{"2024-01-01", "2025-01-01"}, {"2026-02-30", "2026-03-01"}, {"2026-02-01", "2026-01-01"}} {
		if _, _, e = s.DateRange(dates[0], dates[1]); e == nil {
			t.Fatal("accepted invalid dates", dates)
		}
	}
	if safeCSV(" =SUM(1)") != "' =SUM(1)" {
		t.Fatal("CSV formula not escaped")
	}
}

func TestDateRangeBoundIsCalendarDaysAcrossDST(t *testing.T) {
	z, e := time.LoadLocation("America/New_York")
	if e != nil {
		t.Skip("tzdata unavailable")
	}
	s := &Service{Zone: z}
	start, end, e := s.DateRange("2024-11-03", "2025-11-03")
	if e != nil {
		t.Fatal("366 inclusive days rejected across a DST transition:", e)
	}
	if end.Sub(start) != 8785*time.Hour {
		t.Fatal("unexpected exclusive end", start, end, end.Sub(start))
	}
	if _, _, e = s.DateRange("2024-11-03", "2025-11-04"); e == nil {
		t.Fatal("367 inclusive days accepted")
	}
	if _, _, e = s.DateRange("2024-03-10", "2025-03-10"); e != nil {
		t.Fatal(e)
	}
	jakarta, _ := time.LoadLocation("Asia/Jakarta")
	s = &Service{Zone: jakarta}
	if _, _, e = s.DateRange("2024-01-01", "2024-12-31"); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.DateRange("2024-01-01", "2025-01-02"); e == nil {
		t.Fatal("367 inclusive days accepted")
	}
}

func TestNotificationMessageUsesConfiguredTemplate(t *testing.T) {
	sale := model.Sale{ID: "sale-1", BusinessLineID: "line-1", Total: 25000}
	s := &Service{Template: "Kedai {{businessLineId}}: {{saleId}} = {{total}}"}
	if got := s.message(sale); got != "Kedai line-1: sale-1 = 25000" {
		t.Fatal(got)
	}
	s = &Service{}
	if got := s.message(sale); got != "Payment confirmed. Sale sale-1, IDR 25000." {
		t.Fatal(got)
	}
}

func TestPhoneNormalization(t *testing.T) {
	v := "0812-3456-7890"
	p, e := phone(&v)
	if e != nil || *p != "+6281234567890" {
		t.Fatal(p, e)
	}
	v = "not-a-number"
	if _, e = phone(&v); e == nil {
		t.Fatal("invalid phone accepted")
	}
}
