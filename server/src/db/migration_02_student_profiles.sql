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

-- Lab groups are independent of semester-specific lecture classes. They are
-- configured per branch, admission batch, and division (for example CSE / 2024-28 / B / B1).
CREATE TABLE IF NOT EXISTS academic_lab_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  batch_id UUID NOT NULL REFERENCES batches(id),
  division_id UUID NOT NULL REFERENCES divisions(id),
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, batch_id, division_id, name)
);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS academic_lab_group_id UUID REFERENCES academic_lab_groups(id);
ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS academic_lab_group_id UUID REFERENCES academic_lab_groups(id);

CREATE INDEX IF NOT EXISTS user_profiles_lab_group_idx
  ON user_profiles (academic_lab_group_id);
CREATE INDEX IF NOT EXISTS attendance_sessions_lab_group_idx
  ON attendance_sessions (academic_lab_group_id);

-- Canonical B.Tech branches used to classify UST roll-number prefixes.
-- Existing branch records and academic classes are left untouched.
INSERT INTO branches (name, code) VALUES
  ('B.Tech Artificial Intelligence and Machine Learning', 'BTECH-AIML'),
  ('B.Tech Computer Science and Engineering', 'BTECH-CSE'),
  ('B.Tech Cyber Security and Digital Forensics', 'BTECH-CYS')
ON CONFLICT (code) DO NOTHING;

-- USTU's 2024–28 B.Tech cohort and eight-semester structure from the supplied
-- seating arrangement and the university's published B.Tech course structure.
INSERT INTO batches (start_year, end_year) VALUES (2024, 2028)
ON CONFLICT (start_year, end_year) DO NOTHING;

INSERT INTO semesters (number)
SELECT generate_series(1, 8)
ON CONFLICT (number) DO NOTHING;

-- The supplied roster identifies the 2024–28 CSE B division. Seed its lecture
-- classes and B1/B2 lab groups; other branch/division combinations stay admin-configurable.
INSERT INTO divisions (name) VALUES ('B') ON CONFLICT (name) DO NOTHING;

INSERT INTO academic_classes (branch_id, batch_id, division_id, semester_id)
SELECT br.id, ba.id, d.id, s.id
FROM branches br
CROSS JOIN batches ba
CROSS JOIN divisions d
CROSS JOIN semesters s
WHERE br.code = 'BTECH-CSE' AND ba.start_year = 2024 AND ba.end_year = 2028
  AND d.name = 'B' AND s.number BETWEEN 1 AND 8
ON CONFLICT (branch_id, batch_id, division_id, semester_id) DO NOTHING;

INSERT INTO academic_lab_groups (branch_id, batch_id, division_id, name)
SELECT br.id, ba.id, d.id, lab_names.name
FROM branches br
CROSS JOIN batches ba
CROSS JOIN divisions d
CROSS JOIN (VALUES ('B1'), ('B2')) AS lab_names(name)
WHERE br.code = 'BTECH-CSE' AND ba.start_year = 2024 AND ba.end_year = 2028 AND d.name = 'B'
ON CONFLICT (branch_id, batch_id, division_id, name) DO NOTHING;
