-- SecureTest RLS policies
-- Depends on 001_schema.sql

alter table public.users enable row level security;
alter table public.question_bank enable row level security;
alter table public.exams enable row level security;
alter table public.exam_questions enable row level security;
alter table public.attempts enable row level security;
alter table public.violations enable row level security;
alter table public.locks enable row level security;

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
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'student');
  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_reg := nullif(new.raw_user_meta_data->>'register_number', '');
  v_staff := nullif(new.raw_user_meta_data->>'staff_id', '');

  insert into public.users (id, name, register_number, staff_id, email, role)
  values (new.id, v_name, v_reg, v_staff, new.email, v_role);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
    where eq.question_id = old.id and e.is_locked = true
  ) then
    raise exception 'Question is used in a locked exam and cannot be edited or deleted';
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
create policy "users_teacher_read_examinees"
  on public.users for select
  using (
    public.is_admin()
    or id = auth.uid()
    or (
      role = 'student'
      and exists (
        select 1
        from public.attempts a
        join public.exams e on e.id = a.exam_id
        where a.student_id = users.id
          and e.created_by = auth.uid()
      )
    )
  );
create policy "users_update_own"
  on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Teachers can see student names on their exam attempts (via admin path or RPC);
-- keep direct select limited. Admins see all via is_admin().

-- ---------- QUESTION BANK ----------
-- Students never see correct_option via this table; they use get_exam_questions RPC.
create policy "qb_teacher_select_own"
  on public.question_bank for select
  using (created_by = auth.uid() or public.is_admin());

create policy "qb_teacher_insert_own"
  on public.question_bank for insert
  with check (created_by = auth.uid() and public.is_teacher());

create policy "qb_teacher_update_own"
  on public.question_bank for update
  using (created_by = auth.uid() and public.is_teacher())
  with check (created_by = auth.uid());

create policy "qb_teacher_delete_own"
  on public.question_bank for delete
  using (created_by = auth.uid() and public.is_teacher());

-- ---------- EXAMS ----------
create policy "exams_teacher_manage_own"
  on public.exams for all
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

-- Students may read published exams (metadata only — no answers here)
create policy "exams_student_read_published"
  on public.exams for select
  using (
    status = 'published'
    or created_by = auth.uid()
    or public.is_admin()
  );

-- ---------- EXAM QUESTIONS ----------
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

create policy "attempts_student_insert"
  on public.attempts for insert
  with check (student_id = auth.uid());

-- Students must not update attempts directly (scoring/status via security definer RPCs only).
create policy "attempts_admin_update"
  on public.attempts for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- VIOLATIONS ----------
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

create policy "locks_admin_update"
  on public.locks for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- STORAGE ----------
create policy "verification_photos_own_upload"
  on storage.objects for insert
  with check (
    bucket_id = 'verification-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

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
