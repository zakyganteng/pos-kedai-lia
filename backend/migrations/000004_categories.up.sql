-- Editable product categories (schema_migrations version 4).
--
-- This file is additive and is applied AFTER schema.sql on EVERY Migrate call.
-- schema.sql re-creates the shared trigger functions with CREATE OR REPLACE, so every
-- function, trigger and index declared here must be re-applied on each run as well.
-- No records are removed. The one-shot backfill adds category IDs to imported menu
-- products only while version 4 is absent; prices, stock and sale snapshots stay unchanged.

-- Allow the new 'categories' record kind. The inline column CHECK created by schema.sql is
-- only installed when the table is first created, so widen it here and keep it idempotent.
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='records'::regclass AND conname='records_kind_check';
 IF definition IS NULL OR position('categories' in definition)=0 THEN
  IF definition IS NOT NULL THEN ALTER TABLE records DROP CONSTRAINT records_kind_check; END IF;
  ALTER TABLE records ADD CONSTRAINT records_kind_check CHECK(kind IN ('products','services','customers','staff','sales','payments','movements','queue','notifications','categories'));
 END IF;
END $$;

-- Category names are unique per business line, case-insensitively, after trimming and
-- collapsing internal whitespace. Archived categories keep holding their name.
CREATE UNIQUE INDEX IF NOT EXISTS category_names ON records(line_id,lower(regexp_replace(btrim(body->>'name'),'\s+',' ','g'))) WHERE kind='categories';
-- Lookup path for products filtered by category and for the assigned-product counts.
CREATE INDEX IF NOT EXISTS products_by_category ON records(line_id,(body->>'categoryId')) WHERE kind='products';

CREATE OR REPLACE FUNCTION validate_category_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE business_type text; category jsonb; name_length integer; reference text;
BEGIN
 IF NEW.kind='categories' THEN
  PERFORM require_shape(NEW.body,ARRAY['name','createdAt','updatedAt'],ARRAY[]::text[],ARRAY['active']);
  IF NEW.body->>'businessLineId' IS DISTINCT FROM NEW.line_id::text THEN
   RAISE EXCEPTION 'line mismatch' USING ERRCODE='23514';
  END IF;
  SELECT type INTO business_type FROM business_lines WHERE id=NEW.line_id;
  IF business_type IS DISTINCT FROM 'food_beverage' THEN
   RAISE EXCEPTION 'wrong business type' USING ERRCODE='23514';
  END IF;
  name_length:=length(regexp_replace(btrim(NEW.body->>'name'),'\s+',' ','g'));
  IF name_length=0 OR name_length>160 THEN
   RAISE EXCEPTION 'invalid category name' USING ERRCODE='23514';
  END IF;
  -- A category may only be archived once nothing references it. Products assigned to it are
  -- counted whether they are active or archived themselves.
  IF (NEW.body->>'active')::boolean IS NOT TRUE AND EXISTS(SELECT 1 FROM records p WHERE p.kind='products' AND p.line_id=NEW.line_id AND p.body->>'categoryId'=NEW.id::text) THEN
   RAISE EXCEPTION 'category still has assigned products' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.kind='products' AND jsonb_typeof(NEW.body->'categoryId') IS NOT NULL AND jsonb_typeof(NEW.body->'categoryId')<>'null' THEN
  IF jsonb_typeof(NEW.body->'categoryId')<>'string' THEN
   RAISE EXCEPTION 'invalid category reference' USING ERRCODE='23514';
  END IF;
  reference:=NEW.body->>'categoryId';
  IF reference IS DISTINCT FROM lower(reference) THEN
   RAISE EXCEPTION 'category reference must be canonical lowercase' USING ERRCODE='23514';
  END IF;
  IF reference !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
   RAISE EXCEPTION 'invalid category reference' USING ERRCODE='23514';
  END IF;
  -- FOR SHARE serializes against a concurrent archive of the same category: the archiving
  -- transaction holds the row lock from its own UPDATE, so one of the two always loses.
  SELECT body INTO category FROM records WHERE kind='categories' AND id=reference::uuid AND line_id=NEW.line_id FOR SHARE;
  IF category IS NULL THEN
   RAISE EXCEPTION 'invalid typed or line reference' USING ERRCODE='23503';
  END IF;
  IF (category->>'active')::boolean IS NOT TRUE THEN
   RAISE EXCEPTION 'category is archived' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS category_references ON records;
CREATE CONSTRAINT TRIGGER category_references AFTER INSERT OR UPDATE ON records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_category_rules();

-- One-shot seed and backfill. Runs only on the migration that first introduces version 4, so a
-- renamed, archived or re-assigned category is never reset by a later Migrate call.
DO $$
DECLARE
 kedai_line constant uuid := '11111111-1111-4111-8111-111111111111';
 makanan constant text := 'c0000000-0000-4000-8000-000000000001';
 minuman constant text := 'c0000000-0000-4000-8000-000000000002';
 snack constant text := 'c0000000-0000-4000-8000-000000000003';
 stamp text := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
 IF EXISTS(SELECT 1 FROM schema_migrations WHERE version=4) THEN
  RETURN;
 END IF;
 IF EXISTS(SELECT 1 FROM business_lines WHERE id=kedai_line AND type='food_beverage') THEN
  INSERT INTO records(id,kind,line_id,body)
  SELECT seed.id::uuid,'categories',kedai_line,
   jsonb_build_object('id',seed.id,'businessLineId',kedai_line::text,'name',seed.name,'active',true,'productCount',0,'createdAt',stamp,'updatedAt',stamp)
  FROM (VALUES (makanan,'Makanan'),(minuman,'Minuman'),(snack,'Snack')) AS seed(id,name)
  ON CONFLICT DO NOTHING;
  -- Backfill only the imported menu SKUs, and only where no category was chosen yet.
  -- Snack is intentionally left empty; its membership is a business decision, not a guess.
  UPDATE records SET body=jsonb_set(body,'{categoryId}',to_jsonb(makanan))
   WHERE kind='products' AND line_id=kedai_line AND body->>'sku' LIKE 'MENU-F-%' AND body->>'categoryId' IS NULL;
  UPDATE records SET body=jsonb_set(body,'{categoryId}',to_jsonb(minuman))
   WHERE kind='products' AND line_id=kedai_line AND body->>'sku' LIKE 'MENU-D-%' AND body->>'categoryId' IS NULL;
 END IF;
 INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
END $$;
