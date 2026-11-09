package daterange

import (
	"testing"
	"time"
)

func TestParse(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Jakarta")
	start, end, err := Parse("2026-01-01", "2026-01-01", loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if start.Format(time.RFC3339) != "2025-12-31T17:00:00Z" {
		t.Errorf("start mismatch: got %v", start.Format(time.RFC3339))
	}
	if end.Sub(start) != 24*time.Hour {
		t.Errorf("duration mismatch: got %v", end.Sub(start))
	}

	for _, invalid := range [][2]string{
		{"invalid-date", "2026-01-01"},
		{"2026-01-02", "2026-01-01"},
		{"2024-01-01", "2025-01-02"},
	} {
		if _, _, err := Parse(invalid[0], invalid[1], loc); err == nil {
			t.Errorf("expected error for %v", invalid)
		}
	}
}
