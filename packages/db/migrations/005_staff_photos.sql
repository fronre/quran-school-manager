-- 005_staff_photos: teachers/staff profiles per branch, photos with a recorded consent (BR-022), and consent records.
-- Photos are stored INSIDE the database as small JPEG thumbnails, so backups and restores carry them automatically.

ALTER TABLE staff_member ADD COLUMN branch_id TEXT REFERENCES branch(id);
ALTER TABLE staff_member ADD COLUMN position TEXT NOT NULL DEFAULT 'teacher' CHECK(position IN ('teacher','supervisor','administrator','other'));
ALTER TABLE staff_member ADD COLUMN archived_at TEXT;
ALTER TABLE staff_member ADD COLUMN archive_reason TEXT;
-- The person who signs in (the shared login account) is not a teacher: keep it out of the teachers list.
UPDATE staff_member SET position = 'administrator', version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = 'system:migration-005'
 WHERE id IN (SELECT staff_member_id FROM user_account);
CREATE INDEX ix_staff_branch ON staff_member(branch_id, position) WHERE deleted_at IS NULL;

CREATE TABLE consent_record (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  person_id TEXT NOT NULL REFERENCES person(id),
  purpose TEXT NOT NULL CHECK(purpose IN ('photo','portal','document')),
  given_by TEXT NOT NULL CHECK(length(trim(given_by)) > 0),  -- who consented, as typed ("ولي الأمر", "صاحب الصورة")
  granted_at TEXT NOT NULL CHECK(granted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  recorded_by TEXT NOT NULL,
  withdrawn_at TEXT CHECK(withdrawn_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  withdrawn_by TEXT,
  CHECK((withdrawn_at IS NULL) = (withdrawn_by IS NULL))
) STRICT;
CREATE INDEX ix_consent_person ON consent_record(person_id, purpose);
CREATE TRIGGER trg_consent_no_delete BEFORE DELETE ON consent_record BEGIN SELECT RAISE(ABORT, 'consent_record is append-only'); END;
-- Only a first withdrawal may change a row.
CREATE TRIGGER trg_consent_immutable BEFORE UPDATE ON consent_record
WHEN OLD.withdrawn_at IS NOT NULL OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.person_id <> OLD.person_id OR NEW.purpose <> OLD.purpose OR NEW.given_by <> OLD.given_by OR NEW.granted_at <> OLD.granted_at OR NEW.recorded_by <> OLD.recorded_by
BEGIN SELECT RAISE(ABORT, 'consent_record: only a first withdrawal is allowed'); END;

CREATE TABLE person_photo (
  person_id TEXT NOT NULL PRIMARY KEY REFERENCES person(id),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  mime TEXT NOT NULL CHECK(mime = 'image/jpeg'),
  width INTEGER NOT NULL CHECK(width BETWEEN 16 AND 2048),
  height INTEGER NOT NULL CHECK(height BETWEEN 16 AND 2048),
  bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 100 AND 1048576),
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  consent_id TEXT NOT NULL REFERENCES consent_record(id),  -- a photo cannot exist without a recorded consent
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_by TEXT NOT NULL
) STRICT;
