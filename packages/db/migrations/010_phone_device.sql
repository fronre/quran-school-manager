-- 010_phone_device: phones paired with the desktop program for the Wi-Fi phone page (OD-049). Only a hash of the device token is stored.
-- A device is limited to the branches chosen when its pairing code was made, and can be revoked at any time.
CREATE TABLE phone_device (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  name TEXT NOT NULL CHECK(length(trim(name)) > 0),
  token_hash TEXT NOT NULL CHECK(length(token_hash) = 64),
  branch_ids TEXT NOT NULL,                       -- JSON array of branch ids
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  last_seen_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK((revoked_at IS NULL) = (revoked_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_phone_device_token ON phone_device(token_hash);
CREATE TRIGGER trg_phone_device_no_delete BEFORE DELETE ON phone_device BEGIN SELECT RAISE(ABORT, 'phone_device: physical delete not allowed, revoke it'); END;
-- Once revoked, always revoked.
CREATE TRIGGER trg_phone_device_stay_revoked BEFORE UPDATE ON phone_device WHEN OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS NOT OLD.revoked_at OR NEW.token_hash <> OLD.token_hash)
BEGIN SELECT RAISE(ABORT, 'phone_device: a revoked device cannot be changed'); END;
