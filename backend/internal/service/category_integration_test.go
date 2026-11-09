package service

import (
	"context"
	"encoding/json"
	"errors"
	"pos/internal/dto"
	"pos/internal/lib"
	"pos/internal/model"
	"strings"
	"sync"
	"testing"
)

const seedMakanan = "c0000000-0000-4000-8000-000000000001"
const seedMinuman = "c0000000-0000-4000-8000-000000000002"
const seedSnack = "c0000000-0000-4000-8000-000000000003"

func (f *fixture) category(t *testing.T, name string) model.Category {
	t.Helper()
	c, e := f.svc.SaveCategory(context.Background(), f.owner, kedai, "", rawMap(map[string]any{"name": name}), false)
	if e != nil {
		t.Fatal(name, e)
	}
	return c
}

func (f *fixture) categoryNames(t *testing.T, filter dto.Filter) []string {
	t.Helper()
	filter.LineID = kedai
	page, e := f.svc.ListCategories(context.Background(), f.owner, filter)
	if e != nil {
		t.Fatal(e)
	}
	names := make([]string, 0, len(page.Data))
	for _, b := range page.Data {
		c, e := lib.Decode[model.Category](b)
		if e != nil {
			t.Fatal(e)
		}
		names = append(names, c.Name)
	}
	return names
}

func (f *fixture) productWithCategory(t *testing.T, category *string) (model.Product, error) {
	t.Helper()
	return f.newProduct(t, lib.ID(), category)
}

func (f *fixture) newProduct(t *testing.T, sku string, category *string) (model.Product, error) {
	t.Helper()
	body := map[string]any{"sku": sku, "name": "Coffee", "unit": "cup", "price": 15000, "stockTracked": true}
	if category != nil {
		body["categoryId"] = *category
	}
	b, e := f.svc.CatalogSave(context.Background(), f.owner, "products", kedai, "", rawMap(body), false)
	if e != nil {
		return model.Product{}, e
	}
	p, e := lib.Decode[model.Product](b)
	if e != nil {
		t.Fatal(e)
	}
	return p, nil
}

func TestPostgresCategorySeedIsIdempotentAndSurvivesEdits(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	// setup() already migrated twice; a fresh database must still hold exactly the three
	// seeded categories and no products at all.
	if got := f.categoryNames(t, dto.Filter{}); len(got) != 3 || strings.Join(got, ",") != "Makanan,Minuman,Snack" {
		t.Fatal("unexpected seed", got)
	}
	var products int
	if e := f.sql.QueryRow(ctx, "SELECT count(*) FROM records WHERE kind='products'").Scan(&products); e != nil || products != 0 {
		t.Fatal("fresh database is not product-free", products, e)
	}
	for _, id := range []string{seedMakanan, seedMinuman, seedSnack} {
		c, e := f.svc.GetCategory(ctx, f.owner, id)
		if e != nil || c.BusinessLineID != kedai || !c.Active || c.ProductCount != 0 {
			t.Fatal(id, c, e)
		}
	}

	renamed, e := f.svc.SaveCategory(ctx, f.owner, "", seedMakanan, rawMap(map[string]any{"name": "Makanan Berat"}), false)
	if e != nil || renamed.Name != "Makanan Berat" {
		t.Fatal(renamed, e)
	}
	if _, e = f.svc.SaveCategory(ctx, f.owner, "", seedSnack, nil, true); e != nil {
		t.Fatal("archiving an empty category", e)
	}
	custom := f.category(t, "Paket Hemat")

	// Re-running migrations must not resurrect, rename or re-activate anything.
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	after, e := f.svc.GetCategory(ctx, f.owner, seedMakanan)
	if e != nil || after.Name != "Makanan Berat" {
		t.Fatal("rename reset by migration", after, e)
	}
	snack, e := f.svc.GetCategory(ctx, f.owner, seedSnack)
	if e != nil || snack.Active {
		t.Fatal("archive reset by migration", snack, e)
	}
	if _, e = f.svc.GetCategory(ctx, f.owner, custom.ID); e != nil {
		t.Fatal("user category dropped by migration", e)
	}
	if got := f.categoryNames(t, dto.Filter{}); len(got) != 4 {
		t.Fatal("migration changed the category set", got)
	}
	if e = f.repo.Ping(ctx); e != nil {
		t.Fatal("readiness rejects the migrated schema", e)
	}
}

