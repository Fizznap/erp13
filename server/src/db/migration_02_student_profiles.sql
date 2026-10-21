-- Additive student onboarding and Google identity storage.
-- Existing users and related academic records are preserved.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_picture_url TEXT,
  preferred_name VARCHAR(80),
  college_id VARCHAR(40),
  program VARCHAR(160),
  roll_number VARCHAR(40),
  year_of_study SMALLINT,
  admission_year SMALLINT,
  expected_graduation_year SMALLINT,
  phone VARCHAR(32),
  bio VARCHAR(500),
  skills TEXT[] NOT NULL DEFAULT '{}',
  interests TEXT[] NOT NULL DEFAULT '{}',
  achievements TEXT[] NOT NULL DEFAULT '{}',
  linkedin_url TEXT,
  github_url TEXT,
  portfolio_url TEXT,
  registration_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_college_id_unique
  ON user_profiles (upper(btrim(college_id)))
  WHERE college_id IS NOT NULL AND btrim(college_id) <> '';

CREATE TABLE IF NOT EXISTS user_auth_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('google')),
  provider_subject VARCHAR(255) NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_auth_identities_user_idx
  ON user_auth_identities (user_id);
