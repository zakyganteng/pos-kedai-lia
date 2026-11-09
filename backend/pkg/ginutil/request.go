package ginutil

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"pos/internal/lib"

	"github.com/gin-gonic/gin"
)

// Body reads, size-limits (1 MiB), and enforces strict JSON object validation.
func Body(c *gin.Context) ([]byte, error) {
	media, _, e := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if e != nil || media != "application/json" {
		return nil, lib.Invalid("Content-Type application/json required")
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	b, e := io.ReadAll(c.Request.Body)
	if e != nil {
		return nil, lib.Invalid("Request body is invalid or exceeds 1 MiB")
	}
	if len(b) == 0 {
		return nil, lib.Invalid("JSON body required")
	}
	if e = UniqueJSON(b); e != nil {
		return nil, e
	}
	return b, nil
}

// Decode deserializes the request body rejecting unknown fields.
func Decode(c *gin.Context, v any) error {
	b, e := Body(c)
	if e != nil {
		return e
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e = d.Decode(v); e != nil {
		return lib.Invalid("Invalid JSON or unknown fields")
	}
	return nil
}

// BodyMap decodes the body into a JSON raw-message map.
func BodyMap(c *gin.Context) (map[string]json.RawMessage, error) {
	var m map[string]json.RawMessage
	e := Decode(c, &m)
	if e == nil && len(m) == 0 {
		e = lib.Invalid("JSON object with at least one field required")
	}
	return m, e
}

// UniqueJSON validates that b is a single JSON object with no duplicate keys and depth <= 30.
func UniqueJSON(b []byte) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 30 {
			return lib.Invalid("JSON nesting exceeds limit")
		}
		t, e := d.Token()
		if e != nil {
			return lib.Invalid("Invalid JSON")
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				t, e = d.Token()
				if e != nil {
					return lib.Invalid("Invalid JSON")
				}
				k, ok := t.(string)
				if !ok || seen[k] {
					return lib.Invalid("Duplicate JSON object key")
				}
				seen[k] = true
				if e = walk(depth + 1); e != nil {
					return e
				}
			}
		case '[':
			for d.More() {
				if e = walk(depth + 1); e != nil {
					return e
				}
			}
		default:
			return lib.Invalid("Invalid JSON")
		}
		_, e = d.Token()
		return e
	}
	if len(bytes.TrimSpace(b)) == 0 || bytes.TrimSpace(b)[0] != '{' {
		return lib.Invalid("JSON object required")
	}
	if e := walk(0); e != nil {
		return lib.Invalid("Invalid JSON or duplicate object key")
	}
	if _, e := d.Token(); e != io.EOF {
		return lib.Invalid("Only one JSON value is allowed")
	}
	return nil
}