func TestPostgresCategoryCrudValidationAndUniqueness(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	created := f.category(t, "  Minuman   Dingin  ")
	if created.Name != "Minuman Dingin" {
		t.Fatal("name not trimmed and collapsed", created.Name)
	}
	if !created.Active || created.ProductCount != 0 || created.BusinessLineID != kedai {
		t.Fatal(created)
	}

	// Case, surrounding and internal whitespace all collapse onto the same unique key.
	for _, duplicate := range []string{"Minuman Dingin", "minuman dingin", "  MINUMAN    DINGIN ", "Makanan"} {
		_, e := f.svc.SaveCategory(ctx, f.owner, kedai, "", rawMap(map[string]any{"name": duplicate}), false)
		requireStatus(t, e, 409)
	}

	for _, body := range []map[string]any{
		{"name": ""},
		{"name": "   "},
		{"name": strings.Repeat("x", 161)},
		{"name": "bad\nname"},
		{"name": 12},
		{"name": "ok", "active": true},
		{"name": "ok", "unknown": 1},
	} {
		_, e := f.svc.SaveCategory(ctx, f.owner, kedai, "", rawMap(body), false)
		requireStatus(t, e, 400)
	}
	if _, e := f.svc.SaveCategory(ctx, f.owner, kedai, "", nil, false); e == nil {
		t.Fatal("empty create body accepted")
	}
	if _, e := f.svc.SaveCategory(ctx, f.owner, "", created.ID, nil, false); e == nil {
		t.Fatal("empty patch body accepted")
	}
	if _, e := f.svc.SaveCategory(ctx, f.owner, "", created.ID, rawMap(map[string]any{"name": strings.Repeat("y", 161)}), false); e == nil {
		t.Fatal("over-long rename accepted")
	}

	if _, e := f.svc.SaveCategory(ctx, f.owner, "", lib.ID(), rawMap(map[string]any{"name": "Nope"}), false); !lib.IsNotFound(e) {
		t.Fatal("unknown category patched", e)
	}
	if _, e := f.svc.GetCategory(ctx, f.owner, lib.ID()); !lib.IsNotFound(e) {
		t.Fatal("unknown category read", e)
	}

	// Archived names stay reserved, and restoring is a plain active=true patch.
	if _, e := f.svc.SaveCategory(ctx, f.owner, "", created.ID, nil, true); e != nil {
		t.Fatal(e)
	}
	_, e := f.svc.SaveCategory(ctx, f.owner, kedai, "", rawMap(map[string]any{"name": "minuman dingin"}), false)
	requireStatus(t, e, 409)
	restored, e := f.svc.SaveCategory(ctx, f.owner, "", created.ID, rawMap(map[string]any{"active": true}), false)
	if e != nil || !restored.Active {
		t.Fatal(restored, e)
	}

	// The active filter and search run server-side, before pagination.
	archived := f.category(t, "Arsip")
	if _, e = f.svc.SaveCategory(ctx, f.owner, "", archived.ID, nil, true); e != nil {
		t.Fatal(e)
	}
	yes, no := true, false
	if got := f.categoryNames(t, dto.Filter{Active: &no}); len(got) != 1 || got[0] != "Arsip" {
		t.Fatal(got)
	}
	if got := f.categoryNames(t, dto.Filter{Active: &yes}); len(got) != 4 {
		t.Fatal(got)
	}
	if got := f.categoryNames(t, dto.Filter{Search: "dingin"}); len(got) != 1 || got[0] != "Minuman Dingin" {
		t.Fatal(got)
	}
	if got := f.categoryNames(t, dto.Filter{Search: "minum"}); len(got) != 2 || got[0] != "Minuman" || got[1] != "Minuman Dingin" {
		t.Fatal(got)
	}
}

