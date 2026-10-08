
CREATE OR REPLACE FUNCTION public.is_section_member(_section_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM section_members WHERE section_id = _section_id AND student_id = _user_id)
$$;
DROP POLICY "students see own classes" ON public.class_sections;
CREATE POLICY "students see own classes" ON public.class_sections FOR SELECT TO authenticated USING (public.is_section_member(id, auth.uid()));
DROP POLICY "authorized read resources" ON public.resources;
CREATE POLICY "authorized read resources" ON public.resources FOR SELECT TO authenticated USING (
  uploaded_by = auth.uid() OR public.has_role(auth.uid(),'admin')
  OR (section_id IS NOT NULL AND public.is_section_member(section_id, auth.uid()))
);
