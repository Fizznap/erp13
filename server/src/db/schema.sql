-- ============================================================
-- Snippet Database Schema
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL CHECK (role IN ('student', 'faculty', 'admin')),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SUBJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    code            VARCHAR(50) UNIQUE NOT NULL,
    description     TEXT,
    faculty_id      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SUBJECT ENROLLMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS subject_enrollments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id      UUID NOT NULL REFERENCES users(id),
    subject_id      UUID NOT NULL REFERENCES subjects(id),
    enrolled_at     TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, subject_id)
);

-- ============================================================
-- RESOURCES (uploaded PDFs)
-- ============================================================
CREATE TABLE IF NOT EXISTS resources (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id      UUID NOT NULL REFERENCES subjects(id),
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    filename        VARCHAR(255) NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    file_path       VARCHAR(500) NOT NULL,
    file_size       INTEGER NOT NULL,
    mime_type       VARCHAR(100) DEFAULT 'application/pdf',
    status          VARCHAR(20) DEFAULT 'queued'
                        CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
    summary         TEXT,
    key_topics      JSONB DEFAULT '[]',
    bullet_points   JSONB DEFAULT '[]',
    page_count      INTEGER,
    chunk_count     INTEGER DEFAULT 0,
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

-- ============================================================
-- RESOURCE CHUNKS (text segments with embeddings)
-- ============================================================
CREATE TABLE IF NOT EXISTS resource_chunks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    content         TEXT NOT NULL,
    token_count     INTEGER,
    page_number     INTEGER,
    heading         TEXT,
    resource_name   TEXT,
    embedding       vector(768),
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_resource ON resource_chunks(resource_id);

-- ============================================================
-- ATTENDANCE SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id      UUID NOT NULL REFERENCES subjects(id),
    faculty_id      UUID NOT NULL REFERENCES users(id),
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    radius_meters   INTEGER DEFAULT 50,
    active_nonce    VARCHAR(10),
    nonce_expires   TIMESTAMPTZ,
    is_active       BOOLEAN DEFAULT true,
    started_at      TIMESTAMPTZ DEFAULT now(),
    ended_at        TIMESTAMPTZ
);

-- ============================================================
-- ATTENDANCE RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL REFERENCES attendance_sessions(id),
    student_id      UUID NOT NULL REFERENCES users(id),
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL,
    verification_method VARCHAR(50) DEFAULT 'gps',
    device_id       TEXT,
    student_location_hash TEXT,
    status          VARCHAR(20) DEFAULT 'present'
                        CHECK (status IN ('present', 'rejected')),
    rejection_reason VARCHAR(255),
    marked_at       TIMESTAMPTZ DEFAULT now(),
    UNIQUE(session_id, student_id)
);

-- ============================================================
-- AI AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    subject_id      UUID REFERENCES subjects(id),
    query           TEXT NOT NULL,
    answer          TEXT,
    chunks_used     JSONB DEFAULT '[]',
    chunk_ids       UUID[] DEFAULT '{}',
    model_used      VARCHAR(100),
    provider        VARCHAR(100),
    prompt_hash     TEXT,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    latency_ms      INTEGER,
    response_time_ms INTEGER,
    was_found       BOOLEAN DEFAULT true,
    similarity_score REAL,
    top_k_scores    REAL[],
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_user ON ai_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_audit_logs_subject ON ai_audit_logs(subject_id);
