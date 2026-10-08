# Comprehensive Upgrade Plan: Google OAuth, Exam Violation Bans, MS Word Question Creation, & Database Reset

This plan addresses all requested requirements:
1. **Google (Gmail) Authentication for Student, Teacher, and Admin**.
2. **Exam Violation Ban System & Admin Re-approval / Unban**.
3. **Teacher Admin Approval Gate & MS Word (`.docx`) Question Creation**.
4. **Clean Database Reset**: Removing/clearing previously registered users to start fresh with Google Gmail authentication.

---

## Technical Overview & Proposed Architecture

### 1. Database Clean Reset & Fresh Start
- Provide SQL script commands in `supabase/setup-all.sql` to truncate/delete all existing user profiles and auth records (`auth.users`, `public.users`, `public.attempts`, `public.locks`, `public.violations`, `public.question_bank`, `public.exams`), wiping previous registrations so everyone signs up fresh via Google Gmail / updated portal flow.

### 2. Google Gmail OAuth Authentication (Student, Teacher, Admin)
- **Google OAuth Integration**: Enable Google Sign-In across `index.html` (Student), `teacher-login.html` (Teacher), and `admin-login.html` (Admin) using `supabase.auth.signInWithOAuth({ provider: 'google' })`.
- **Role & Profile Binding**:
  - Pass user metadata (`role`, `register_number`, `staff_id`) when triggering OAuth or handle role completion on OAuth callback.
  - Update `handle_new_user()` trigger in Postgres SQL to extract Google email and name, defaulting roles or updating metadata seamlessly.
  - Store student's Google Gmail address as their official registered mail ID.

### 3. Violation Ban System & Admin Re-Approval Flow
- **Violation Tracking & Lockouts**:
  - Update lock schema in `public.locks` and `public.users` to associate violation bans directly with the student's registered Google Gmail ID and register number.
  - When a student violates proctoring rules (tab switches, exit full screen, camera off/multiple faces), an entry in `public.locks` marks `is_locked = true` for that exam.
  - The student portal detects the lock for their registered email and blocks entrance with a **"Banned from Exam"** banner detailing their registered Gmail address and reason.
- **Admin Management Panel**:
  - Add a **"Violation Locks & Banned Students"** section in `admin.html`.
  - Admins can view all banned candidates by Google Gmail / Register Number / Exam Code, review the timestamp and recorded violation history.
  - Admins can click **"Unban & Allow Re-appear"**, executing `admin_unlock_student(student_id, exam_id)` which clears the lock and allows the student to re-take/continue the exam.

### 4. Teacher Admin Approval & MS Word (.docx) Question Creation
- **Admin Approval Gate for Teachers**:
  - Add `is_approved boolean DEFAULT false` to `public.users` for teacher roles.
  - New teacher signups (via Google or Email) start in a `pending` state.
  - If an unapproved teacher tries to access `teacher.html`, they are shown an **"Account Pending Admin Approval"** message.
  - Add a **"Teacher Approvals"** section in `admin.html` where Admins can view pending teacher requests and click **"Approve Teacher"** or **"Reject Teacher"**.
- **MS Word (`.docx`) Manual Question Import**:
  - Remove/disable auto-generation of questions.
  - Include `mammoth.browser.min.js` CDN library in `teacher.html` for parsing `.docx` files directly in the browser.
  - Provide a structured MS Word `.docx` parser & interactive editor:
    - Teachers write questions in MS Word using standard format (e.g. `Q1: Question text`, `A) Option 1`, `B) Option 2`, `Answer: A`, `Marks: 1`).
    - Teachers upload their `.docx` file or paste Word content.
    - System parses questions, previews them in a table/card view for verification, allows quick editing, and inserts them directly into the question bank and exam.

---

## User Review Required

> [!IMPORTANT]
> **Database Reset Warning**:
> Executing the updated `setup-all.sql` script in Supabase will clean out previously registered test users so all users start fresh with Google Gmail registration.

> [!IMPORTANT]
> **Supabase Google OAuth Setup**:
> Under **Supabase Dashboard → Authentication → Providers → Google**, enable Google provider with your Google OAuth Client ID & Secret from Google Cloud Console.

---

## Proposed Database & Schema Changes (`supabase/setup-all.sql`)

```sql
-- 0. Clean reset of existing users and tables
TRUNCATE TABLE public.violations, public.locks, public.attempts, public.exam_questions, public.exams, public.question_bank, public.users CASCADE;
-- Delete existing auth users if permissions allow:
DELETE FROM auth.users;

-- 1. Add is_approved column and update user handler
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_approved boolean DEFAULT false;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_name text;
  v_reg text;
  v_staff text;
  v_approved boolean;
BEGIN
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'student');
  v_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  v_reg := nullif(new.raw_user_meta_data->>'register_number', '');
  v_staff := nullif(new.raw_user_meta_data->>'staff_id', '');
  
  -- Auto-approve students & admins; teachers require manual admin approval
  v_approved := (v_role != 'teacher');

  INSERT INTO public.users (id, name, register_number, staff_id, email, role, is_approved)
  VALUES (new.id, v_name, v_reg, v_staff, new.email, v_role, v_approved)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    email = EXCLUDED.email,
    is_approved = public.users.is_approved;
  RETURN new;
END;
$$;
```

---

## Detailed File Modifications

### 1. Auth Module (`js/auth.js`)
- Add `signInWithGoogle(role, extraMeta)` to handle OAuth login/signup.
- Add `checkTeacherApproval()` to block unapproved teachers.
- Keep standard login as fallback option.

### 2. Student Portal (`index.html`)
- Add **"Sign in with Google"** button for student login & registration.
- Add violation ban banner showing student's registered Gmail ID and status.

### 3. Teacher Portal (`teacher-login.html`, `teacher.html`, `js/teacher.js`)
- Add Google Login on `teacher-login.html`.
- Add pending approval alert if teacher is not approved yet.
- Include `mammoth.browser.min.js` script tag in `teacher.html`.
- Build **MS Word (.docx) Question Importer**:
  - File upload / drag-and-drop for `.docx`.
  - Parse Word text into structured questions (Question, Options A-D, Answer, Marks).
  - Preview & edit modal before saving questions.

### 4. Admin Portal (`admin.html`, `js/admin.js`)
- Add **"Teacher Approval Requests"** tab with Approve / Reject actions.
- Add **"Banned Students & Violation Locks"** tab with **"Unban / Allow Re-appear"** action.

---

## Verification Plan

### Automated & Manual Testing
1. **Database Reset**: Verify previous user records are cleared.
2. **Google OAuth & Teacher Approval**:
   - Register Teacher via Google -> verify pending status gates access.
   - Admin approves Teacher -> verify access is unlocked.
3. **MS Word Import**: Upload sample `.docx` question file and verify correct insertion into DB.
4. **Violation Ban & Admin Unban**:
   - Trigger violation ban -> verify student is locked out with Gmail display.
   - Admin unbans student -> verify student can re-take exam.
