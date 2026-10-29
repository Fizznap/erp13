-- ============================================================
-- Migration 07: Academic Results
-- Add academic_results table for student semester results
-- ============================================================

-- Academic results table stores student results for subjects in each semester
CREATE TABLE IF NOT EXISTS academic_results (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id              UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    academic_class_id       UUID NOT NULL REFERENCES academic_classes(id) ON DELETE CASCADE,
    
    -- Marks and evaluation
    internal_marks          NUMERIC(5,2) CHECK (internal_marks IS NULL OR (internal_marks >= 0 AND internal_marks <= 100)),
    external_marks          NUMERIC(5,2) CHECK (external_marks IS NULL OR (external_marks >= 0 AND external_marks <= 100)),
    total_marks             NUMERIC(5,2) CHECK (total_marks IS NULL OR (total_marks >= 0 AND total_marks <= 100)),
    
    -- Grade and status
    grade                   VARCHAR(2) CHECK (grade IN ('O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F', 'AB', 'XX')),
    grade_points            NUMERIC(3,2) CHECK (grade_points >= 0 AND grade_points <= 10),
    credits                 NUMERIC(3,1) NOT NULL DEFAULT 4.0 CHECK (credits >= 0 AND credits <= 10),
    status                  VARCHAR(20) DEFAULT 'published' CHECK (status IN ('draft', 'published', 'withheld')),
    
    -- Metadata
    exam_type               VARCHAR(50) DEFAULT 'regular' CHECK (exam_type IN ('regular', 'supplementary', 'backlog')),
    academic_year           INTEGER NOT NULL CHECK (academic_year >= 2000 AND academic_year <= 2100),
    remarks                 TEXT,
    is_synthetic            BOOLEAN DEFAULT false, -- Mark demo/synthetic data
    
    -- Audit
    created_at              TIMESTAMPTZ DEFAULT now(),
    created_by              UUID REFERENCES users(id), -- Faculty/admin who created
    updated_at              TIMESTAMPTZ DEFAULT now(),
    updated_by              UUID REFERENCES users(id), -- Last modified by
    
    -- Prevent duplicate results for same student-subject-class combination
    UNIQUE(student_id, subject_id, academic_class_id, exam_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_results_student ON academic_results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_subject ON academic_results(subject_id);
CREATE INDEX IF NOT EXISTS idx_results_class ON academic_results(academic_class_id);
CREATE INDEX IF NOT EXISTS idx_results_status ON academic_results(status);
CREATE INDEX IF NOT EXISTS idx_results_year ON academic_results(academic_year);
CREATE INDEX IF NOT EXISTS idx_results_synthetic ON academic_results(is_synthetic) WHERE is_synthetic = true;

-- Grade point mapping (reference)
-- O  = 10.0 (90-100%)
-- A+ = 9.0  (80-89%)
-- A  = 8.0  (70-79%)
-- B+ = 7.0  (60-69%)
-- B  = 6.0  (55-59%)
-- C  = 5.0  (50-54%)
-- P  = 4.0  (40-49%)
-- F  = 0.0  (<40% - Fail)
-- AB = 0.0  (Absent)
-- XX = 0.0  (Result withheld)

-- Function to calculate grade from marks
CREATE OR REPLACE FUNCTION calculate_grade_from_marks(marks NUMERIC)
RETURNS VARCHAR(2) AS $$
BEGIN
    IF marks IS NULL THEN RETURN NULL; END IF;
    IF marks >= 90 THEN RETURN 'O'; END IF;
    IF marks >= 80 THEN RETURN 'A+'; END IF;
    IF marks >= 70 THEN RETURN 'A'; END IF;
    IF marks >= 60 THEN RETURN 'B+'; END IF;
    IF marks >= 55 THEN RETURN 'B'; END IF;
    IF marks >= 50 THEN RETURN 'C'; END IF;
    IF marks >= 40 THEN RETURN 'P'; END IF;
    RETURN 'F';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get grade points from grade
CREATE OR REPLACE FUNCTION grade_to_points(grade_letter VARCHAR(2))
RETURNS NUMERIC(3,2) AS $$
BEGIN
    CASE grade_letter
        WHEN 'O'  THEN RETURN 10.0;
        WHEN 'A+' THEN RETURN 9.0;
        WHEN 'A'  THEN RETURN 8.0;
        WHEN 'B+' THEN RETURN 7.0;
        WHEN 'B'  THEN RETURN 6.0;
        WHEN 'C'  THEN RETURN 5.0;
        WHEN 'P'  THEN RETURN 4.0;
        WHEN 'F'  THEN RETURN 0.0;
        WHEN 'AB' THEN RETURN 0.0;
        WHEN 'XX' THEN RETURN 0.0;
        ELSE RETURN NULL;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-calculate grade and grade_points from total_marks
CREATE OR REPLACE FUNCTION update_result_grade()
RETURNS TRIGGER AS $$
BEGIN
    -- If total_marks is set and grade is not manually set
    IF NEW.total_marks IS NOT NULL AND NEW.grade IS NULL THEN
        NEW.grade := calculate_grade_from_marks(NEW.total_marks);
    END IF;
    
    -- Always sync grade_points with grade
    IF NEW.grade IS NOT NULL THEN
        NEW.grade_points := grade_to_points(NEW.grade);
    END IF;
    
    -- Update timestamp
    NEW.updated_at := now();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_result_grade ON academic_results;
CREATE TRIGGER trigger_update_result_grade
    BEFORE INSERT OR UPDATE ON academic_results
    FOR EACH ROW
    EXECUTE FUNCTION update_result_grade();

-- Comments
COMMENT ON TABLE academic_results IS 'Stores student academic results for subjects in each semester';
COMMENT ON COLUMN academic_results.is_synthetic IS 'True for demo/test data, helps distinguish from real student records';
COMMENT ON COLUMN academic_results.status IS 'draft: not yet published, published: visible to students, withheld: temporarily hidden';
COMMENT ON COLUMN academic_results.exam_type IS 'regular: normal semester exam, supplementary: retry exam, backlog: clearing previous semester';
