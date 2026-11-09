CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS business_lines(id uuid PRIMARY KEY,code text UNIQUE NOT NULL,name text NOT NULL,type text NOT NULL CHECK(type IN ('food_beverage','salon')));
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name text NOT NULL,email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL CHECK(role IN ('owner','admin','cashier')),active boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS user_lines(user_id uuid REFERENCES users(id),line_id uuid REFERENCES business_lines(id),PRIMARY KEY(user_id,line_id));
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS records(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('products','services','customers','staff','sales','payments','movements','queue','notifications')),line_id uuid NOT NULL REFERENCES business_lines(id),body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),CHECK(body->>'id'=id::text),CHECK(body->>'businessLineId' IS NULL OR body->>'businessLineId'=line_id::text));
CREATE INDEX IF NOT EXISTS records_line_kind ON records(line_id,kind,created_at DESC,id);
CREATE UNIQUE INDEX IF NOT EXISTS products_sku ON records(line_id,lower(body->>'sku')) WHERE kind='products';
CREATE UNIQUE INDEX IF NOT EXISTS customer_phone ON records(line_id,(body->>'phone')) WHERE kind='customers' AND body->>'phone' IS NOT NULL AND body->>'phone'<>'';
CREATE UNIQUE INDEX IF NOT EXISTS notifications_sale ON records((body->>'saleId')) WHERE kind='notifications';
CREATE UNIQUE INDEX IF NOT EXISTS payments_sale ON records((body->>'saleId')) WHERE kind='payments';
CREATE INDEX IF NOT EXISTS records_status ON records(kind,(body->>'status'),created_at);
CREATE TABLE IF NOT EXISTS inventory(product_id uuid PRIMARY KEY REFERENCES records(id),quantity bigint NOT NULL DEFAULT 0 CHECK(quantity BETWEEN 0 AND 1000000000),reserved bigint NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND quantity),threshold bigint NOT NULL DEFAULT 0 CHECK(threshold BETWEEN 0 AND 1000000000));
CREATE TABLE IF NOT EXISTS idempotency(scope text NOT NULL,key text NOT NULL,fingerprint text NOT NULL,record_id uuid NOT NULL REFERENCES records(id),PRIMARY KEY(scope,key));
CREATE TABLE IF NOT EXISTS queue_counters(line_id uuid NOT NULL REFERENCES business_lines(id),business_date date NOT NULL,last_number integer NOT NULL CHECK(last_number>0),PRIMARY KEY(line_id,business_date));
CREATE TABLE IF NOT EXISTS payment_events(event_id text PRIMARY KEY,body_hash text NOT NULL,line_id uuid REFERENCES business_lines(id),body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS payment_events_line ON payment_events(line_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS records_typed_identity ON records(id,line_id,kind);
CREATE INDEX IF NOT EXISTS confirmed_sales_range ON records(line_id,created_at,id) WHERE kind='sales' AND body->>'status'='paid';
CREATE UNIQUE INDEX IF NOT EXISTS queue_sale_unique ON records((body->>'saleId')) WHERE kind='queue' AND body->>'saleId' IS NOT NULL;
CREATE TABLE IF NOT EXISTS sale_items(
 id uuid PRIMARY KEY,
 sale_id uuid NOT NULL REFERENCES records(id) DEFERRABLE INITIALLY DEFERRED,
 line_id uuid NOT NULL REFERENCES business_lines(id),
 item_id uuid NOT NULL,
 item_kind text NOT NULL CHECK(item_kind IN ('products','services')),
 display_name text NOT NULL,
 unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 1000000000000),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 line_total bigint NOT NULL CHECK(line_total BETWEEN 0 AND 1000000000000 AND line_total=unit_price*quantity),
 staff_id uuid REFERENCES records(id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(item_id,line_id,item_kind) REFERENCES records(id,line_id,kind) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(sale_id,item_id)
);
CREATE INDEX IF NOT EXISTS sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS sale_items_staff ON sale_items(staff_id);
CREATE UNIQUE INDEX IF NOT EXISTS daily_queue_number ON records(line_id,(body->>'date'),((body->>'queueNumber')::integer)) WHERE kind='queue';
CREATE OR REPLACE FUNCTION assert_record_ref(ref text, expected_kind text, expected_line uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM records WHERE id=ref::uuid AND kind=expected_kind AND line_id=expected_line) THEN
  RAISE EXCEPTION 'invalid typed or line reference' USING ERRCODE='23503';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION require_shape(b jsonb, strings text[], numbers text[], bools text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
 FOREACH k IN ARRAY strings LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'string' OR length(btrim(b->>k))=0 THEN RAISE EXCEPTION 'mandatory string missing or invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOREACH k IN ARRAY numbers LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR (b->>k)!~'^[0-9]+$' THEN RAISE EXCEPTION 'mandatory integer missing or invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOREACH k IN ARRAY bools LOOP
  IF jsonb_typeof(b->k) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'mandatory boolean missing or invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION validate_record_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; business_type text; total numeric; current_sale jsonb; current_payment jsonb;
BEGIN
 PERFORM require_shape(NEW.body,ARRAY['id','createdAt'],ARRAY[]::text[],ARRAY[]::text[]);
 IF NEW.body->>'id' IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION 'identity mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN ('products','services','customers','staff','sales','queue') AND NEW.body->>'businessLineId' IS DISTINCT FROM NEW.line_id::text THEN RAISE EXCEPTION 'line mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='products' THEN PERFORM require_shape(NEW.body,ARRAY['sku','name','unit','updatedAt'],ARRAY['price'],ARRAY['active','stockTracked']); END IF;
 IF NEW.kind='services' THEN PERFORM require_shape(NEW.body,ARRAY['name','updatedAt'],ARRAY['price'],ARRAY['active']); END IF;
 IF NEW.kind IN ('customers','staff') THEN PERFORM require_shape(NEW.body,ARRAY['name','updatedAt'],ARRAY[]::text[],ARRAY['active']); END IF;
 IF NEW.kind='payments' THEN PERFORM require_shape(NEW.body,ARRAY['saleId','method','status','currency'],ARRAY['amount'],ARRAY[]::text[]); END IF;
 IF NEW.kind='sales' THEN
  PERFORM require_shape(NEW.body,ARRAY['cashierId','status'],ARRAY['total','subtotal'],ARRAY[]::text[]);
  IF jsonb_typeof(NEW.body->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.body->'items') NOT BETWEEN 1 AND 100 OR jsonb_typeof(NEW.body->'payment') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'sale item or payment shape' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='queue' THEN
  PERFORM require_shape(NEW.body,ARRAY['status','date'],ARRAY['queueNumber'],ARRAY[]::text[]);
  IF jsonb_typeof(NEW.body->'serviceIds') IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.body->'serviceIds') NOT BETWEEN 1 AND 20 OR (NEW.body->>'queueNumber')::integer<1 OR NEW.body->>'status' NOT IN ('waiting','in_service','completed','cancelled') THEN RAISE EXCEPTION 'queue shape' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='notifications' THEN PERFORM require_shape(NEW.body,ARRAY['saleId','status'],ARRAY['attemptCount'],ARRAY[]::text[]); END IF;
 IF NEW.kind='movements' THEN
  PERFORM require_shape(NEW.body,ARRAY['productId','type','reason','actorId'],ARRAY[]::text[],ARRAY[]::text[]);
  IF jsonb_typeof(NEW.body->'quantityDelta') IS DISTINCT FROM 'number' OR (NEW.body->>'quantityDelta')!~'^-?[0-9]+$' THEN RAISE EXCEPTION 'movement integer shape' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT type INTO business_type FROM business_lines WHERE id=NEW.line_id;
 IF NEW.kind IN ('products','movements') AND business_type<>'food_beverage' OR NEW.kind IN ('services','queue') AND business_type<>'salon' THEN
  RAISE EXCEPTION 'wrong business type' USING ERRCODE='23514';
 END IF;
 IF NEW.kind IN ('products','services') AND ((NEW.body->>'price')::numeric NOT BETWEEN 0 AND 1000000000000 OR length(btrim(NEW.body->>'name'))=0) THEN
  RAISE EXCEPTION 'invalid catalog fields' USING ERRCODE='23514';
 END IF;
 IF NEW.kind IN ('sales','queue') THEN
  PERFORM assert_record_ref(NEW.body->>'customerId','customers',NEW.line_id);
 END IF;
 IF NEW.kind='queue' THEN
  PERFORM assert_record_ref(NEW.body->>'staffId','staff',NEW.line_id);
  PERFORM assert_record_ref(NEW.body->>'saleId','sales',NEW.line_id);
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.body->'serviceIds') LOOP
   PERFORM assert_record_ref(item#>>'{}','services',NEW.line_id);
  END LOOP;
 END IF;
 IF NEW.kind IN ('payments','notifications','movements') THEN
  PERFORM assert_record_ref(NEW.body->>'saleId','sales',NEW.line_id);
 END IF;
 IF NEW.kind='payments' AND (NEW.body->>'currency'<>'IDR' OR (NEW.body->>'amount')::numeric NOT BETWEEN 0 AND 1000000000000 OR NEW.body->>'method' NOT IN ('cash','qris') OR NEW.body->>'status' NOT IN ('pending','confirmed','failed','expired','voided')) THEN
  RAISE EXCEPTION 'invalid payment' USING ERRCODE='23514';
 END IF;
 IF NEW.kind='movements' THEN
  PERFORM assert_record_ref(NEW.body->>'productId','products',NEW.line_id);
  IF (NEW.body->>'quantityDelta')::bigint=0 OR NEW.body->>'type' NOT IN ('receive','adjustment','sale') OR NOT EXISTS(SELECT 1 FROM users WHERE id=(NEW.body->>'actorId')::uuid) THEN
   RAISE EXCEPTION 'invalid movement' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.kind='sales' THEN
  IF NEW.body->>'status' NOT IN ('pending_payment','paid','cancelled','voided') OR NOT EXISTS(SELECT 1 FROM users WHERE id=(NEW.body->>'cashierId')::uuid) THEN
   RAISE EXCEPTION 'invalid sale' USING ERRCODE='23514';
  END IF;
  total:=0;
  FOR item IN SELECT * FROM jsonb_array_elements(NEW.body->'items') LOOP
   PERFORM require_shape(item,ARRAY['id','itemId','itemType','displayName'],ARRAY['unitPrice','quantity','lineTotal'],ARRAY['stockTracked']);
   IF item->>'itemType' NOT IN ('product','service') THEN RAISE EXCEPTION 'invalid item type' USING ERRCODE='23514'; END IF;
   PERFORM assert_record_ref(item->>'itemId',CASE item->>'itemType' WHEN 'product' THEN 'products' ELSE 'services' END,NEW.line_id);
   PERFORM assert_record_ref(item->>'staffId','staff',NEW.line_id);
   IF TG_OP='INSERT' THEN
    INSERT INTO sale_items(id,sale_id,line_id,item_id,item_kind,display_name,unit_price,quantity,line_total,staff_id)
    VALUES((item->>'id')::uuid,NEW.id,NEW.line_id,(item->>'itemId')::uuid,CASE item->>'itemType' WHEN 'product' THEN 'products' ELSE 'services' END,item->>'displayName',(item->>'unitPrice')::bigint,(item->>'quantity')::integer,(item->>'lineTotal')::bigint,(item->>'staffId')::uuid);
   END IF;
   total:=total+(item->>'lineTotal')::numeric;
  END LOOP;
  IF total<>(NEW.body->>'total')::numeric OR total<>(NEW.body->>'subtotal')::numeric OR total NOT BETWEEN 0 AND 1000000000000 THEN
   RAISE EXCEPTION 'sale total mismatch' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.kind IN ('sales','payments') THEN
  SELECT body INTO current_sale FROM records WHERE kind='sales' AND id=CASE NEW.kind WHEN 'sales' THEN NEW.id ELSE (NEW.body->>'saleId')::uuid END;
  SELECT body INTO current_payment FROM records WHERE kind='payments' AND id=(current_sale->'payment'->>'id')::uuid;
  IF current_sale IS NULL OR current_payment IS NULL OR current_sale->'payment' IS DISTINCT FROM current_payment OR (current_sale->>'total')::numeric IS DISTINCT FROM (current_payment->>'amount')::numeric OR current_payment->>'saleId' IS DISTINCT FROM current_sale->>'id' OR current_payment->>'currency' IS DISTINCT FROM 'IDR' THEN
   RAISE EXCEPTION 'sale and payment authority differ' USING ERRCODE='23514';
  END IF;
  IF (current_sale->>'status'='paid') IS DISTINCT FROM (current_payment->>'status'='confirmed') OR (current_sale->>'status'='pending_payment') IS DISTINCT FROM (current_payment->>'status'='pending') OR (current_sale->>'status'='voided') IS DISTINCT FROM (current_payment->>'status'='voided') THEN RAISE EXCEPTION 'sale payment state mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS record_references ON records;
CREATE CONSTRAINT TRIGGER record_references AFTER INSERT OR UPDATE ON records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_record_references();
CREATE OR REPLACE FUNCTION protect_records() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'records must be archived, not deleted' USING ERRCODE='23514'; END IF;
 IF OLD.kind='movements' OR NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.line_id<>OLD.line_id OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'immutable record' USING ERRCODE='23514';
 END IF;
 IF OLD.kind='sales' AND (OLD.body-'status'-'payment') IS DISTINCT FROM (NEW.body-'status'-'payment') THEN
  RAISE EXCEPTION 'sale snapshot is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.kind='sales' AND OLD.body->>'status'<>'pending_payment' AND NOT (OLD.body->>'status'='paid' AND NEW.body->>'status'='voided') AND NEW.body->>'status'<>OLD.body->>'status' THEN
  RAISE EXCEPTION 'terminal sale is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.kind='payments' THEN
  IF (OLD.body-'status'-'gatewayReference'-'qrContent'-'expiresAt'-'confirmedAt'-'intentAttempts'-'nextIntentAt'-'intentError') IS DISTINCT FROM (NEW.body-'status'-'gatewayReference'-'qrContent'-'expiresAt'-'confirmedAt'-'intentAttempts'-'nextIntentAt'-'intentError') OR OLD.body->>'status'<>'pending' AND NOT (OLD.body->>'status'='confirmed' AND NEW.body->>'status'='voided') AND NEW.body->>'status'<>OLD.body->>'status' THEN
   RAISE EXCEPTION 'immutable payment identity or terminal status' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_records_trigger ON records;
CREATE TRIGGER protect_records_trigger BEFORE UPDATE OR DELETE ON records FOR EACH ROW EXECUTE FUNCTION protect_records();
CREATE OR REPLACE FUNCTION immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable sale item ledger' USING ERRCODE='23514'; END $$;
CREATE OR REPLACE FUNCTION validate_sale_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM assert_record_ref(NEW.sale_id::text,'sales',NEW.line_id);
 PERFORM assert_record_ref(NEW.staff_id::text,'staff',NEW.line_id);
 IF NOT EXISTS(SELECT 1 FROM records r CROSS JOIN LATERAL jsonb_array_elements(r.body->'items') i WHERE r.id=NEW.sale_id AND r.kind='sales' AND r.line_id=NEW.line_id AND i->>'id'=NEW.id::text AND i->>'itemId'=NEW.item_id::text AND i->>'itemType'=CASE NEW.item_kind WHEN 'products' THEN 'product' ELSE 'service' END AND i->>'displayName'=NEW.display_name AND (i->>'quantity')::integer=NEW.quantity AND (i->>'unitPrice')::bigint=NEW.unit_price AND (i->>'lineTotal')::bigint=NEW.line_total AND (i->>'staffId')::uuid IS NOT DISTINCT FROM NEW.staff_id) THEN RAISE EXCEPTION 'typed item differs from immutable sale snapshot' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS typed_sale_item ON sale_items;
CREATE CONSTRAINT TRIGGER typed_sale_item AFTER INSERT ON sale_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_sale_item();
DROP TRIGGER IF EXISTS immutable_items ON sale_items;
CREATE TRIGGER immutable_items BEFORE UPDATE OR DELETE ON sale_items FOR EACH ROW EXECUTE FUNCTION immutable_ledger();
CREATE OR REPLACE FUNCTION validate_inventory_product() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM records WHERE id=NEW.product_id AND kind='products') THEN RAISE EXCEPTION 'inventory requires product' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_product ON inventory;
CREATE TRIGGER inventory_product BEFORE INSERT OR UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION validate_inventory_product();
CREATE TABLE IF NOT EXISTS outbox_jobs(notification_id uuid PRIMARY KEY REFERENCES records(id),destination text NOT NULL,message text NOT NULL,status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),failures integer NOT NULL DEFAULT 0 CHECK(failures>=0),next_attempt_at timestamptz NOT NULL DEFAULT now(),claim_token uuid,lease_until timestamptz);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox_jobs(next_attempt_at,notification_id) WHERE status='queued';
CREATE OR REPLACE FUNCTION protect_outbox_payload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.destination IS DISTINCT FROM OLD.destination OR NEW.message IS DISTINCT FROM OLD.message OR NEW.notification_id IS DISTINCT FROM OLD.notification_id THEN RAISE EXCEPTION 'outbox payload immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS outbox_payload ON outbox_jobs;
CREATE TRIGGER outbox_payload BEFORE UPDATE OR DELETE ON outbox_jobs FOR EACH ROW EXECUTE FUNCTION protect_outbox_payload();
CREATE INDEX IF NOT EXISTS event_recovery ON payment_events((body->>'saleId'),created_at) WHERE body->>'outcome'='unresolved';
CREATE INDEX IF NOT EXISTS payment_events_outcome ON payment_events(line_id,(body->>'outcome'),created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_sale ON payment_events((body->>'saleId'),created_at DESC);
INSERT INTO schema_migrations(version) VALUES(1),(2),(3) ON CONFLICT DO NOTHING;

INSERT INTO business_lines(id,code,name,type) VALUES
 ('11111111-1111-4111-8111-111111111111','kedai-lia-287','Kedai Lia 287','food_beverage'),
 ('22222222-2222-4222-8222-222222222222','lia-salon','Lia Salon','salon')
ON CONFLICT (id) DO NOTHING;

-- Owner account (owner@owner.com / owner-password-123), created only while the users table is empty.
-- The owner adds cashiers/admins through POST /api/v1/users. Change this password before real use.
WITH new_owner AS (
 INSERT INTO users(id,name,email,password_hash,role,active)
 SELECT '00000000-0000-4000-8000-000000000001'::uuid,'Owner','owner@owner.com','$2a$12$jiNRf93BiCwJvdED9PQR1OsTGu3Fdi46HCTY7BmA4WRrpC/vzKYzG','owner',true
 WHERE NOT EXISTS (SELECT 1 FROM users)
 RETURNING id
)
INSERT INTO user_lines(user_id,line_id)
SELECT new_owner.id, line.id FROM new_owner
CROSS JOIN (VALUES ('11111111-1111-4111-8111-111111111111'::uuid),('22222222-2222-4222-8222-222222222222'::uuid)) AS line(id);
