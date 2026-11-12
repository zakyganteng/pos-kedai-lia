-- records cannot be deleted (protect_records), so roll back by archiving the seeded menu.
UPDATE records SET body=body||jsonb_build_object('active',false,'updatedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 WHERE kind='products' AND line_id='11111111-1111-4111-8111-111111111111'
  AND (body->>'sku' LIKE 'FOOD-%' OR body->>'sku' LIKE 'DRINK-%') AND (body->>'active')::boolean IS TRUE;
DELETE FROM schema_migrations WHERE version=5;
