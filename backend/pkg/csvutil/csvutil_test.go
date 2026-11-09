package csvutil

import "testing"

func TestSafeCell(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"=SUM(1,2)", "'=SUM(1,2)"},
		{"+123", "'+123"},
		{"-456", "'-456"},
		{"@mention", "'@mention"},
		{"  =TRIMMED", "'  =TRIMMED"},
		{"Normal text", "Normal text"},
		{"12345", "12345"},
	}

	for _, c := range cases {
		got := SafeCell(c.input)
		if got != c.expected {
			t.Errorf("SafeCell(%q) = %q, want %q", c.input, got, c.expected)
		}
	}
}
