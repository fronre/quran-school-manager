-- 012_guardian_access: sign-in codes for the guardian app (OD-015: in-person one-time code; prototype). Only a hash of the code is stored.
-- One live code per guardian; issuing a new one revokes the old. Wrong tries are counted per guardian and lock sign-in for a while.
CREATE TABLE guardian_access (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  guardian_id TEXT NOT NULL REFERENCES guardian(id),
  code_hash TEXT NOT NULL CHECK(length(code_hash) = 64),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_count >= 0),
  locked_until TEXT,
  last_login_at TEXT,
  CHECK((revoked_at IS NULL) = (revoked_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_guardian_access_live ON guardian_access(guardian_id) WHERE revoked_at IS NULL;
CREATE TRIGGER trg_guardian_access_no_delete BEFORE DELETE ON guardian_access BEGIN SELECT RAISE(ABORT, 'guardian_access: physical delete not allowed, revoke it'); END;
