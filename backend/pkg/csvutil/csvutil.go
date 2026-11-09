package csvutil

import "strings"

// SafeCell escapes spreadsheet formula injection triggers (=, +, -, @) with a leading single quote.
func SafeCell(v string) string {
	trim := strings.TrimLeft(v, " \t\r\n")
	if trim != "" && strings.ContainsRune("=+-@", rune(trim[0])) {
		return "'" + v
	}
	return v
}
