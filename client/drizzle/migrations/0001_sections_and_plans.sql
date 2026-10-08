create table public.class_sections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  faculty_id uuid not null,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.class_sections to authenticated;
grant all on public.class_sections to service_role;
alter table public.class_sections enable row level security;
create policy "faculty manage own sections" on public.class_sections for all to authenticated
  using (faculty_id = auth.uid()) with check (faculty_id = auth.uid() and public.has_role(auth.uid(),'faculty'));

create table public.section_members (
  section_id uuid not null references public.class_sections(id) on delete cascade,
  student_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (section_id, student_id)
);
grant select, delete on public.section_members to authenticated;
grant all on public.section_members to service_role;
alter table public.section_members enable row level security;
create policy "faculty see own section members" on public.section_members for select to authenticated
  using (exists (select 1 from public.class_sections c where c.id = section_id and c.faculty_id = auth.uid()) or student_id = auth.uid());
create policy "faculty remove members" on public.section_members for delete to authenticated
  using (exists (select 1 from public.class_sections c where c.id = section_id and c.faculty_id = auth.uid()));

alter table public.attendance_sessions add column section_id uuid references public.class_sections(id) on delete set null;

create table public.attendance_plans (
  student_id uuid primary key,
  schedule jsonb not null default '[]'::jsonb,
  goal int not null default 75 check (goal between 50 and 100),
  notes text,
  plan text,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.attendance_plans to authenticated;
grant all on public.attendance_plans to service_role;
alter table public.attendance_plans enable row level security;
create policy "own plan" on public.attendance_plans for all to authenticated
  using (student_id = auth.uid()) with check (student_id = auth.uid());

create or replace function public.add_section_member(_section_id uuid, _email text)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid; nm text;
begin
  if not exists (select 1 from public.class_sections where id = _section_id and faculty_id = auth.uid()) then
    raise exception 'Section not found'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(_email));
  if uid is null then raise exception 'No student account with that email'; end if;
  insert into public.section_members (section_id, student_id) values (_section_id, uid) on conflict do nothing;
  select coalesce(full_name, split_part(_email,'@',1)) into nm from public.profiles where id = uid;
  return coalesce(nm, _email);
end; $$;

create or replace function public.section_roster(_section_id uuid)
returns table(student_id uuid, student_name text, email text, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.student_id, coalesce(p.full_name, split_part(u.email,'@',1)), u.email::text, m.added_at
  from public.section_members m
  join public.class_sections c on c.id = m.section_id and c.faculty_id = auth.uid()
  left join public.profiles p on p.id = m.student_id
  left join auth.users u on u.id = m.student_id
  where m.section_id = _section_id order by 2
$$;

create or replace function public.open_section_session(_section_id uuid, _minutes integer default 5)
returns public.attendance_sessions language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; sec public.class_sections; chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text := ''; i int;
begin
  select * into sec from public.class_sections where id = _section_id and faculty_id = auth.uid();
  if sec.id is null then raise exception 'Section not found'; end if;
  for i in 1..6 loop c := c || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
  insert into public.attendance_sessions (subject_id, section_id, faculty_id, code, expires_at)
  values (sec.subject_id, sec.id, auth.uid(), c, now() + make_interval(mins => greatest(1, least(_minutes, 30))))
  returning * into s;
  return s;
end; $$;

create or replace function public.live_sessions()
returns table(id uuid, subject_name text, subject_code text, faculty_name text, expires_at timestamptz, already_marked boolean)
language sql stable security definer set search_path = public as $$
  select s.id, sub.name, sub.code, coalesce(p.full_name, 'Faculty'), s.expires_at,
    exists (select 1 from public.attendance_records r where r.session_id = s.id and r.student_id = auth.uid())
  from public.attendance_sessions s
  join public.subjects sub on sub.id = s.subject_id
  left join public.profiles p on p.id = s.faculty_id
  where not s.closed and s.expires_at > now() and auth.uid() is not null
    and (s.section_id is null or exists (select 1 from public.section_members m where m.section_id = s.section_id and m.student_id = auth.uid()))
  order by s.started_at desc
$$;

create or replace function public.mark_attendance(_code text)
returns text language plpgsql security definer set search_path = public as $$
declare s public.attendance_sessions; sub_name text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into s from public.attendance_sessions
  where code = upper(trim(_code)) and not closed and expires_at > now()
  order by started_at desc limit 1;
  if s.id is null then raise exception 'Invalid or expired code'; end if;
  if s.section_id is not null and not exists (select 1 from public.section_members where section_id = s.section_id and student_id = auth.uid()) then
    raise exception 'You are not enrolled in this class section'; end if;
  insert into public.attendance_records (session_id, student_id) values (s.id, auth.uid())
  on conflict (session_id, student_id) do nothing;
  select name into sub_name from public.subjects where id = s.subject_id;
  return sub_name;
end; $$;

create or replace function public.my_attendance_history()
returns table(session_id uuid, subject_name text, subject_code text, started_at timestamptz, present boolean, marked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, sub.name, sub.code, s.started_at, r.id is not null, r.marked_at
  from public.attendance_sessions s
  join public.subjects sub on sub.id = s.subject_id
  left join public.attendance_records r on r.session_id = s.id and r.student_id = auth.uid()
  where auth.uid() is not null
    and (r.id is not null or (
      (s.closed or s.expires_at <= now())
      and (s.section_id is null or exists (select 1 from public.section_members m where m.section_id = s.section_id and m.student_id = auth.uid()))
    ))
  order by s.started_at desc
$$;

revoke execute on function public.add_section_member(uuid,text), public.section_roster(uuid), public.open_section_session(uuid,integer) from public, anon;
grant execute on function public.add_section_member(uuid,text), public.section_roster(uuid), public.open_section_session(uuid,integer) to authenticated;