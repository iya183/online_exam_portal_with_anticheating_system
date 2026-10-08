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
  from public.violations
  where attempt_id = p_attempt_id;

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

  update public.attempts
  set
    answers = p_answers,
    score = v_score,
    max_score = v_max,
    status = v_final_status,
    submitted_at = now(),
    submit_reason = p_submit_reason
  where id = p_attempt_id;

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
