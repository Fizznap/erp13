create type public.app_role as enum ('student', 'faculty');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);
grant select, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Signed-in users can view profiles" on public.profiles for select to authenticated using (true);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
create policy "Users view own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  insert into public.user_roles (user_id, role) values (new.id, 'student');
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);
grant select on public.subjects to authenticated;
grant all on public.subjects to service_role;
alter table public.subjects enable row level security;
create policy "Signed-in users view subjects" on public.subjects for select to authenticated using (true);

insert into public.subjects (code, name) values
  ('CS301', 'Database Management Systems'),
  ('CS302', 'Operating Systems'),
  ('CS303', 'Computer Networks'),
  ('CS304', 'Software Engineering'),
  ('CS301L', 'DBMS Lab');

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  faculty_id uuid not null,
  code text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed boolean not null default false
);
grant select on public.attendance_sessions to authenticated;
grant all on public.attendance_sessions to service_role;
alter table public.attendance_sessions enable row level security;
create policy "Faculty view own sessions" on public.attendance_sessions for select to authenticated
  using (faculty_id = auth.uid() and public.has_role(auth.uid(), 'faculty'));

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null,
  marked_at timestamptz not null default now(),
  unique (session_id, student_id)
);
grant select on public.attendance_records to authenticated;
grant all on public.attendance_records to service_role;
alter table public.attendance_records enable row level security;
create policy "Students view own records" on public.attendance_records for select to authenticated using (student_id = auth.uid());
create policy "Faculty view records of own sessions" on public.attendance_records for select to authenticated
  using (exists (select 1 from public.attendance_sessions s where s.id = session_id and s.faculty_id = auth.uid()));

-- Faculty: open a session with a fresh random code
create or replace function public.open_attendance_session(_subject_id uuid, _minutes int default 5)
returns public.attendance_sessions language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin
  if not public.has_role(auth.uid(), 'faculty') then raise exception 'Only faculty can open sessions'; end if;
  for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
  insert into public.attendance_sessions (subject_id, faculty_id, code, expires_at)
  values (_subject_id, auth.uid(), c, now() + make_interval(mins => greatest(1, least(_minutes, 30))))
  returning * into s;
  return s;
end; $$;

create or replace function public.refresh_session_code(_session_id uuid, _minutes int default 5)
returns public.attendance_sessions language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin
  for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
  update public.attendance_sessions set code = c, expires_at = now() + make_interval(mins => greatest(1, least(_minutes, 30))), closed = false
  where id = _session_id and faculty_id = auth.uid() returning * into s;
  if s.id is null then raise exception 'Session not found'; end if;
  return s;
end; $$;

create or replace function public.close_attendance_session(_session_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.attendance_sessions set closed = true, expires_at = least(expires_at, now())
  where id = _session_id and faculty_id = auth.uid();
$$;

-- Students: see live sessions without codes
create or replace function public.live_sessions()
returns table (id uuid, subject_name text, subject_code text, faculty_name text, expires_at timestamptz, already_marked boolean)
language sql stable security definer set search_path = public as $$
  select s.id, sub.name, sub.code, coalesce(p.full_name, 'Faculty'), s.expires_at,
    exists (select 1 from public.attendance_records r where r.session_id = s.id and r.student_id = auth.uid())
  from public.attendance_sessions s
  join public.subjects sub on sub.id = s.subject_id
  left join public.profiles p on p.id = s.faculty_id
  where not s.closed and s.expires_at > now() and auth.uid() is not null
  order by s.started_at desc
$$;

-- Students: mark attendance with a code
create or replace function public.mark_attendance(_code text)
returns text language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; sub_name text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into s from public.attendance_sessions
  where code = upper(trim(_code)) and not closed and expires_at > now()
  order by started_at desc limit 1;
  if s.id is null then raise exception 'Invalid or expired code'; end if;
  insert into public.attendance_records (session_id, student_id) values (s.id, auth.uid())
  on conflict (session_id, student_id) do nothing;
  select name into sub_name from public.subjects where id = s.subject_id;
  return sub_name;
end; $$;

-- Students: full history (present/absent for every past or live session)
create or replace function public.my_attendance_history()
returns table (session_id uuid, subject_name text, subject_code text, started_at timestamptz, present boolean, marked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, sub.name, sub.code, s.started_at, r.id is not null, r.marked_at
  from public.attendance_sessions s
  join public.subjects sub on sub.id = s.subject_id
  left join public.attendance_records r on r.session_id = s.id and r.student_id = auth.uid()
  where auth.uid() is not null and (r.id is not null or s.closed or s.expires_at <= now())
  order by s.started_at desc
$$;

-- Faculty: roster for a session
create or replace function public.session_attendees(_session_id uuid)
returns table (student_name text, marked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(p.full_name, 'Student'), r.marked_at
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  left join public.profiles p on p.id = r.student_id
  where r.session_id = _session_id and s.faculty_id = auth.uid()
  order by r.marked_at desc
$$;

revoke execute on function public.open_attendance_session(uuid, int) from anon, public;
revoke execute on function public.refresh_session_code(uuid, int) from anon, public;
revoke execute on function public.close_attendance_session(uuid) from anon, public;
revoke execute on function public.live_sessions() from anon, public;
revoke execute on function public.mark_attendance(text) from anon, public;
revoke execute on function public.my_attendance_history() from anon, public;
revoke execute on function public.session_attendees(uuid) from anon, public;
grant execute on function public.open_attendance_session(uuid, int) to authenticated;
grant execute on function public.refresh_session_code(uuid, int) to authenticated;
grant execute on function public.close_attendance_session(uuid) to authenticated;
grant execute on function public.live_sessions() to authenticated;
grant execute on function public.mark_attendance(text) to authenticated;
grant execute on function public.my_attendance_history() to authenticated;
grant execute on function public.session_attendees(uuid) to authenticated;