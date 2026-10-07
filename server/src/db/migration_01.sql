ALTER TABLE resource_chunks ADD COLUMN IF NOT EXISTS heading TEXT;
ALTER TABLE resource_chunks ADD COLUMN IF NOT EXISTS resource_name TEXT;

-- Rename ai_logs to ai_audit_logs if it hasn't been renamed
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_logs') THEN
        ALTER TABLE ai_logs RENAME TO ai_audit_logs;
    END IF;
END $$;

ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS similarity_score real;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS top_k_scores real[];
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS chunk_ids uuid[];
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS prompt_hash TEXT;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS response_time_ms int;
ALTER TABLE ai_audit_logs ADD COLUMN IF NOT EXISTS provider TEXT;

-- Attendance MVP columns
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS verification_method VARCHAR(50) DEFAULT 'gps';
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS student_location_hash TEXT;
