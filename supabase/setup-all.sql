-- SecureTest schema
-- Run in Supabase SQL Editor (or via supabase db push)

-- Clean reset of public schema for fresh setup
drop schema if exists public cascade;
create schema public;
grant all on schema public to postgres;
grant all on schema public to public;
grant all on schema public to anon;
grant all on schema public to authenticated;
grant all on schema public to service_role;

-- WIPE ALL STUDENT REGISTRATIONS AND ATTEMPTS FROM AUTH AND PUBLIC TABLES
delete from auth.users where email like '%@students.securetest.com' or email like '%@students.securetest.local';

-- Roles enum
do $$ begin create type public.user_role as enum ('student', 'teacher', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type public.exam_status as enum ('draft', 'published'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attempt_status as enum ('in_progress', 'submitted', 'violated'); exception when duplicate_object then null; end $$;
do $$ begin create type public.violation_type as enum ('tab_switch', 'fullscreen_exit', 'devtools', 'copy_paste', 'camera', 'shortcut'); exception when duplicate_object then null; end $$;

-- Profiles linked to auth.users
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  register_number text unique,
  staff_id text unique,
  email text not null,
  role public.user_role not null,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint users_identity_check check (
    (role = 'student' and (register_number is not null or email is not null))
    or (role in ('teacher', 'admin'))
  )
);

create index if not exists users_role_idx on public.users(role);
create index if not exists users_register_number_idx on public.users(register_number);

-- Reusable question bank (owned by teachers)
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.users(id) on delete cascade,
  question_text text not null,
  options jsonb not null,
  correct_option int not null check (correct_option >= 0),
  marks numeric(6,2) not null default 1,
  negative_marking_value numeric(6,2) not null default 0,
  topic text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint options_is_array check (jsonb_typeof(options) = 'array')
);

create index if not exists question_bank_created_by_idx on public.question_bank(created_by);

-- Exams assembled from the bank
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  exam_code text not null unique,
  title text not null,
  duration_minutes int not null check (duration_minutes > 0),
  created_by uuid not null references public.users(id) on delete cascade,
  status public.exam_status not null default 'draft',
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists exams_created_by_idx on public.exams(created_by);
create index if not exists exams_status_idx on public.exams(status);

-- Join: exam <-> questions
create table if not exists public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  position int not null check (position >= 0),
  primary key (exam_id, question_id),
  unique (exam_id, position)
);

-- Attempts
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  status public.attempt_status not null default 'in_progress',
  score numeric(8,2),
  max_score numeric(8,2),
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  id_card_photo_url text,
  selfie_photo_url text,
  submit_reason text
);

create index if not exists attempts_student_idx on public.attempts(student_id);
create index if not exists attempts_exam_idx on public.attempts(exam_id);
create index if not exists attempts_status_idx on public.attempts(status);

-- One in-progress attempt per student+exam
create unique index if not exists attempts_one_in_progress
  on public.attempts(student_id, exam_id)
  where status = 'in_progress';

-- Violations
create table if not exists public.violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  type public.violation_type not null,
  message text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists violations_attempt_idx on public.violations(attempt_id);

-- Per student + exam lockouts
create table if not exists public.locks (
  student_id uuid not null references public.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  is_locked boolean not null default true,
  locked_at timestamptz not null default now(),
  unlocked_by uuid references public.users(id),
  unlocked_at timestamptz,
  primary key (student_id, exam_id)
);

create index if not exists locks_active_idx on public.locks(is_locked) where is_locked = true;

-- Storage buckets (ID / selfie photos)
insert into storage.buckets (id, name, public)
values ('verification-photos', 'verification-photos', false)
on conflict (id) do nothing;
-- SecureTest RLS policies
-- Depends on 001_schema.sql

alter table public.users disable row level security;
alter table public.question_bank disable row level security;
alter table public.exams disable row level security;
alter table public.exam_questions disable row level security;
alter table public.attempts disable row level security;
alter table public.violations disable row level security;
alter table public.locks disable row level security;

grant all on all tables in schema public to anon, authenticated, service_role, postgres;
grant all on all functions in schema public to anon, authenticated, service_role, postgres;
grant all on all sequences in schema public to anon, authenticated, service_role, postgres;

