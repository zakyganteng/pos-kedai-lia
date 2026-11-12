package service

import (
	"context"
	"os"
	"testing"
)

func TestMenuEmbeddedMigrationMatchesVersionedMigration(t *testing.T) {
	embedded, err := os.ReadFile("../repo/menu_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	versioned, err := os.ReadFile("../../migrations/000005_insert_menu.up.sql")
	if err != nil || string(embedded) != string(versioned) {
		t.Fatal("embedded and versioned menu migrations differ", err)
	}
}

func TestPostgresMenuSeedRunsOnceWithInventoryAndCategories(t *testing.T) {
	f := setupWithMenu(t)
	ctx := context.Background()
	count := func(query string) int {
		t.Helper()
		var n int
		if e := f.sql.QueryRow(ctx, query).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	const seeded = "SELECT count(*) FROM records WHERE kind='products' AND (body->>'sku' LIKE 'FOOD-%' OR body->>'sku' LIKE 'DRINK-%')"
	if n := count(seeded); n != 43 {
		t.Fatal("menu not seeded", n)
	}
	if n := count("SELECT count(*) FROM records r LEFT JOIN inventory i ON i.product_id=r.id WHERE r.kind='products' AND i.product_id IS NULL"); n != 0 {
		t.Fatal("seeded products without inventory rows", n)
	}
	if n := count("SELECT count(*) FROM records WHERE kind='products' AND body->>'sku' LIKE 'FOOD-%' AND body->>'categoryId'='" + seedMakanan + "'"); n != 22 {
		t.Fatal("food not in Makanan", n)
	}
	if n := count("SELECT count(*) FROM records WHERE kind='products' AND body->>'sku' LIKE 'DRINK-%' AND body->>'categoryId'='" + seedMinuman + "'"); n != 21 {
		t.Fatal("drinks not in Minuman", n)
	}

	// An edited product must survive later Migrate calls, including a rewound version marker:
	// existing SKUs and names are skipped, never duplicated or reset.
	if _, e := f.sql.Exec(ctx, "UPDATE records SET body=jsonb_set(body,'{price}','99000') WHERE kind='products' AND body->>'sku'='FOOD-SPAGHETTI'"); e != nil {
		t.Fatal(e)
	}
	if _, e := f.sql.Exec(ctx, "DELETE FROM schema_migrations WHERE version=5"); e != nil {
		t.Fatal(e)
	}
	if e := f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if n := count(seeded); n != 43 {
		t.Fatal("re-running the seed duplicated products", n)
	}
	if n := count("SELECT count(*) FROM records WHERE body->>'sku'='FOOD-SPAGHETTI' AND (body->>'price')::int=99000"); n != 1 {
		t.Fatal("re-running the seed reset an edited product")
	}
}
