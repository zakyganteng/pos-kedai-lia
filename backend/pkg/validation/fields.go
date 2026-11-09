package validation

import (
	"encoding/json"
	"pos/internal/lib"
)

// Fields ensures no unknown fields exist and required fields are present.
func Fields(m map[string]json.RawMessage, allowed []string, required []string) error {
	if len(m) == 0 {
		return lib.Invalid("At least one field is required")
	}
	set := map[string]bool{}
	for _, f := range allowed {
		set[f] = true
	}
	for k := range m {
		if !set[k] {
			return lib.Invalid("Unknown field: " + k)
		}
	}
	for _, k := range required {
		if _, ok := m[k]; !ok {
			return lib.Invalid("Missing field: " + k)
		}
	}
	return nil
}

// Value decodes a field from m rejecting null values.
func Value[T any](m map[string]json.RawMessage, key string, dst *T) error {
	b, ok := m[key]
	if !ok {
		return nil
	}
	if string(b) == "null" {
		return lib.Invalid(key + " cannot be null")
	}
	if err := json.Unmarshal(b, dst); err != nil {
		return lib.Invalid("Invalid " + key)
	}
	return nil
}

// Raw decodes a field into an untyped destination rejecting null.
func Raw(m map[string]json.RawMessage, key string, dst any) error {
	b, ok := m[key]
	if !ok {
		return nil
	}
	if string(b) == "null" {
		return lib.Invalid(key + " cannot be null")
	}
	if err := json.Unmarshal(b, dst); err != nil {
		return lib.Invalid("Invalid " + key)
	}
	return nil
}