-- Helper: current user's role
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  )
  or exists (
    select 1 from auth.users where id = auth.uid() and (
      raw_user_meta_data->>'role' = 'admin'
      or lower(email) = 'iyappanfintech@gmail.com'
    )
  );
$$;

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'teacher'
  );
$$;

-- Auto-create profile on signup via raw_user_meta_data
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_name text;
  v_reg text;
  v_staff text;
  v_approved boolean;
begin
  begin
    v_role := (new.raw_user_meta_data->>'role')::public.user_role;
  exception when others then
    v_role := 'student';
  end;
  if v_role is null then
    v_role := 'student';
  end if;

  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), nullif(new.raw_user_meta_data->>'name', ''), split_part(new.email, '@', 1), 'User');
  v_reg := nullif(new.raw_user_meta_data->>'register_number', '');
  v_staff := nullif(new.raw_user_meta_data->>'staff_id', '');

  if v_role = 'student' and v_reg is null then
    v_reg := coalesce(split_part(new.email, '@', 1), substring(new.id::text from 1 for 8));
  end if;

  if v_role in ('teacher', 'admin') and v_staff is null then
    v_staff := coalesce(split_part(new.email, '@', 1), substring(new.id::text from 1 for 8));
  end if;

  v_approved := (v_role = 'admin' or v_role = 'student');

  -- Delete stale conflict profiles if register_number or staff_id already exists on another ID
  if v_reg is not null then
    delete from public.users where register_number = v_reg and id != new.id;
  end if;
  if v_staff is not null then
    delete from public.users where staff_id = v_staff and id != new.id;
  end if;

  insert into public.users (id, name, register_number, staff_id, email, role, is_approved)
  values (new.id, v_name, v_reg, v_staff, new.email, v_role, v_approved)
  on conflict (id) do update set
    name = excluded.name,
    register_number = excluded.register_number,
    staff_id = excluded.staff_id,
    email = excluded.email,
    role = excluded.role,
    is_approved = excluded.is_approved;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Fetch pending teacher approval requests for Admin