func TestPostgresCategoryAuthorizationBoundary(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	cashier, e := f.svc.UserSave(ctx, f.owner, "", rawMap(map[string]any{"name": "Kedai cashier", "email": "category_cashier@example.test", "password": "Integration-Only-Password!", "role": "cashier", "businessLineIds": []string{kedai}}), false)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.svc.ListCategories(ctx, cashier, dto.Filter{LineID: kedai, Page: 1, Limit: 20}); e != nil {
		t.Fatal("cashier cannot list categories", e)
	}
	if _, e = f.svc.GetCategory(ctx, cashier, seedMakanan); e != nil {
		t.Fatal("cashier cannot read a category", e)
	}
	_, e = f.svc.SaveCategory(ctx, cashier, kedai, "", rawMap(map[string]any{"name": "Cashier made this"}), false)
	requireStatus(t, e, 403)
	_, e = f.svc.SaveCategory(ctx, cashier, "", seedMakanan, rawMap(map[string]any{"name": "Renamed"}), false)
	requireStatus(t, e, 403)
	_, e = f.svc.SaveCategory(ctx, cashier, "", seedMakanan, nil, true)
	requireStatus(t, e, 403)

	// Categories exist only for food & beverage lines; the salon line is rejected outright.
	_, e = f.svc.ListCategories(ctx, f.owner, dto.Filter{LineID: salon, Page: 1, Limit: 20})
	requireStatus(t, e, 400)
	_, e = f.svc.SaveCategory(ctx, f.owner, salon, "", rawMap(map[string]any{"name": "Salon category"}), false)
	requireStatus(t, e, 400)

	outsider := model.User{ID: lib.ID(), Role: "owner", BusinessLines: []model.Line{{ID: lib.ID(), Type: "food_beverage"}}}
	_, e = f.svc.ListCategories(ctx, outsider, dto.Filter{LineID: kedai, Page: 1, Limit: 20})
	requireStatus(t, e, 403)
	_, e = f.svc.GetCategory(ctx, outsider, seedMakanan)
	requireStatus(t, e, 403)

	// The database refuses a category on a salon line even when the service layer is bypassed.
	body, _ := json.Marshal(map[string]any{"id": lib.ID(), "businessLineId": salon, "name": "Direct", "active": true, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"})
	if _, e = f.sql.Exec(ctx, "INSERT INTO records(id,kind,line_id,body) VALUES(($1::jsonb->>'id')::uuid,'categories',$2,$1)", string(body), salon); e == nil {
		t.Fatal("database accepted a salon category")
	}
}

func TestPostgresProductCategoryReferenceAndCounts(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	plain, e := f.productWithCategory(t, nil)
	if e != nil {
		t.Fatal(e)
	}
	if plain.CategoryID != nil {
		t.Fatal("product created with a category it never asked for", plain.CategoryID)
	}
	// Clients that predate categories keep receiving an explicit null rather than a missing key.
	raw, e := f.svc.CatalogGet(ctx, f.owner, "products", plain.ID)
	if e != nil || !strings.Contains(string(raw), `"categoryId":null`) {
		t.Fatal(string(raw), e)
	}

	makanan := seedMakanan
	assigned, e := f.productWithCategory(t, &makanan)
	if e != nil || assigned.CategoryID == nil || *assigned.CategoryID != makanan {
		t.Fatal(assigned, e)
	}

	// Reference errors are distinguished: malformed, missing, wrong line, archived.
	_, e = f.productWithCategory(t, strPtr("not-a-uuid"))
	requireStatus(t, e, 400)
	_, e = f.productWithCategory(t, strPtr(lib.ID()))
	requireStatus(t, e, 404)

	salonLike, e := f.svc.SaveCategory(ctx, f.owner, kedai, "", rawMap(map[string]any{"name": "Wrong line probe"}), false)
	if e != nil {
		t.Fatal(e)
	}
	// A category of another line is a 403 for a product in this line.
	otherLine := lib.ID()
	if _, e = f.sql.Exec(ctx, "INSERT INTO business_lines(id,code,name,type) VALUES($1,$2,'Second kedai','food_beverage')", otherLine, "kedai-"+otherLine[:8]); e != nil {
		t.Fatal(e)
	}
	foreign := lib.ID()
	foreignBody, _ := json.Marshal(map[string]any{"id": foreign, "businessLineId": otherLine, "name": "Foreign", "active": true, "productCount": 0, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"})
	if _, e = f.sql.Exec(ctx, "INSERT INTO records(id,kind,line_id,body) VALUES($1,'categories',$2,$3)", foreign, otherLine, string(foreignBody)); e != nil {
		t.Fatal(e)
	}
	_, e = f.productWithCategory(t, &foreign)
	requireStatus(t, e, 403)

	archivedCategory := f.category(t, "Archived target")
	if _, e = f.svc.SaveCategory(ctx, f.owner, "", archivedCategory.ID, nil, true); e != nil {
		t.Fatal(e)
	}
	_, e = f.productWithCategory(t, &archivedCategory.ID)
	requireStatus(t, e, 409)

	// Assigning, moving and detaching through PATCH, and the derived productCount.
	moved, e := f.svc.SaveProduct(ctx, f.owner, "", plain.ID, rawMap(map[string]any{"categoryId": makanan}), false)
	if e != nil || moved.CategoryID == nil || *moved.CategoryID != makanan {
		t.Fatal(moved, e)
	}
	counted, e := f.svc.GetCategory(ctx, f.owner, makanan)
	if e != nil || counted.ProductCount != 2 {
		t.Fatal("productCount", counted, e)
	}

	// An archived product still counts against its category.
	if _, e = f.svc.SaveProduct(ctx, f.owner, "", moved.ID, nil, true); e != nil {
		t.Fatal(e)
	}
	counted, e = f.svc.GetCategory(ctx, f.owner, makanan)
	if e != nil || counted.ProductCount != 2 {
		t.Fatal("archived product dropped from productCount", counted, e)
	}
	// ...and blocks archiving the category, through DELETE and through active=false alike.
	_, e = f.svc.SaveCategory(ctx, f.owner, "", makanan, nil, true)
	requireStatus(t, e, 409)
	_, e = f.svc.SaveCategory(ctx, f.owner, "", makanan, rawMap(map[string]any{"active": false}), false)
	requireStatus(t, e, 409)

	detached, e := f.svc.SaveProduct(ctx, f.owner, "", moved.ID, rawMap(map[string]any{"categoryId": nil}), false)
	if e != nil || detached.CategoryID != nil {
		t.Fatal(detached, e)
	}
	_, e = f.svc.SaveProduct(ctx, f.owner, "", assigned.ID, rawMap(map[string]any{"categoryId": salonLike.ID}), false)
	if e != nil {
		t.Fatal(e)
	}
	emptied, e := f.svc.SaveCategory(ctx, f.owner, "", makanan, nil, true)
	if e != nil || emptied.Active {
		t.Fatal("empty category refused archiving", emptied, e)
	}
}

func TestPostgresCategoryUUIDsAreCanonical(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	upper := strings.ToUpper(seedMakanan)
	p, e := f.productWithCategory(t, &upper)
	if e != nil || p.CategoryID == nil || *p.CategoryID != seedMakanan {
		t.Fatal("assignment did not canonicalize the UUID", p, e)
	}
	category, e := f.svc.GetCategory(ctx, f.owner, upper)
	if e != nil || category.ProductCount != 1 {
		t.Fatal("uppercase lookup lost the product count", category, e)
	}
	page, e := f.svc.List(ctx, f.owner, dto.Filter{Kind: "products", LineID: kedai, CategoryID: upper, Page: 1, Limit: 100})
	if e != nil || len(page.Data) != 1 {
		t.Fatal("uppercase filter lost the assigned product", page, e)
	}
	_, e = f.svc.SaveCategory(ctx, f.owner, "", upper, nil, true)
	requireStatus(t, e, 409)
	if _, e = f.sql.Exec(ctx, "UPDATE records SET body=jsonb_set(body,'{categoryId}',to_jsonb($2::text)) WHERE id=$1", p.ID, upper); e == nil {
		t.Fatal("direct SQL bypassed canonical category references")
	}
}

func TestPostgresProductCategoryEditsPreserveSnapshots(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	p := f.product(t, 7)
	sale, e := f.svc.CreateSale(ctx, f.owner, kedai, lib.ID(), input(p, "cash", 2))
	if e != nil {
		t.Fatal(e)
	}

	moved, e := f.svc.SaveProduct(ctx, f.owner, "", p.ID, rawMap(map[string]any{"categoryId": seedMinuman}), false)
	if e != nil {
		t.Fatal(e)
	}
	if moved.Price != p.Price || moved.SKU != p.SKU || moved.Unit != p.Unit || moved.StockTracked != p.StockTracked {
		t.Fatal("category edit rewrote catalog fields", p, moved)
	}
	if moved.StockOnHand != 5 || moved.ReservedQuantity != 0 {
		t.Fatal("category edit disturbed stock", moved)
	}
	if !moved.CreatedAt.Equal(p.CreatedAt) {
		t.Fatal("createdAt rewritten", p.CreatedAt, moved.CreatedAt)
	}

	fetched, e := f.svc.Sale(ctx, f.owner, sale.ID)
	if e != nil {
		t.Fatal(e)
	}
	if len(fetched.Items) != 1 || fetched.Items[0].UnitPrice != p.Price || fetched.Items[0].DisplayName != p.Name || fetched.Total != sale.Total {
		t.Fatal("sale snapshot changed with the category", fetched)
	}
}

func TestPostgresProductCategoryFilters(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	makanan, minuman := seedMakanan, seedMinuman
	food, e := f.productWithCategory(t, &makanan)
	if e != nil {
		t.Fatal(e)
	}
	drink, e := f.productWithCategory(t, &minuman)
	if e != nil {
		t.Fatal(e)
	}
	loose, e := f.productWithCategory(t, nil)
	if e != nil {
		t.Fatal(e)
	}

	ids := func(f *fixture, filter dto.Filter) []string {
		t.Helper()
		filter.Kind, filter.LineID, filter.Page, filter.Limit = "products", kedai, 1, 50
		page, e := f.svc.List(ctx, f.owner, filter)
		if e != nil {
			t.Fatal(e)
		}
		out := make([]string, 0, len(page.Data))
		for _, b := range page.Data {
			p, e := lib.Decode[model.Product](b)
			if e != nil {
				t.Fatal(e)
			}
			out = append(out, p.ID)
		}
		return out
	}

	// No filter stays backwards compatible and returns assigned and unassigned alike.
	all := ids(f, dto.Filter{})
	if len(all) != 3 {
		t.Fatal(all)
	}
	if got := ids(f, dto.Filter{CategoryID: makanan}); len(got) != 1 || got[0] != food.ID {
		t.Fatal(got)
	}
	if got := ids(f, dto.Filter{CategoryID: minuman}); len(got) != 1 || got[0] != drink.ID {
		t.Fatal(got)
	}
	yes, no := true, false
	if got := ids(f, dto.Filter{Uncategorized: &yes}); len(got) != 1 || got[0] != loose.ID {
		t.Fatal(got)
	}
	if got := ids(f, dto.Filter{Uncategorized: &no}); len(got) != 2 {
		t.Fatal(got)
	}
	if got := ids(f, dto.Filter{CategoryID: seedSnack}); len(got) != 0 {
		t.Fatal(got)
	}
	// Filters compose with the existing ones and the totals stay filtered.
	page, e := f.svc.List(ctx, f.owner, dto.Filter{Kind: "products", LineID: kedai, Page: 1, Limit: 50, CategoryID: makanan, Active: &yes})
	if e != nil || page.Pagination.Total != 1 {
		t.Fatal(page.Pagination, e)
	}
}

func TestPostgresCategoryArchiveAndAssignmentSerialize(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	// Archiving a category and assigning a product to it must never both succeed. The product
	// write takes a shared lock on the category row while the archive holds its exclusive one,
	// so whichever commits second is rejected by the database, not only by an in-memory check.
	for attempt := 0; attempt < 15; attempt++ {
		target := f.category(t, "Race target "+lib.ID()[:8])
		product, e := f.productWithCategory(t, nil)
		if e != nil {
			t.Fatal(e)
		}
		var wg sync.WaitGroup
		results := make([]error, 2)
		start := make(chan struct{})
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, results[0] = f.svc.SaveProduct(ctx, f.owner, "", product.ID, rawMap(map[string]any{"categoryId": target.ID}), false)
		}()
		go func() {
			defer wg.Done()
			<-start
			_, results[1] = f.svc.SaveCategory(ctx, f.owner, "", target.ID, nil, true)
		}()
		close(start)
		wg.Wait()

		for _, e := range results {
			var de *lib.Error
			if e != nil && !errors.As(e, &de) {
				t.Fatal("racing writer failed with an unmapped error", e)
			}
		}
		if results[0] == nil && results[1] == nil {
			t.Fatal("assignment and archive both succeeded on the same category")
		}
		assigned, e := f.svc.GetProduct(ctx, f.owner, product.ID)
		if e != nil {
			t.Fatal(e)
		}
		stored, e := f.svc.GetCategory(ctx, f.owner, target.ID)
		if e != nil {
			t.Fatal(e)
		}
		linked := assigned.CategoryID != nil && *assigned.CategoryID == target.ID
		if linked && !stored.Active {
			t.Fatal("a product ended up assigned to an archived category")
		}
		// The reported outcome and the stored state have to agree in both directions.
		if linked != (results[0] == nil) || stored.Active == (results[1] == nil) {
			t.Fatalf("outcome disagrees with stored state: assign=%v archive=%v linked=%v active=%v", results[0], results[1], linked, stored.Active)
		}
		if !stored.Active && stored.ProductCount != 0 {
			t.Fatal("archived category still reports assigned products", stored.ProductCount)
		}
	}
}

func TestPostgresCategoryBackfillRunsOnlyOnTheFirstUpgrade(t *testing.T) {
	f := setup(t)
	ctx := context.Background()

	// Imported menu products that predate the categories migration, plus a hand-made product
	// and one that already carries a category.
	food, e := f.newProduct(t, "MENU-F-0001", nil)
	if e != nil {
		t.Fatal(e)
	}
	drink, e := f.newProduct(t, "MENU-D-0001", nil)
	if e != nil {
		t.Fatal(e)
	}
	manual, e := f.newProduct(t, "HOUSE-SPECIAL-1", nil)
	if e != nil {
		t.Fatal(e)
	}
	snack := seedSnack
	preAssigned, e := f.newProduct(t, "MENU-F-0002", &snack)
	if e != nil {
		t.Fatal(e)
	}

	// Rewind the version marker so the one-shot seed and backfill block runs against a database
	// that already holds products, exactly as a live upgrade would.
	if _, e = f.sql.Exec(ctx, "DELETE FROM schema_migrations WHERE version=4"); e != nil {
		t.Fatal(e)
	}
	if e = f.repo.Ping(ctx); e == nil {
		t.Fatal("readiness passed without the categories migration")
	}
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if e = f.repo.Ping(ctx); e != nil {
		t.Fatal(e)
	}

	categoryOf := func(id string) *string {
		t.Helper()
		p, e := f.svc.GetProduct(ctx, f.owner, id)
		if e != nil {
			t.Fatal(e)
		}
		return p.CategoryID
	}
	if got := categoryOf(food.ID); got == nil || *got != seedMakanan {
		t.Fatal("MENU-F- was not backfilled into Makanan", got)
	}
	if got := categoryOf(drink.ID); got == nil || *got != seedMinuman {
		t.Fatal("MENU-D- was not backfilled into Minuman", got)
	}
	if got := categoryOf(manual.ID); got != nil {
		t.Fatal("an unrelated product was categorised", *got)
	}
	if got := categoryOf(preAssigned.ID); got == nil || *got != seedSnack {
		t.Fatal("an existing assignment was overwritten by the backfill", got)
	}

	// Prices, units and stock-tracking survive the backfill untouched.
	after, e := f.svc.GetProduct(ctx, f.owner, food.ID)
	if e != nil || after.Price != food.Price || after.SKU != food.SKU || after.Unit != food.Unit || after.StockTracked != food.StockTracked || !after.UpdatedAt.Equal(food.UpdatedAt) {
		t.Fatal("backfill rewrote product fields", food, after, e)
	}

	// Snack keeps only its deliberate member; nothing was guessed into it.
	snackCategory, e := f.svc.GetCategory(ctx, f.owner, seedSnack)
	if e != nil || snackCategory.ProductCount != 1 {
		t.Fatal(snackCategory, e)
	}

	// A later Migrate must not reapply the backfill over a deliberate detach.
	if _, e = f.svc.SaveProduct(ctx, f.owner, "", food.ID, rawMap(map[string]any{"categoryId": nil}), false); e != nil {
		t.Fatal(e)
	}
	if e = f.repo.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	if got := categoryOf(food.ID); got != nil {
		t.Fatal("migration re-applied the backfill over a deliberate detach", *got)
	}
}

func strPtr(v string) *string { return &v }
