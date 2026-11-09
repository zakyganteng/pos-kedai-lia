package service

import "testing"

func TestCategoryNameNormalization(t *testing.T) {
	for raw, want := range map[string]string{
		"  Makanan  ":     "Makanan",
		"Es   Teh":        "Es Teh",
		"Nasi Goreng":     "Nasi Goreng",
		" Kopi  Susu   ":  "Kopi Susu",
		"Minuman":         "Minuman",
		"  A   B    C   ": "A B C",
	} {
		if got := CategoryName(raw); got != want {
			t.Errorf("CategoryName(%q)=%q, want %q", raw, got, want)
		}
	}
}
