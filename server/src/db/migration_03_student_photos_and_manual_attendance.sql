-- Keep student photos in the existing persistent Postgres database. One small
-- image per user avoids relying on Render's ephemeral filesystem.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type VARCHAR(32) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  image_data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Faculty can explicitly save an absence when closing out a class roster.
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_check;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_status_check CHECK (status IN ('present', 'absent', 'rejected'));
