package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/repo"
	"pos/pkg/csvutil"
	"pos/pkg/daterange"
	"pos/pkg/validation"
	"sort"
	"time"
)

func strict(body []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return lib.Invalid("Invalid JSON or unknown fields")
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return lib.Invalid("Only one JSON object is allowed")
	}
	return nil
}

func (s *Service) DateRange(from, to string) (time.Time, time.Time, error) {
	return daterange.Parse(from, to, s.Zone)
}

func reference(ctx context.Context, r *repo.Repo, kind, id, line string) error {
	if !lib.UUID(id) {
		return lib.Invalid("Invalid " + kind + " reference")
	}
	b, l, e := r.Get(ctx, kind, id, false)
	if e != nil {
		return e
	}
	if l != line {
		return lib.Forbidden()
	}
	var p struct {
		Active bool `json:"active"`
	}
	if e = json.Unmarshal(b, &p); e != nil {
		return e
	}
	if !p.Active {
		return lib.Conflict("Archived " + kind + " cannot be used")
	}
	return nil
}

func optionalReference(ctx context.Context, r *repo.Repo, kind string, id *string, line string) error {
	if id == nil {
		return nil
	}
	return reference(ctx, r, kind, *id, line)
}

func phone(v *string) (*string, error) {
	return validation.Phone(v)
}

func safeCSV(v string) string {
	return csvutil.SafeCell(v)
}

func sortedItems(items []dto.ItemInput) []dto.ItemInput {
	copyItems := append([]dto.ItemInput{}, items...)
	sort.SliceStable(copyItems, func(i, j int) bool { return copyItems[i].ItemID < copyItems[j].ItemID })
	return copyItems
}