create or replace function public.get_pending_teachers()
returns table (
  id uuid,
  name text,
  email text,
  staff_id text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.name, u.email, u.staff_id, u.created_at
  from public.users u
  where u.role = 'teacher' and u.is_approved = false
  order by u.created_at desc;
$$;

-- Approve or reject a teacher
create or replace function public.approve_teacher(p_teacher_id uuid, p_approve boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_approve then
    update public.users
    set is_approved = true
    where id = p_teacher_id and role = 'teacher';
  else
    delete from public.users where id = p_teacher_id and role = 'teacher';
  end if;

  return true;
end;
$$;

-- Fetch pending student approval requests for Teachers / Admins
create or replace function public.get_pending_students()
returns table (
  id uuid,
  name text,
  email text,
  register_number text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.name, u.email, u.register_number, u.created_at
  from public.users u
  where u.role = 'student' and u.is_approved = false
  order by u.created_at desc;
$$;

-- Approve or reject a student
create or replace function public.approve_student(p_student_id uuid, p_approve boolean default true)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_approve then
    update public.users
    set is_approved = true
    where id = p_student_id;
  else
    delete from public.violations where attempt_id in (select id from public.attempts where student_id = p_student_id);
    delete from public.locks where student_id = p_student_id;
    delete from public.attempts where student_id = p_student_id;
    delete from public.users where id = p_student_id;
    delete from auth.users where id = p_student_id;
  end if;

  return true;
end;
$$;

-- Fetch all students for Teacher/Admin management
create or replace function public.get_all_students()
returns table (
  id uuid,
  name text,
  email text,
  register_number text,
  is_approved boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select u.id, u.name, u.email, u.register_number, u.is_approved, u.created_at
  from public.users u
  where u.role = 'student'
  order by u.created_at desc;
$$;

-- Permanently delete a student account
create or replace function public.delete_student(p_student_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Teacher or Admin access required';
  end if;

  delete from public.violations where attempt_id in (select id from public.attempts where student_id = p_student_id);
  delete from public.locks where student_id = p_student_id;
  delete from public.attempts where student_id = p_student_id;
  delete from public.users where id = p_student_id;
  delete from auth.users where id = p_student_id;

  return true;
end;
$$;

-- Permanently delete any user account (Admin master delete)
create or replace function public.admin_delete_user(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  delete from public.violations where attempt_id in (select id from public.attempts where student_id = p_user_id);
  delete from public.locks where student_id = p_user_id or unlocked_by = p_user_id;
  delete from public.attempts where student_id = p_user_id;
  delete from public.question_bank where created_by = p_user_id;
  delete from public.exams where created_by = p_user_id;
  delete from public.users where id = p_user_id;
  delete from auth.users where id = p_user_id;

  return true;
end;
$$;

grant execute on function public.delete_student(uuid) to authenticated, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, anon;

-- Delete a question from question bank and remove from exams (supports force delete)
create or replace function public.delete_question(p_question_id uuid, p_force boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_exam_title text;
begin
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Teacher or Admin access required';
  end if;

  select e.title into v_locked_exam_title
  from public.exam_questions eq
  join public.exams e on e.id = eq.exam_id
  where eq.question_id = p_question_id and e.is_locked = true
  limit 1;

  if v_locked_exam_title is not null and not p_force then
    raise exception 'Question is used in a locked exam ("%") and cannot be deleted.', v_locked_exam_title;
  end if;

  delete from public.exam_questions where question_id = p_question_id;
  delete from public.question_bank where id = p_question_id;

  return true;
end;
$$;

-- Delete all questions from question bank
create or replace function public.delete_all_questions()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Teacher or Admin access required';
  end if;

  update public.exams set is_locked = false;
  delete from public.exam_questions;
  delete from public.question_bank;

  return true;
end;
$$;

-- Delete a single exam
create or replace function public.delete_exam(p_exam_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Teacher or Admin access required';
  end if;

  delete from public.locks where exam_id = p_exam_id;
  delete from public.attempts where exam_id = p_exam_id;
  delete from public.exam_questions where exam_id = p_exam_id;
  delete from public.exams where id = p_exam_id;

  return true;
end;
$$;

-- Delete all exams
create or replace function public.delete_all_exams()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_teacher() or public.is_admin()) then
    raise exception 'Teacher or Admin access required';
  end if;

  delete from public.locks;
  delete from public.attempts;
  delete from public.exam_questions;
  delete from public.exams;

  return true;
end;
$$;

-- Fetch all banned / locked out students for Admin management
create or replace function public.get_banned_students()
returns table (
  student_id uuid,
  student_name text,
  student_email text,
  register_number text,
  exam_id uuid,
  exam_code text,
  exam_title text,
  locked_at timestamptz,
  violation_count bigint,
  last_violation_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.is_teacher()) then
    raise exception 'Access denied';
  end if;

  return query
  select
    u.id as student_id,
    u.name as student_name,
    u.email as student_email,
    coalesce(u.register_number, N/A) as register_number,
    e.id as exam_id,
    e.exam_code,
    e.title as exam_title,
    l.locked_at,
    count(v.id) as violation_count,
    (
      select v2.message from public.violations v2
      join public.attempts a2 on a2.id = v2.attempt_id
      where a2.student_id = u.id and a2.exam_id = e.id
      order by v2.occurred_at desc limit 1
    ) as last_violation_message
  from public.locks l
  join public.users u on u.id = l.student_id
  join public.exams e on e.id = l.exam_id
  left join public.attempts a on a.student_id = u.id and a.exam_id = e.id
  left join public.violations v on v.attempt_id = a.id
  where l.is_locked = true
  group by u.id, u.name, u.email, u.register_number, e.id, e.exam_code, e.title, l.locked_at;
end;
$$;

-- Freeze exam when first attempt is created
create or replace function public.freeze_exam_on_attempt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.exams set is_locked = true, updated_at = now()
  where id = new.exam_id and is_locked = false;
  return new;
end;
$$;

drop trigger if exists trg_freeze_exam on public.attempts;
create trigger trg_freeze_exam
  after insert on public.attempts
  for each row execute function public.freeze_exam_on_attempt();

-- Block question set changes once exam is locked
create or replace function public.prevent_locked_exam_question_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam_id uuid;
  v_locked boolean;
begin
  v_exam_id := coalesce(new.exam_id, old.exam_id);
  select is_locked into v_locked from public.exams where id = v_exam_id;
  if v_locked then
    raise exception 'Exam question set is frozen after the first student attempt';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_exam_questions_immutable on public.exam_questions;
create trigger trg_exam_questions_immutable
  before insert or update or delete on public.exam_questions
  for each row execute function public.prevent_locked_exam_question_edits();

-- Block editing question_bank rows that appear in a locked exam
create or replace function public.prevent_locked_question_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.exam_questions eq
    join public.exams e on e.id = eq.exam_id
    where eq.question_id = old.id and e.is_locked = true and e.status = 'published'
  ) then
    raise exception 'Question is used in an active published exam and cannot be edited or deleted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_question_bank_immutable on public.question_bank;
create trigger trg_question_bank_immutable
  before update or delete on public.question_bank
  for each row execute function public.prevent_locked_question_edits();

-- ---------- USERS ----------
-- Teachers may read student profiles who have attempts on the teacher's exams
drop policy if exists "users_teacher_read_examinees" on public.users;
drop policy if exists "users_select_policy" on public.users;
create policy "users_select_policy"
  on public.users for select
  using (true);

drop policy if exists "users_insert_own" on public.users;
drop policy if exists "users_insert_policy" on public.users;
create policy "users_insert_policy"
  on public.users for insert
  with check (true);

drop policy if exists "users_update_own" on public.users;
drop policy if exists "users_update_policy" on public.users;
create policy "users_update_policy"
  on public.users for update
  using (true)
  with check (true);

drop policy if exists "users_delete_policy" on public.users;
create policy "users_delete_policy"
  on public.users for delete
  using (true);

-- Teachers can see student names on their exam attempts (via admin path or RPC);
-- keep direct select limited. Admins see all via is_admin().

-- ---------- QUESTION BANK ----------
-- Students never see correct_option via this table; they use get_exam_questions RPC.
drop policy if exists "qb_teacher_select_own" on public.question_bank;
create policy "qb_teacher_select_own"
  on public.question_bank for select
  using (created_by = auth.uid() or public.is_admin());

drop policy if exists "qb_teacher_insert_own" on public.question_bank;
create policy "qb_teacher_insert_own"
  on public.question_bank for insert
  with check (created_by = auth.uid() and public.is_teacher());

drop policy if exists "qb_teacher_update_own" on public.question_bank;
create policy "qb_teacher_update_own"
  on public.question_bank for update
  using (created_by = auth.uid() and public.is_teacher())
  with check (created_by = auth.uid());

drop policy if exists "qb_teacher_delete_own" on public.question_bank;
create policy "qb_teacher_delete_own"
  on public.question_bank for delete
  using (created_by = auth.uid() and public.is_teacher());

-- ---------- EXAMS ----------
drop policy if exists "exams_teacher_manage_own" on public.exams;
create policy "exams_teacher_manage_own"
  on public.exams for all
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

-- Students may read published exams (metadata only — no answers here)
drop policy if exists "exams_student_read_published" on public.exams;
create policy "exams_student_read_published"
  on public.exams for select
  using (
    status = 'published'
    or created_by = auth.uid()
    or public.is_admin()
  );

-- ---------- EXAM QUESTIONS ----------
drop policy if exists "eq_teacher_manage" on public.exam_questions;
create policy "eq_teacher_manage"
  on public.exam_questions for all
  using (
    public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid() and e.is_locked = false
    )
  );

-- Students: no direct select on exam_questions (use RPC that strips answers)
-- Teachers/admins covered above.

-- ---------- ATTEMPTS ----------
drop policy if exists "attempts_student_own" on public.attempts;
create policy "attempts_student_own"
  on public.attempts for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  );

drop policy if exists "attempts_student_insert" on public.attempts;
create policy "attempts_student_insert"
  on public.attempts for insert
  with check (student_id = auth.uid());

-- Students must not update attempts directly (scoring/status via security definer RPCs only).
drop policy if exists "attempts_admin_update" on public.attempts;
create policy "attempts_admin_update"
  on public.attempts for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- VIOLATIONS ----------
drop policy if exists "violations_select" on public.violations;
create policy "violations_select"
  on public.violations for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.attempts a
      where a.id = attempt_id and a.student_id = auth.uid()
    )
    or exists (
      select 1 from public.attempts a
      join public.exams e on e.id = a.exam_id
      where a.id = attempt_id and e.created_by = auth.uid()
    )
  );

drop policy if exists "violations_student_insert" on public.violations;
create policy "violations_student_insert"
  on public.violations for insert
  with check (
    exists (
      select 1 from public.attempts a
      where a.id = attempt_id
        and a.student_id = auth.uid()
        and a.status = 'in_progress'
    )
  );

-- ---------- LOCKS ----------
drop policy if exists "locks_select" on public.locks;
create policy "locks_select"
  on public.locks for select
  using (
    student_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.exams e
      where e.id = exam_id and e.created_by = auth.uid()
    )
  );

-- Lock inserts happen via security definer RPC (auto-lock)
-- Admin unlock via RPC

drop policy if exists "locks_admin_update" on public.locks;
create policy "locks_admin_update"
  on public.locks for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- STORAGE ----------
drop policy if exists "verification_photos_own_upload" on storage.objects;
create policy "verification_photos_own_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "verification_photos_own_read" on storage.objects;
create policy "verification_photos_own_read"
  on storage.objects for select
  using (
    bucket_id = 'verification-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.is_admin()
      or public.is_teacher()
    )
  );
