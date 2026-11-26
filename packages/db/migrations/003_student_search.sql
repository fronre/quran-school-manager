-- 003_student_search: normalized search key for people (Arabic-aware search, duplicate check BR-023) and list indexes.
-- search_key is maintained by the application (domain normalizeName); it is never shown to users.
ALTER TABLE person ADD COLUMN search_key TEXT;
CREATE INDEX ix_person_search ON person(tenant_id, search_key) WHERE deleted_at IS NULL;
CREATE INDEX ix_student_branch_status ON student(branch_id, status) WHERE deleted_at IS NULL;
