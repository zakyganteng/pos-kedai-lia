-- Reapply after schema.sql, which replaces protect_records on every embedded migration.
CREATE OR REPLACE FUNCTION protect_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE late_paid boolean;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'records must be archived, not deleted' USING ERRCODE='23514'; END IF;
 IF OLD.kind='movements' OR NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.line_id<>OLD.line_id OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'immutable record' USING ERRCODE='23514';
 END IF;
 IF OLD.kind='sales' AND (OLD.body-'status'-'payment') IS DISTINCT FROM (NEW.body-'status'-'payment') THEN
  RAISE EXCEPTION 'sale snapshot is immutable' USING ERRCODE='23514';
 END IF;
 late_paid:=OLD.kind='sales' AND OLD.body->'payment'->>'provider'='borderpay' AND OLD.body->'payment'->>'status'='expired' AND NEW.body->'payment'->>'status'='confirmed' AND OLD.body->>'status'='cancelled' AND NEW.body->>'status'='paid';
 IF OLD.kind='sales' AND OLD.body->>'status'<>'pending_payment' AND NOT (OLD.body->>'status'='paid' AND NEW.body->>'status'='voided') AND NOT coalesce(late_paid,false) AND NEW.body->>'status'<>OLD.body->>'status' THEN
  RAISE EXCEPTION 'terminal sale is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.kind='payments' THEN
  late_paid:=OLD.body->>'provider'='borderpay' AND OLD.body->>'status'='expired' AND NEW.body->>'status'='confirmed';
  IF (OLD.body-'status'-'gatewayReference'-'qrContent'-'expiresAt'-'confirmedAt'-'intentAttempts'-'nextIntentAt'-'intentError'-'gatewayMode'-'customerPays'-'nextStatusAt'-'statusError') IS DISTINCT FROM (NEW.body-'status'-'gatewayReference'-'qrContent'-'expiresAt'-'confirmedAt'-'intentAttempts'-'nextIntentAt'-'intentError'-'gatewayMode'-'customerPays'-'nextStatusAt'-'statusError')
   OR OLD.body->>'gatewayMode' IS NOT NULL AND OLD.body->>'gatewayMode' IS DISTINCT FROM NEW.body->>'gatewayMode'
   OR OLD.body->>'customerPays' IS NOT NULL AND OLD.body->>'customerPays' IS DISTINCT FROM NEW.body->>'customerPays'
   OR OLD.body->>'status'<>'pending' AND NOT (OLD.body->>'status'='confirmed' AND NEW.body->>'status'='voided') AND NOT coalesce(late_paid,false) AND NEW.body->>'status'<>OLD.body->>'status' THEN
   RAISE EXCEPTION 'immutable payment identity or terminal status' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
