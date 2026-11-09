package validation

import (
	"encoding/json"
	"testing"
)

func TestValidation(t *testing.T) {
	if !Text("hello", 10) || Text("", 10) || Text("toolongstring", 5) {
		t.Fatalf("Text validation mismatch")
	}

	phone := "08123456789"
	normalized, err := Phone(&phone)
	if err != nil || *normalized != "+628123456789" {
		t.Fatalf("Phone normalization mismatch: %v, %v", normalized, err)
	}

	email, err := Email("  USER@Domain.com ")
	if err != nil || email != "user@domain.com" {
		t.Fatalf("Email normalization mismatch: %v, %v", email, err)
	}

	m := map[string]json.RawMessage{
		"name": json.RawMessage(`"item"`),
	}
	if err := Fields(m, []string{"name"}, []string{"name"}); err != nil {
		t.Fatalf("Fields valid check failed: %v", err)
	}
	if err := Fields(m, []string{"name"}, []string{"other"}); err == nil {
		t.Fatalf("Fields missing check failed")
	}
}
