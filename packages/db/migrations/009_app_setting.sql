-- 009_app_setting: small association-level settings (here: the memorization evaluation scale and pass mark, OD-021 / OD-024). One row per key.
CREATE TABLE app_setting (
  tenant_id TEXT NOT NULL REFERENCES association(id),
  key TEXT NOT NULL CHECK(length(key) BETWEEN 1 AND 100),
  value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_by TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
) STRICT;
CREATE TRIGGER trg_app_setting_no_delete BEFORE DELETE ON app_setting BEGIN SELECT RAISE(ABORT, 'app_setting: physical delete not allowed'); END;
