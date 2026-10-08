
CREATE OR REPLACE FUNCTION public.can_browse_catalog(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    has_role(_uid,'faculty') OR has_role(_uid,'admin')
    OR EXISTS (SELECT 1 FROM profiles WHERE id = _uid AND division_id IS NULL)
  )
$$;
CREATE OR REPLACE FUNCTION public.my_division_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT division_id FROM profiles WHERE id = auth.uid()
$$;

DROP POLICY "read divisions" ON public.divisions;
CREATE POLICY "read divisions" ON public.divisions FOR SELECT TO authenticated
  USING (public.can_browse_catalog(auth.uid()) OR id = public.my_division_id());
DROP POLICY "read batches" ON public.batches;
CREATE POLICY "read batches" ON public.batches FOR SELECT TO authenticated
  USING (public.can_browse_catalog(auth.uid()) OR EXISTS (SELECT 1 FROM public.divisions d WHERE d.batch_id = batches.id AND d.id = public.my_division_id()));
DROP POLICY "read branches" ON public.branches;
CREATE POLICY "read branches" ON public.branches FOR SELECT TO authenticated
  USING (public.can_browse_catalog(auth.uid()) OR EXISTS (SELECT 1 FROM public.divisions d WHERE d.branch_id = branches.id AND d.id = public.my_division_id()));
DROP POLICY "Signed-in users view subjects" ON public.subjects;
CREATE POLICY "view subjects" ON public.subjects FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'faculty') OR public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.class_sections c WHERE c.subject_id = subjects.id AND public.is_section_member(c.id, auth.uid())));

-- Avatars: own files, admins, or the photo of a verified student (shown on the public ID check page)
CREATE OR REPLACE FUNCTION public.is_public_avatar(_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE avatar_url = 'sb:' || _name AND student_no IS NOT NULL)
$$;
DROP POLICY "avatar read" ON storage.objects;
CREATE POLICY "avatar read" ON storage.objects FOR SELECT TO anon, authenticated USING (
  bucket_id = 'avatars' AND (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    OR public.has_role((select auth.uid()), 'admin')
    OR public.is_public_avatar(name)
  )
);

-- Resources: uploader, admin, or a member of the resource's class
CREATE OR REPLACE FUNCTION public.can_read_resource_file(_name text, _uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM resources r WHERE r.file_path = _name AND (
      r.uploaded_by = _uid OR has_role(_uid,'admin')
      OR (r.section_id IS NOT NULL AND is_section_member(r.section_id, _uid))
    )
  )
$$;
DROP POLICY "resources read authorized" ON storage.objects;
CREATE POLICY "resources read authorized" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'resources' AND public.can_read_resource_file(name, (select auth.uid()))
);