-- SecureTest RPCs: safe question fetch, scoring, lock/unlock
-- Correct answers NEVER returned to the client from these functions' student-facing paths.

-- Published exam lookup by code (metadata only)
create or replace function public.get_exam_by_code(p_code text)
returns table (
  id uuid,
  exam_code text,
  title text,
  duration_minutes int,
  question_count bigint,
  is_locked boolean,
  status public.exam_status
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    e.id,
    e.exam_code,
    e.title,
    e.duration_minutes,
    (select count(*) from public.exam_questions eq where eq.exam_id = e.id),
    e.is_locked,
    e.status
  from public.exams e
  where upper(e.exam_code) = upper(p_code)
    and e.status = 'published';
end;
$$;

-- Questions for an exam WITHOUT correct answers
create or replace function public.get_exam_questions(p_exam_id uuid)
returns table (
  question_id uuid,
  "position" int,
  question_text text,
  options jsonb,
  marks numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.exams e
    where e.id = p_exam_id and e.status = 'published'
  ) then
    raise exception 'Exam not found or not published';
  end if;

  return query
  select
    q.id,
    eq.position,
    q.question_text,
    q.options,
    q.marks
  from public.exam_questions eq
  join public.question_bank q on q.id = eq.question_id
  where eq.exam_id = p_exam_id
  order by eq.position;
end;
$$;

-- Check lock status for current student + exam
create or replace function public.check_exam_lock(p_exam_id uuid)
returns table (is_locked boolean, locked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select l.is_locked, l.locked_at
  from public.locks l
  where l.student_id = auth.uid()
    and l.exam_id = p_exam_id
    and l.is_locked = true;
end;
$$;

-- Start attempt (creates row, freezes exam via trigger, rejects if locked)
create or replace function public.start_attempt(
  p_exam_id uuid,
  p_id_card_photo_url text default null,
  p_selfie_photo_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid;
  v_role public.user_role;
begin
  select role into v_role from public.users where id = auth.uid();
  if v_role is distinct from 'student' then
    raise exception 'Only students can start attempts';
  end if;

  if not exists (
    select 1 from public.exams where id = p_exam_id and status = 'published'
  ) then
    raise exception 'Exam not available';
  end if;

  if exists (
    select 1 from public.locks
    where student_id = auth.uid() and exam_id = p_exam_id and is_locked = true
  ) then
    raise exception 'LOCKED: You are locked out of this exam pending admin review';
  end if;

  -- Resume existing in-progress attempt
  select id into v_attempt_id
  from public.attempts
  where student_id = auth.uid()
    and exam_id = p_exam_id
    and status = 'in_progress'
  limit 1;

  if v_attempt_id is not null then
    update public.attempts
    set
      id_card_photo_url = coalesce(p_id_card_photo_url, id_card_photo_url),
      selfie_photo_url = coalesce(p_selfie_photo_url, selfie_photo_url)
    where id = v_attempt_id;
    return v_attempt_id;
  end if;

  insert into public.attempts (
    student_id, exam_id, status, id_card_photo_url, selfie_photo_url
  ) values (
    auth.uid(), p_exam_id, 'in_progress', p_id_card_photo_url, p_selfie_photo_url
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

-- Log a violation; auto-lock + mark violated on 3rd
create or replace function public.log_violation(
  p_attempt_id uuid,
  p_type public.violation_type,
  p_message text
)
returns table (violation_count int, auto_locked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student uuid;
  v_exam uuid;
  v_status public.attempt_status;
  v_count int;
begin
  select student_id, exam_id, status
  into v_student, v_exam, v_status
  from public.attempts
  where id = p_attempt_id;

  if v_student is null then
    raise exception 'Attempt not found';
  end if;
  if v_student <> auth.uid() and not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if v_status <> 'in_progress' then
    return query select 0, false;
    return;
  end if;

  insert into public.violations (attempt_id, type, message)
  values (p_attempt_id, p_type, p_message);

  select count(*)::int into v_count
  from public.violations
  where attempt_id = p_attempt_id;

  if v_count >= 3 then
    insert into public.locks (student_id, exam_id, is_locked, locked_at)
    values (v_student, v_exam, true, now())
    on conflict (student_id, exam_id) do update
      set is_locked = true,
          locked_at = now(),
          unlocked_by = null,
          unlocked_at = null;

    update public.attempts
    set status = 'violated'
    where id = p_attempt_id and status = 'in_progress';

    return query select v_count, true;
  else
    return query select v_count, false;
  end if;
end;
$$;

-- Server-side scoring — client sends answers map { question_id: optionIndex }
create or replace function public.submit_attempt(
  p_attempt_id uuid,
  p_answers jsonb,
  p_submit_reason text default 'Candidate finalized test.',
  p_force_violated boolean default false
)
returns table (
  score numeric,
  max_score numeric,
  status public.attempt_status,
  violation_count int
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_student uuid;
  v_exam uuid;
  v_status public.attempt_status;
  v_score numeric := 0;
  v_max numeric := 0;
  v_count int;
  r record;
  v_selected int;
  v_final_status public.attempt_status;
begin
  select a.student_id, a.exam_id, a.status
  into v_student, v_exam, v_status
  from public.attempts a
  where a.id = p_attempt_id;

  if v_student is null then
    raise exception 'Attempt not found';
  end if;
  if v_student <> auth.uid() and not public.is_admin() then
    raise exception 'Not allowed';
  end if;
  if v_status not in ('in_progress', 'violated') then
    raise exception 'Attempt already submitted';
  end if;

  for r in
    select q.id, q.correct_option, q.marks, q.negative_marking_value
    from public.exam_questions eq
    join public.question_bank q on q.id = eq.question_id
    where eq.exam_id = v_exam
  loop
    v_max := v_max + r.marks;
    if p_answers ? r.id::text then
      v_selected := (p_answers ->> r.id::text)::int;
      if v_selected = r.correct_option then
        v_score := v_score + r.marks;
      elsif v_selected is not null and r.negative_marking_value > 0 then
        v_score := v_score - r.negative_marking_value;
      end if;
    end if;
  end loop;

  if v_score < 0 then
    v_score := 0;
  end if;

  select count(*)::int into v_count
  from public.violations v
  where v.attempt_id = p_attempt_id;

  if p_force_violated or v_count >= 3 or v_status = 'violated' then
    v_final_status := 'violated';
    insert into public.locks (student_id, exam_id, is_locked, locked_at)
    values (v_student, v_exam, true, now())
    on conflict (student_id, exam_id) do update
      set is_locked = true,
          locked_at = now(),
          unlocked_by = null,
          unlocked_at = null;
  else
    v_final_status := 'submitted';
  end if;

  update public.attempts a
  set
    answers = p_answers,
    score = v_score,
    max_score = v_max,
    status = v_final_status,
    submitted_at = now(),
    submit_reason = p_submit_reason
  where a.id = p_attempt_id;

  return query select v_score, v_max, v_final_status, v_count;
end;
$$;

-- Admin unlock for a specific student + exam (allows one new attempt)
create or replace function public.admin_unlock_student(
  p_student_id uuid,
  p_exam_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin only';
  end if;

  update public.locks
  set
    is_locked = false,
    unlocked_by = auth.uid(),
    unlocked_at = now()
  where student_id = p_student_id
    and exam_id = p_exam_id
    and is_locked = true;

  return found;
end;
$$;

grant execute on function public.get_exam_by_code(text) to authenticated;
grant execute on function public.get_exam_questions(uuid) to authenticated;
grant execute on function public.check_exam_lock(uuid) to authenticated;
grant execute on function public.start_attempt(uuid, text, text) to authenticated;
grant execute on function public.log_violation(uuid, public.violation_type, text) to authenticated;
grant execute on function public.submit_attempt(uuid, jsonb, text, boolean) to authenticated;
grant execute on function public.admin_unlock_student(uuid, uuid) to authenticated;
grant execute on function public.get_pending_teachers() to authenticated;
grant execute on function public.approve_teacher(uuid, boolean) to authenticated;
grant execute on function public.get_pending_students() to authenticated;
grant execute on function public.approve_student(uuid, boolean) to authenticated;
grant execute on function public.get_all_students() to authenticated;
grant execute on function public.delete_student(uuid) to authenticated;
grant execute on function public.delete_question(uuid, boolean) to authenticated;
grant execute on function public.delete_all_questions() to authenticated;
grant execute on function public.delete_exam(uuid) to authenticated;
grant execute on function public.delete_all_exams() to authenticated;
grant execute on function public.get_banned_students() to authenticated;

-- Auto-confirm all user signups automatically
CREATE OR REPLACE FUNCTION public.auto_confirm_users()
RETURNS trigger AS $$
BEGIN
  NEW.email_confirmed_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;

CREATE TRIGGER on_auth_user_created_auto_confirm
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.auto_confirm_users();

-- Grant permissions to anon & authenticated roles for Supabase API access
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Seed Single Master Admin Account: iyappanfintech@gmail.com / edith@123
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_admin_id uuid := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'iyappanfintech@gmail.com') THEN
    INSERT INTO auth.users (
      id, instance_id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, role, aud, created_at, updated_at
    ) VALUES (
      v_admin_id, '00000000-0000-0000-0000-000000000000', 'iyappanfintech@gmail.com',
      extensions.crypt('edith@123', extensions.gen_salt('bf')),
      now(), '{"name": "Master Admin", "staff_id": "ADM-001", "role": "admin"}'::jsonb,
      'authenticated', 'authenticated', now(), now()
    );

    INSERT INTO public.users (id, name, staff_id, email, role, is_approved)
    VALUES (v_admin_id, 'Master Admin', 'ADM-001', 'iyappanfintech@gmail.com', 'admin', true)
    ON CONFLICT (id) DO UPDATE SET role = 'admin', is_approved = true;
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt('edith@123', extensions.gen_salt('bf')),
        raw_user_meta_data = '{"name": "Master Admin", "staff_id": "ADM-001", "role": "admin"}'::jsonb
    WHERE lower(email) = 'iyappanfintech@gmail.com';

    INSERT INTO public.users (id, name, staff_id, email, role, is_approved)
    SELECT id, 'Master Admin', 'ADM-001', lower(email), 'admin', true
    FROM auth.users
    WHERE lower(email) = 'iyappanfintech@gmail.com'
    ON CONFLICT (id) DO UPDATE SET role = 'admin', is_approved = true, staff_id = 'ADM-001';
  END IF;
END $$;



