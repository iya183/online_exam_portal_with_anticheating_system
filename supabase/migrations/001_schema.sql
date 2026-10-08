-- SecureTest schema
-- Run in Supabase SQL Editor (or via supabase db push)

-- Roles enum
create type public.user_role as enum ('student', 'teacher', 'admin');
create type public.exam_status as enum ('draft', 'published');
create type public.attempt_status as enum ('in_progress', 'submitted', 'violated');
create type public.violation_type as enum ('tab_switch', 'fullscreen_exit', 'devtools', 'copy_paste', 'camera', 'shortcut');

-- Profiles linked to auth.users
create table public.users (
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

create index users_role_idx on public.users(role);
create index users_register_number_idx on public.users(register_number);

-- Reusable question bank (owned by teachers)
create table public.question_bank (
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

create index question_bank_created_by_idx on public.question_bank(created_by);

-- Exams assembled from the bank
create table public.exams (
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

create index exams_created_by_idx on public.exams(created_by);
create index exams_status_idx on public.exams(status);

-- Join: exam <-> questions
create table public.exam_questions (
  exam_id uuid not null references public.exams(id) on delete cascade,
  question_id uuid not null references public.question_bank(id) on delete cascade,
  position int not null check (position >= 0),
  primary key (exam_id, question_id),
  unique (exam_id, position)
);

-- Attempts
create table public.attempts (
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

create index attempts_student_idx on public.attempts(student_id);
create index attempts_exam_idx on public.attempts(exam_id);
create index attempts_status_idx on public.attempts(status);

-- One in-progress attempt per student+exam
create unique index attempts_one_in_progress
  on public.attempts(student_id, exam_id)
  where status = 'in_progress';

-- Violations
create table public.violations (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  type public.violation_type not null,
  message text not null,
  occurred_at timestamptz not null default now()
);

create index violations_attempt_idx on public.violations(attempt_id);

-- Per student + exam lockouts
create table public.locks (
  student_id uuid not null references public.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  is_locked boolean not null default true,
  locked_at timestamptz not null default now(),
  unlocked_by uuid references public.users(id),
  unlocked_at timestamptz,
  primary key (student_id, exam_id)
);

create index locks_active_idx on public.locks(is_locked) where is_locked = true;

-- Storage buckets (ID / selfie photos)
insert into storage.buckets (id, name, public)
values ('verification-photos', 'verification-photos', false)
on conflict (id) do nothing;
