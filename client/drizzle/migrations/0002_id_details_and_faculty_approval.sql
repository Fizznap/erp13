alter type public.app_role add value if not exists 'admin';

alter table public.profiles
  add column if not exists student_no text unique,
  add column if not exists college text,
  add column if not exists course text,
  add column if not exists batch text,
  add column if not exists phone text,
  add column if not exists avatar_url text;

create table public.faculty_requests (
  user_id uuid primary key,
  department text,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
grant select, insert, update on public.faculty_requests to authenticated;
grant all on public.faculty_requests to service_role;
alter table public.faculty_requests enable row level security;
create policy "see own request" on public.faculty_requests for select to authenticated using (user_id = auth.uid());
create policy "create own request" on public.faculty_requests for insert to authenticated with check (user_id = auth.uid() and status = 'pending');
create policy "resubmit own request" on public.faculty_requests for update to authenticated
  using (user_id = auth.uid() and status <> 'approved') with check (user_id = auth.uid() and status = 'pending');

create or replace function public.list_faculty_requests()
returns table(user_id uuid, full_name text, email text, department text, note text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin'::text::public.app_role) then raise exception 'Admins only'; end if;
  return query select r.user_id, p.full_name, u.email::text, r.department, r.note, r.status, r.created_at
    from public.faculty_requests r left join public.profiles p on p.id = r.user_id left join auth.users u on u.id = r.user_id
    order by (r.status = 'pending') desc, r.created_at desc;
end; $$;

create or replace function public.review_faculty_request(_user_id uuid, _approve boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin'::text::public.app_role) then raise exception 'Admins only'; end if;
  update public.faculty_requests set status = case when _approve then 'approved' else 'rejected' end, reviewed_at = now() where user_id = _user_id;
  if _approve then
    insert into public.user_roles (user_id, role) values (_user_id, 'faculty') on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user_id and role = 'faculty';
  end if;
end; $$;

create or replace function public.verify_student(_student_no text)
returns table(full_name text, student_no text, college text, course text, batch text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.full_name, p.student_no, p.college, p.course, p.batch, p.avatar_url
  from public.profiles p where p.student_no is not null and p.student_no = upper(trim(_student_no))
$$;

create or replace function public.section_attendance_summary(_section_id uuid)
returns table(student_id uuid, student_name text, attended bigint, total bigint)
language sql stable security definer set search_path = public as $$
  with sess as (
    select s.id from public.attendance_sessions s
    join public.class_sections c on c.id = s.section_id and c.faculty_id = auth.uid()
    where s.section_id = _section_id and (s.closed or s.expires_at <= now())
  )
  select m.student_id, coalesce(p.full_name, 'Student'),
    (select count(*) from public.attendance_records r where r.student_id = m.student_id and r.session_id in (select id from sess)),
    (select count(*) from sess)
  from public.section_members m
  join public.class_sections c on c.id = m.section_id and c.faculty_id = auth.uid()
  left join public.profiles p on p.id = m.student_id
  where m.section_id = _section_id order by 2
$$;

revoke execute on function public.list_faculty_requests(), public.review_faculty_request(uuid, boolean), public.section_attendance_summary(uuid) from public, anon;
grant execute on function public.list_faculty_requests(), public.review_faculty_request(uuid, boolean), public.section_attendance_summary(uuid) to authenticated;
grant execute on function public.verify_student(text) to anon, authenticated;