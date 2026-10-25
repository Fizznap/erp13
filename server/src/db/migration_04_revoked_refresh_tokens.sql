-- Revoked refresh tokens for logout / session invalidation.
-- Stores SHA-256 hashes of refresh tokens that have been revoked
-- before their natural expiry. Checked during /auth/refresh so a
-- revoked refresh token cannot obtain new access tokens.
--
-- Rollback: DROP TABLE IF EXISTS revoked_refresh_tokens;
CREATE TABLE IF NOT EXISTS revoked_refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS revoked_refresh_tokens_user_idx
  ON revoked_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS revoked_refresh_tokens_hash_idx
  ON revoked_refresh_tokens (token_hash);
