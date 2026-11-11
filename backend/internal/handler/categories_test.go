package handler

import (
	"net/http/httptest"
	"pos/internal/service"
	"testing"
)

const testLine = "11111111-1111-4111-8111-111111111111"
const testCategory = "c0000000-0000-4000-8000-000000000001"

func TestCategoryFiltersAreProductOnly(t *testing.T) {
	a := &API{Service: &service.Service{}}
	r := httptest.NewRequest("GET", "/?businessLineId="+testLine+"&categoryId="+testCategory, nil)
	c, _ := newTestContext(r)
	f, e := a.filter(c, "products")
	if e != nil || f.CategoryID != testCategory || f.Uncategorized != nil {
		t.Fatalf("products categoryId: %+v %v", f, e)
	}

	r = httptest.NewRequest("GET", "/?businessLineId="+testLine+"&uncategorized=true", nil)
	c, _ = newTestContext(r)
	f, e = a.filter(c, "products")
	if e != nil || f.Uncategorized == nil || !*f.Uncategorized || f.CategoryID != "" {
		t.Fatalf("products uncategorized=true: %+v %v", f, e)
	}

	r = httptest.NewRequest("GET", "/?businessLineId="+testLine+"&uncategorized=false", nil)
	c, _ = newTestContext(r)
	f, e = a.filter(c, "products")
	if e != nil || f.Uncategorized == nil || *f.Uncategorized {
		t.Fatalf("products uncategorized=false: %+v %v", f, e)
	}

	// Absent filters stay backwards compatible: no clause is added at all.
	r = httptest.NewRequest("GET", "/?businessLineId="+testLine, nil)
	c, _ = newTestContext(r)
	f, e = a.filter(c, "products")
	if e != nil || f.CategoryID != "" || f.Uncategorized != nil {
		t.Fatalf("products without category filters: %+v %v", f, e)
	}

	for _, q := range []string{
		"categoryId=" + testCategory + "&uncategorized=true",
		"categoryId=" + testCategory + "&uncategorized=false",
		"categoryId=not-a-uuid",
		"categoryId=",
		"uncategorized=yes",
		"uncategorized=1",
		"uncategorized=",
		"categoryId=" + testCategory + "&categoryId=" + testCategory,
		"uncategorized=true&uncategorized=false",
	} {
		r = httptest.NewRequest("GET", "/?businessLineId="+testLine+"&"+q, nil)
		c, _ = newTestContext(r)
		if _, e = a.filter(c, "products"); e == nil {
			t.Errorf("products accepted %s", q)
		}
	}

	for _, kind := range []string{"services", "customers", "sales", "queue", "movements", "notifications", "categories"} {
		for _, q := range []string{"categoryId=" + testCategory, "categoryId=", "uncategorized=true", "uncategorized="} {
			r = httptest.NewRequest("GET", "/?businessLineId="+testLine+"&"+q, nil)
			c, _ = newTestContext(r)
			if _, e = a.filter(c, kind); e == nil {
				t.Errorf("%s accepted %s", kind, q)
			}
		}
	}
}

func TestCategoriesSupportTheActiveFilter(t *testing.T) {
	a := &API{Service: &service.Service{}}
	r := httptest.NewRequest("GET", "/?businessLineId="+testLine+"&active=false&search=kopi", nil)
	c, _ := newTestContext(r)
	f, e := a.filter(c, "categories")
	if e != nil || f.Active == nil || *f.Active || f.Search != "kopi" || f.Kind != "categories" {
		t.Fatalf("%+v %v", f, e)
	}
}
