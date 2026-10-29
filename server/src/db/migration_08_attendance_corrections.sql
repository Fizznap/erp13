-- Migration 08: Attendance Corrections Audit Trail
-- Adds audit trail columns to attendance_records for tracking historical corrections

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS original_status VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_attendance_records_corrected_at ON attendance_records (corrected_at) WHERE corrected_at IS NOT NULL;
