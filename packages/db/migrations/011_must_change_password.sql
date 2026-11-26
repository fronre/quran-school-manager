-- 011_must_change_password: a fresh installation starts with the standard account admin / admin; the program forces a new password at the first sign-in (OD-050).
ALTER TABLE user_account ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
