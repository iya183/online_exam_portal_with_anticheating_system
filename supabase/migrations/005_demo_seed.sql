-- Demo seed: run AFTER registering a teacher via teacher-login.html
-- Replace the email below with your teacher account email, then run in SQL Editor.

do $$
declare
  v_teacher_id uuid;
  v_exam_id uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid;
begin
  select id into v_teacher_id
  from public.users
  where email = 'teacher@demo.local' and role = 'teacher'
  limit 1;

  if v_teacher_id is null then
    raise notice 'No teacher found for teacher@demo.local — register at teacher-login.html first, then re-run this script with your email.';
    return;
  end if;

  -- Skip if demo exam already exists
  if exists (select 1 from public.exams where exam_code = 'WDF-2026') then
    raise notice 'Demo exam WDF-2026 already exists — skipping seed.';
    return;
  end if;

  insert into public.question_bank (created_by, question_text, options, correct_option, marks, topic)
  values (
    v_teacher_id,
    'In the MERN stack, what does the ''M'' most commonly refer to?',
    '["MySQL", "MongoDB", "Mongoose", "Materialize CSS"]'::jsonb, 1, 1, 'Web Dev'
  ) returning id into q1;

  insert into public.question_bank (created_by, question_text, options, correct_option, marks, topic)
  values (
    v_teacher_id,
    'Which HTTP method is typically used to update an existing resource in a REST API?',
    '["GET", "POST", "PUT", "DELETE"]'::jsonb, 2, 1, 'APIs'
  ) returning id into q2;

  insert into public.question_bank (created_by, question_text, options, correct_option, marks, topic)
  values (
    v_teacher_id,
    'In React, what hook is used to manage local component state?',
    '["useEffect", "useContext", "useRef", "useState"]'::jsonb, 3, 1, 'React'
  ) returning id into q3;

  insert into public.question_bank (created_by, question_text, options, correct_option, marks, topic)
  values (
    v_teacher_id,
    'Which of these correctly describes JWT (JSON Web Token)?',
    '["A database used for storing sessions", "A compact, self-contained token used to securely transmit information", "A CSS framework for token-based layouts", "A MongoDB query operator"]'::jsonb,
    1, 1, 'Security'
  ) returning id into q4;

  insert into public.question_bank (created_by, question_text, options, correct_option, marks, topic)
  values (
    v_teacher_id,
    'In Express.js, what is the primary purpose of middleware?',
    '["To style the frontend UI", "To compile SCSS into CSS", "To process requests/responses between the client and route handler", "To manage MongoDB indexes"]'::jsonb,
    2, 1, 'Node'
  ) returning id into q5;

  insert into public.exams (exam_code, title, duration_minutes, created_by, status)
  values ('WDF-2026', 'Web Development Fundamentals', 15, v_teacher_id, 'published')
  returning id into v_exam_id;

  insert into public.exam_questions (exam_id, question_id, position) values
    (v_exam_id, q1, 0),
    (v_exam_id, q2, 1),
    (v_exam_id, q3, 2),
    (v_exam_id, q4, 3),
    (v_exam_id, q5, 4);

  raise notice 'Demo seed complete: exam WDF-2026 published with 5 questions.';
end $$;
