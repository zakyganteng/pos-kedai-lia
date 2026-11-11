DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM records WHERE kind='payments' AND body->>'provider'='borderpay') THEN
  RAISE EXCEPTION 'cannot remove Borderpay support while Borderpay payment records exist';
 END IF;
END $$;
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
DELETE FROM schema_migrations WHERE version=6;
