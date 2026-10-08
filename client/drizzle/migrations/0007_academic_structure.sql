
CREATE TABLE public.branches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), start_year int NOT NULL, end_year int NOT NULL, label text GENERATED ALWAYS AS (start_year::text || '–' || end_year::text) STORED, UNIQUE (start_year, end_year));
CREATE TABLE public.divisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE, batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE, name text NOT NULL, UNIQUE (branch_id, batch_id, name));
CREATE TABLE public.face_enrollments (user_id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'pending_provider', provider text, template_ref text, consent_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

GRANT SELECT ON public.branches, public.batches, public.divisions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.branches, public.batches, public.divisions TO authenticated;
GRANT SELECT ON public.face_enrollments TO authenticated;
GRANT ALL ON public.branches, public.batches, public.divisions, public.face_enrollments TO service_role;

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin branches" ON public.branches FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "read batches" ON public.batches FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin batches" ON public.batches FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "read divisions" ON public.divisions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin divisions" ON public.divisions FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "own face enrollment" ON public.face_enrollments FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Subjects: admins manage
GRANT INSERT, UPDATE, DELETE ON public.subjects TO authenticated;
CREATE POLICY "admin manage subjects" ON public.subjects FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Student academic identity
ALTER TABLE public.profiles ADD COLUMN division_id uuid REFERENCES public.divisions(id);
-- Faculty class = subject + division + semester
ALTER TABLE public.class_sections ADD COLUMN division_id uuid REFERENCES public.divisions(id), ADD COLUMN semester int;

-- Lock academic identity: users may only edit personal fields
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, college_email, college, course, avatar_url) ON public.profiles TO authenticated;

-- Admin can read all profiles (for academic management)
CREATE POLICY "admins view profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Auto-enroll: keep section_members in sync with division
CREATE OR REPLACE FUNCTION public.sync_section_division() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.division_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.division_id IS DISTINCT FROM OLD.division_id) THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM section_members WHERE section_id = NEW.id; END IF;
    INSERT INTO section_members(section_id, student_id)
      SELECT NEW.id, p.id FROM profiles p WHERE p.division_id = NEW.division_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER class_sections_sync AFTER INSERT OR UPDATE OF division_id ON public.class_sections FOR EACH ROW EXECUTE FUNCTION public.sync_section_division();

CREATE OR REPLACE FUNCTION public.sync_student_division() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.division_id IS DISTINCT FROM OLD.division_id THEN
    DELETE FROM section_members m USING class_sections c
      WHERE m.section_id = c.id AND m.student_id = NEW.id AND c.division_id IS NOT NULL;
    IF NEW.division_id IS NOT NULL THEN
      INSERT INTO section_members(section_id, student_id)
        SELECT c.id, NEW.id FROM class_sections c WHERE c.division_id = NEW.division_id
        ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_division_sync AFTER UPDATE OF division_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_student_division();

-- One-time student registration (identity can't be changed afterwards except by admin)
CREATE OR REPLACE FUNCTION public.complete_registration(_full_name text, _student_no text, _division_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND division_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Your class is already set. Ask an admin to change it.'; END IF;
  _student_no := upper(trim(_student_no));
  IF length(_student_no) < 4 OR length(_student_no) > 40 THEN RAISE EXCEPTION 'Enter a valid student ID'; END IF;
  IF length(trim(_full_name)) < 2 THEN RAISE EXCEPTION 'Enter your full name'; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE student_no = _student_no AND id <> auth.uid()) THEN
    RAISE EXCEPTION 'This student ID is already registered'; END IF;
  SELECT dv.name, b.code, ba.label INTO d FROM divisions dv JOIN branches b ON b.id = dv.branch_id JOIN batches ba ON ba.id = dv.batch_id WHERE dv.id = _division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose a valid division'; END IF;
  UPDATE profiles SET full_name = left(trim(_full_name), 80),
    student_no = COALESCE(student_no, _student_no),
    division_id = _division_id, branch = d.code, division = d.name, batch = d.label
  WHERE id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_student_division(_user_id uuid, _division_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d record;
BEGIN
  IF NOT has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admins only'; END IF;
  SELECT dv.name, b.code, ba.label INTO d FROM divisions dv JOIN branches b ON b.id = dv.branch_id JOIN batches ba ON ba.id = dv.batch_id WHERE dv.id = _division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid division'; END IF;
  UPDATE profiles SET division_id = _division_id, branch = d.code, division = d.name, batch = d.label WHERE id = _user_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_students() RETURNS TABLE(id uuid, full_name text, email text, student_no text, division_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, u.email::text, p.student_no, p.division_id
  FROM profiles p JOIN auth.users u ON u.id = p.id
  WHERE has_role(auth.uid(), 'admin')
    AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = p.id AND r.role IN ('faculty','admin'))
  ORDER BY p.full_name;
$$;

-- Faculty: class must be tied to a division and faculty must have the role
DROP POLICY "faculty manage own sections" ON public.class_sections;
CREATE POLICY "faculty manage own sections" ON public.class_sections FOR ALL TO authenticated
  USING (faculty_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (faculty_id = auth.uid() AND public.has_role(auth.uid(),'faculty'));
CREATE POLICY "students see own classes" ON public.class_sections FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM section_members m WHERE m.section_id = class_sections.id AND m.student_id = auth.uid()));

-- Resource segregation
DROP POLICY "signed-in read resources" ON public.resources;
CREATE POLICY "authorized read resources" ON public.resources FOR SELECT TO authenticated USING (
  uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin')
  OR (section_id IS NOT NULL AND EXISTS (SELECT 1 FROM section_members m WHERE m.section_id = resources.section_id AND m.student_id = auth.uid()))
);
DROP POLICY "faculty add resources" ON public.resources;
CREATE POLICY "faculty add resources" ON public.resources FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid() AND public.has_role(auth.uid(),'faculty') AND section_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM class_sections c WHERE c.id = section_id AND c.faculty_id = auth.uid() AND c.subject_id = resources.subject_id)
);
DROP POLICY "resources read signed-in" ON storage.objects;
CREATE POLICY "resources read authorized" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'resources' AND EXISTS (SELECT 1 FROM public.resources r WHERE r.file_path = storage.objects.name)
);

-- Face ID: enrollment metadata only (no raw images stored). Matching provider is plugged in later.
CREATE OR REPLACE FUNCTION public.request_face_enrollment() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  INSERT INTO face_enrollments(user_id, status) VALUES (auth.uid(), 'pending_provider')
  ON CONFLICT (user_id) DO UPDATE SET status = 'pending_provider', updated_at = now(), consent_at = now();
  RETURN 'pending_provider';
END $$;
CREATE OR REPLACE FUNCTION public.remove_face_enrollment() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM face_enrollments WHERE user_id = auth.uid();
$$;
