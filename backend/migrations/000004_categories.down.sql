-- Reverses the additive category schema only. Category records themselves are left in place:
-- records are archived, never deleted, and the protect_records trigger enforces that.
DROP TRIGGER IF EXISTS category_references ON records;
DROP FUNCTION IF EXISTS validate_category_rules CASCADE;
DROP INDEX IF EXISTS category_names;
DROP INDEX IF EXISTS products_by_category;
DELETE FROM schema_migrations WHERE version=4;
