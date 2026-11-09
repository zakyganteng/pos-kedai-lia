package paging

import (
	"encoding/json"
	"testing"
)

func TestPaginate(t *testing.T) {
	data := []json.RawMessage{
		json.RawMessage(`{"id":1}`),
		json.RawMessage(`{"id":2}`),
		json.RawMessage(`{"id":3}`),
		json.RawMessage(`{"id":4}`),
		json.RawMessage(`{"id":5}`),
	}

	p := Paginate(data, 1, 2)
	if len(p.Data) != 2 || p.Pagination.Page != 1 || p.Pagination.Total != 5 || p.Pagination.TotalPages != 3 {
		t.Errorf("unexpected page: %+v", p)
	}

	p2 := Paginate(data, 3, 2)
	if len(p2.Data) != 1 || p2.Pagination.Page != 3 {
		t.Errorf("unexpected page: %+v", p2)
	}

	pEmpty := Paginate(data, 5, 2)
	if len(pEmpty.Data) != 0 {
		t.Errorf("expected empty data, got %d", len(pEmpty.Data))
	}
}
