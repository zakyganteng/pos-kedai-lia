package lib

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const DefaultNotificationTemplate = "Payment confirmed. Sale {{saleId}}, IDR {{total}}."
const MaxNotificationTemplate = 500

var NotificationPlaceholders = []string{"saleId", "total", "businessLineId"}

var templateToken = regexp.MustCompile(`\{\{[A-Za-z][A-Za-z0-9]*\}\}`)

func ValidateNotificationTemplate(tpl string) error {
	if strings.TrimSpace(tpl) == "" || utf8.RuneCountInString(tpl) > MaxNotificationTemplate {
		return Invalid("Notification template must contain 1 to 500 characters")
	}
	if strings.ContainsFunc(tpl, func(r rune) bool { return unicode.IsControl(r) }) {
		return Invalid("Notification template must not contain control characters")
	}
	supported := map[string]bool{}
	for _, k := range NotificationPlaceholders {
		supported[k] = true
	}
	for _, token := range templateToken.FindAllString(tpl, -1) {
		if !supported[strings.Trim(token, "{}")] {
			return Invalid("Notification template placeholder is not supported: " + token)
		}
	}
	if rest := templateToken.ReplaceAllString(tpl, ""); strings.Contains(rest, "{{") || strings.Contains(rest, "}}") {
		return Invalid("Notification template contains a malformed placeholder")
	}
	return nil
}

func RenderNotification(tpl string, values map[string]string) string {
	return templateToken.ReplaceAllStringFunc(tpl, func(token string) string {
		if v, ok := values[strings.Trim(token, "{}")]; ok {
			return v
		}
		return token
	})
}
