alter table public.profiles add column if not exists branch text, add column if not exists division text;
grant update (full_name, phone, course, batch, college, college_email, avatar_url, branch, division) on public.profiles to authenticated;

alter table public.class_sections add column if not exists branch text, add column if not exists division text;

create table public.manual_attendance_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null,
  reason text not null check (length(reason) between 1 and 300),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  unique (session_id, student_id)
);
grant select on public.manual_attendance_requests to authenticated;
grant all on public.manual_attendance_requests to service_role;
alter table public.manual_attendance_requests enable row level security;
create policy "student sees own requests" on public.manual_attendance_requests for select to authenticated using (student_id = auth.uid());

create or replace function public.request_manual_attendance(_session_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into s from public.attendance_sessions where id = _session_id and started_at > now() - interval '12 hours';
  if s.id is null then raise exception 'Session not found or too old'; end if;
  if s.section_id is not null and not exists (select 1 from public.section_members where section_id = s.section_id and student_id = auth.uid()) then
    raise exception 'You are not enrolled in this class section'; end if;
  if exists (select 1 from public.attendance_records where session_id = s.id and student_id = auth.uid()) then
    raise exception 'You are already marked present'; end if;
  insert into public.manual_attendance_requests (session_id, student_id, reason) values (s.id, auth.uid(), left(trim(_reason), 300))
  on conflict (session_id, student_id) do update set reason = excluded.reason, status = 'pending', created_at = now();
end; $$;

create or replace function public.my_manual_requests()
returns table(id uuid, student_name text, student_no text, reason text, subject_name text, section_name text, started_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, coalesce(p.full_name, 'Student'), p.student_no, m.reason, sub.name, c.name, s.started_at, m.created_at
  from public.manual_attendance_requests m
  join public.attendance_sessions s on s.id = m.session_id and s.faculty_id = auth.uid()
  join public.subjects sub on sub.id = s.subject_id
  left join public.class_sections c on c.id = s.section_id
  left join public.profiles p on p.id = m.student_id
  where m.status = 'pending' order by m.created_at
$$;

create or replace function public.review_manual_request(_id uuid, _approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.manual_attendance_requests;
begin
  select r.* into m from public.manual_attendance_requests r join public.attendance_sessions s on s.id = r.session_id
  where r.id = _id and s.faculty_id = auth.uid();
  if m.id is null then raise exception 'Request not found'; end if;
  update public.manual_attendance_requests set status = case when _approve then 'approved' else 'rejected' end where id = _id;
  if _approve then
    insert into public.attendance_records (session_id, student_id) values (m.session_id, m.student_id) on conflict do nothing;
  end if;
end; $$;

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  section_id uuid references public.class_sections(id) on delete set null,
  title text not null check (length(title) between 1 and 120),
  kind text not null default 'Notes' check (kind in ('Notes','Slides','PDFs','Other')),
  file_path text not null,
  size_bytes bigint,
  uploaded_by uuid not null,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.resources to authenticated;
grant all on public.resources to service_role;
alter table public.resources enable row level security;
create policy "signed-in read resources" on public.resources for select to authenticated using (auth.uid() is not null);
create policy "faculty add resources" on public.resources for insert to authenticated with check (uploaded_by = auth.uid() and public.has_role(auth.uid(), 'faculty'));
create policy "faculty delete own resources" on public.resources for delete to authenticated using (uploaded_by = auth.uid());

revoke execute on function public.request_manual_attendance(uuid,text), public.my_manual_requests(), public.review_manual_request(uuid,boolean) from public, anon;
grant execute on function public.request_manual_attendance(uuid,text), public.my_manual_requests(), public.review_manual_request(uuid,boolean) to authenticated;

create policy "avatar read" on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy "avatar upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar update own folder" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar delete own folder" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "resources read signed-in" on storage.objects for select to authenticated using (bucket_id = 'resources');
create policy "resources faculty upload" on storage.objects for insert to authenticated with check (bucket_id = 'resources' and public.has_role(auth.uid(), 'faculty') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "resources faculty delete own" on storage.objects for delete to authenticated using (bucket_id = 'resources' and (storage.foldername(name))[1] = auth.uid()::text);