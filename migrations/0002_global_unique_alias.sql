-- 0002_global_unique_alias: aliases are looked up with no user context on
-- /proxy/{alias}/..., so they must be unique across the whole table, not
-- just per-user.
--
-- NOTE: if any environment already has two rows sharing the same alias
-- (possible under the old per-user constraint), rename one of them by hand
-- before running this migration or it will fail on the new unique index.

ALTER TABLE api_keys DROP CONSTRAINT uq_api_keys_user_alias;
DROP INDEX ix_api_keys_alias;
CREATE UNIQUE INDEX ix_api_keys_alias ON api_keys (alias);
