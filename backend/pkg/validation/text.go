package validation

import (
	"net/mail"
	"pos/internal/lib"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Text validates non-empty string within max runes and without control characters.
func Text(v string, max int) bool {
	return strings.TrimSpace(v) != "" && utf8.RuneCountInString(v) <= max && !strings.ContainsFunc(v, func(r rune) bool { return unicode.IsControl(r) })
}

// Phone normalizes and validates phone numbers (international or Indonesian local).
func Phone(v *string) (*string, error) {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil, nil
	}
	p := strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(*v)
	if strings.HasPrefix(p, "0") {
		p = "+62" + p[1:]
	} else if strings.HasPrefix(p, "62") {
		p = "+" + p
	}
	if len(p) < 9 || len(p) > 16 || p[0] != '+' {
		return nil, lib.Invalid("Phone must be an international number or Indonesian local number")
	}
	for _, r := range p[1:] {
		if r < '0' || r > '9' {
			return nil, lib.Invalid("Invalid phone")
		}
	}
	return &p, nil
}

// Email normalizes and parses an email address.
func Email(s string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(s))
	if len(normalized) > 254 {
		return "", lib.Invalid("Invalid email")
	}
	address, err := mail.ParseAddress(normalized)
	if err != nil || address.Address != normalized {
		return "", lib.Invalid("Invalid email")
	}
	return normalized, nil
}
