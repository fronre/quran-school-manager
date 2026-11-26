-- 004_fees: monthly fees (OD-034, OD-035, OD-036). Money is whole dinars. Months are "YYYY-MM".
-- A payment is never edited or deleted: a mistake is cancelled with a reason (audited) and re-entered (OD-035 f).

CREATE TABLE fee_rate (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  effective_from TEXT NOT NULL CHECK(effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(effective_from, 6, 2) BETWEEN '01' AND '12'),
  amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 1000000),
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_fee_rate_month ON fee_rate(tenant_id, effective_from) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_fee_rate_no_delete BEFORE DELETE ON fee_rate BEGIN SELECT RAISE(ABORT, 'fee_rate: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_fee_rate_envelope BEFORE UPDATE ON fee_rate
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'fee_rate: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;

CREATE TABLE fee_free_month (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  updated_at TEXT NOT NULL CHECK(updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  academic_year_id TEXT NOT NULL REFERENCES academic_year(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12'),
  reason TEXT,
  CHECK((deleted_at IS NULL) = (deleted_by IS NULL))
) STRICT;
CREATE UNIQUE INDEX ux_fee_free_month ON fee_free_month(academic_year_id, month) WHERE deleted_at IS NULL;
CREATE TRIGGER trg_fee_free_month_no_delete BEFORE DELETE ON fee_free_month BEGIN SELECT RAISE(ABORT, 'fee_free_month: physical delete not allowed, use a tombstone'); END;
CREATE TRIGGER trg_fee_free_month_envelope BEFORE UPDATE ON fee_free_month
WHEN NEW.tenant_id <> OLD.tenant_id OR NEW.id <> OLD.id OR NEW.created_at <> OLD.created_at OR NEW.created_by <> OLD.created_by OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'fee_free_month: envelope violation (tenant, id and created_* are immutable; version must increase by 1)'); END;

CREATE TABLE payment (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id) = 36 AND id = lower(id)),
  tenant_id TEXT NOT NULL REFERENCES association(id),
  receipt_no INTEGER NOT NULL CHECK(receipt_no >= 1),
  academic_year_id TEXT NOT NULL REFERENCES academic_year(id),
  student_id TEXT NOT NULL REFERENCES student(id),
  month TEXT NOT NULL CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12'),
  amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= 1000000),
  paid_on TEXT NOT NULL CHECK(paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  collector_name TEXT NOT NULL CHECK(length(trim(collector_name)) > 0),
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK(created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  cancelled_at TEXT CHECK(cancelled_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  cancelled_by TEXT,
  cancel_reason TEXT,
  CHECK((cancelled_at IS NULL) = (cancelled_by IS NULL) AND (cancelled_at IS NULL) = (cancel_reason IS NULL)),
  CHECK(cancel_reason IS NULL OR length(trim(cancel_reason)) > 0)
) STRICT;
CREATE UNIQUE INDEX ux_payment_receipt ON payment(academic_year_id, receipt_no);                 -- sequential receipts per year (OD-035 e)
CREATE UNIQUE INDEX ux_payment_month ON payment(student_id, month) WHERE cancelled_at IS NULL;   -- one live payment per student per month (OD-034)
CREATE INDEX ix_payment_year_month ON payment(academic_year_id, month);
CREATE TRIGGER trg_payment_no_delete BEFORE DELETE ON payment BEGIN SELECT RAISE(ABORT, 'payment is append-only: cancel it with a reason instead'); END;
-- Only a first cancellation may change a row; every other column is immutable, and a cancelled payment is final.
CREATE TRIGGER trg_payment_immutable BEFORE UPDATE ON payment
WHEN OLD.cancelled_at IS NOT NULL OR NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.receipt_no <> OLD.receipt_no OR NEW.academic_year_id <> OLD.academic_year_id
  OR NEW.student_id <> OLD.student_id OR NEW.month <> OLD.month OR NEW.amount <> OLD.amount OR NEW.paid_on <> OLD.paid_on OR NEW.collector_name <> OLD.collector_name
  OR NEW.recorded_by <> OLD.recorded_by OR NEW.created_at <> OLD.created_at
BEGIN SELECT RAISE(ABORT, 'payment is immutable: only a first cancellation (with a reason) is allowed'); END;
-- The paid month must lie inside the academic year the receipt belongs to.
CREATE TRIGGER trg_payment_month_in_year BEFORE INSERT ON payment
WHEN NOT EXISTS (SELECT 1 FROM academic_year y WHERE y.id = NEW.academic_year_id AND NEW.month >= substr(y.start_date, 1, 7) AND NEW.month <= substr(y.end_date, 1, 7))
BEGIN SELECT RAISE(ABORT, 'payment month is outside the academic year'); END;

-- Protects the whole finance section (OD-036 option A). Only a hash is stored.
CREATE TABLE finance_access (
  tenant_id TEXT NOT NULL PRIMARY KEY REFERENCES association(id),
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
  locked_until TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
) STRICT;
CREATE TRIGGER trg_finance_access_no_delete BEFORE DELETE ON finance_access BEGIN SELECT RAISE(ABORT, 'finance_access cannot be deleted'); END;
