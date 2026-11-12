-- Seed the Kedai menu (schema_migrations version 5).
--
-- Applied after category_schema.sql on EVERY Migrate call, but the body only runs while
-- version 5 is absent, so a product that was later renamed, re-priced or archived is never
-- reset. Items whose SKU or name already exists on the line (for example from
-- frontend/scripts/import-menu.mjs) are skipped instead of duplicated.
DO $$
DECLARE
 kedai_line constant uuid := '11111111-1111-4111-8111-111111111111';
 makanan constant text := 'c0000000-0000-4000-8000-000000000001';
 minuman constant text := 'c0000000-0000-4000-8000-000000000002';
 stamp text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
 IF EXISTS(SELECT 1 FROM schema_migrations WHERE version=5) THEN
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM business_lines WHERE id=kedai_line AND type='food_beverage') THEN
  WITH menu(sku,name,unit,price) AS (VALUES
  ('FOOD-AYAM-LALAPAN','Ayam lalapan','porsi',19000),
  ('FOOD-LELE-LALAPAN','Lele lalapan','porsi',15000),
  ('FOOD-AYAM-PAKET-HEMAT','Ayam paket hemat','porsi',12000),
  ('FOOD-NASI-GORENG-JADUL','Nasi goreng jadul','porsi',14000),
  ('FOOD-NASI-TELUR-DADAR','Nasi telur dadar','porsi',10000),
  ('FOOD-SPAGHETTI','Spaghetti','porsi',12000),
  ('FOOD-SEBLAK-KUAH','Seblak kuah','porsi',12000),
  ('FOOD-SEBLAK-RAFAEL','Seblak rafael','porsi',10000),
  ('FOOD-CEKER-MERCON','Ceker mercon','porsi',12000),
  ('FOOD-BAKSO-CUANKI','Bakso cuanki','porsi',12000),
  ('FOOD-INDOMIE-GORENG','Indomie goreng','porsi',12000),
  ('FOOD-INDOMIE-REBUS','Indomie rebus','porsi',12000),
  ('FOOD-ROTI-BAKAR','Roti bakar','porsi',12000),
  ('FOOD-BAKWAN-JAGUNG','Bakwan jagung','porsi',2000),
  ('FOOD-TEMPE-MENDOAN','Tempe mendoan','porsi',2000),
  ('FOOD-PARU-GORENG','Paru goreng','porsi',10000),
  ('FOOD-UDANG-GORENG','Udang goreng','porsi',10000),
  ('FOOD-NUGGET','Nugget','porsi',10000),
  ('FOOD-CIRENG','Cireng','porsi',10000),
  ('FOOD-FISH-ROLL','Fish roll','porsi',10000),
  ('FOOD-KENTANG-GORENG','Kentang goreng','porsi',12000),
  ('FOOD-SOSIS-TELUR','Sosis telur','porsi',7000),
  ('DRINK-KOPI-HITAM','Kopi hitam','gelas',5000),
  ('DRINK-ENERGEN-PANAS','Energen panas','gelas',5000),
  ('DRINK-ES-ENERGEN','Es Energen','gelas',8000),
  ('DRINK-ES-TEH-TARIK','Es Teh tarik','gelas',8000),
  ('DRINK-ES-JERUK','Es jeruk','gelas',7000),
  ('DRINK-ES-TEH','Es teh','gelas',4000),
  ('DRINK-ES-TEH-TAWAR','Es Teh Tawar','gelas',2000),
  ('DRINK-AIR-PUTIH','Air putih','gelas',2000),
  ('DRINK-ES-LEMON-TEA','Es Lemon tea','gelas',12000),
  ('DRINK-LYCHEE-TEA','Lychee tea','gelas',12000),
  ('DRINK-MILO-DINOSAUR','Milo dinosaur','gelas',12000),
  ('DRINK-MANGO-MILKSHAKE','Mango milkshake','gelas',12000),
  ('DRINK-MATCHA-MILKSHAKE','Matcha milkshake','gelas',12000),
  ('DRINK-SALTED-CARAMEL-MILKSHAKE','Salted caramel milkshake','gelas',12000),
  ('DRINK-CHOCO-MILKSHAKE','Choco milkshake','gelas',12000),
  ('DRINK-THAI-TEA','Thai tea','gelas',12000),
  ('DRINK-ES-KUKUBIMA','Es kukubima','gelas',6000),
  ('DRINK-ES-KUKUBIMA-SUSU','Es kukubima susu','gelas',8000),
  ('DRINK-ES-EXTRAJOSS','Es Extrajoss','gelas',6000),
  ('DRINK-ES-EXTRAJOSS-SUSU','Es Extrajoss susu','gelas',8000),
  ('DRINK-ES-SUSU-SODA-GEMBIRA','Es Susu soda gembira','gelas',12000)
  ), fresh AS (
   SELECT gen_random_uuid() AS id,m.*,
    -- Only reference a category that is still active; otherwise leave the product uncategorized.
    (SELECT c.id::text FROM records c WHERE c.kind='categories' AND c.line_id=kedai_line AND (c.body->>'active')::boolean IS TRUE
      AND c.id::text=CASE WHEN m.sku LIKE 'FOOD-%' THEN makanan ELSE minuman END) AS category_id
   FROM menu m
   WHERE NOT EXISTS(SELECT 1 FROM records p WHERE p.kind='products' AND p.line_id=kedai_line
    AND (lower(p.body->>'sku')=lower(m.sku) OR lower(regexp_replace(btrim(p.body->>'name'),'\s+',' ','g'))=lower(m.name)))
  ), inserted AS (
   INSERT INTO records(id,kind,line_id,body)
   SELECT f.id,'products',kedai_line,jsonb_build_object(
    'id',f.id::text,'businessLineId',kedai_line::text,'sku',f.sku,'name',f.name,'unit',f.unit,'price',f.price,
    'categoryId',f.category_id,'stockTracked',false,'active',true,'createdAt',stamp,'updatedAt',stamp)
   FROM fresh f
   RETURNING id
  )
  INSERT INTO inventory(product_id) SELECT id FROM inserted;
 END IF;
 INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
END $$;
