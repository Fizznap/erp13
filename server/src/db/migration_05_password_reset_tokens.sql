-- Password reset tokens for forgot password flow.
-- Stores SHA-256 hashes of one-time reset tokens with expiry.
--
-- Rollback:
--   ALTER TABLE users DROP COLUMN IF EXISTS password_reset_token_hash;
--   ALTER TABLE users DROP COLUMN IF EXISTS password_reset_expires_at;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token_hash CHAR(64);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
