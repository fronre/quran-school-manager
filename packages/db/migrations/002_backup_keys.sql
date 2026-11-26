-- 002_backup_keys: backup log (append-only) and recovery-key verifier (SEC-014, SEC-041, SEC-043, SEC-044, BR-043, BR-044).
-- No key material is stored here, only a verifier of the recovery key.

CREATE TABLE backup_log (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  kind TEXT NOT NULL CHECK(kind IN ('manual','scheduled','pre_migration','pre_import','pre_restore','restore')),
  destination TEXT NOT NULL,
  started_at TEXT NOT NULL CHECK(started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  finished_at TEXT CHECK(finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  checksum TEXT,
  error TEXT
) STRICT;
CREATE TRIGGER trg_backup_log_no_update BEFORE UPDATE ON backup_log BEGIN SELECT RAISE(ABORT, 'backup_log is append-only'); END;
CREATE TRIGGER trg_backup_log_no_delete BEFORE DELETE ON backup_log BEGIN SELECT RAISE(ABORT, 'backup_log is append-only'); END;

CREATE TABLE key_material (
  tenant_id TEXT NOT NULL PRIMARY KEY REFERENCES association(id),
  recovery_verifier TEXT NOT NULL CHECK(length(recovery_verifier) = 64),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  acknowledged_at TEXT CHECK(acknowledged_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER trg_key_material_no_delete BEFORE DELETE ON key_material BEGIN SELECT RAISE(ABORT, 'key_material cannot be deleted'); END;
-- Only the acknowledgement may change; the verifier is fixed once created (a new key means a deliberate migration).
CREATE TRIGGER trg_key_material_update BEFORE UPDATE ON key_material
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.recovery_verifier <> OLD.recovery_verifier OR NEW.created_at <> OLD.created_at OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS NOT OLD.acknowledged_at)
BEGIN SELECT RAISE(ABORT, 'key_material: only a first acknowledgement may be recorded'); END;
