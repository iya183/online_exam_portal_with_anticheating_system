-- Optional seed helpers (run AFTER creating auth users via the app UI or Auth dashboard)
-- Example: promote an existing user to admin by email
-- update public.users set role = 'admin', staff_id = coalesce(staff_id, 'ADM-001')
-- where email = 'admin@college.edu';

-- Demo note:
-- 1. Create a Supabase project
-- 2. Run migrations 001 → 002 → 003 in the SQL Editor (in order)
-- 3. Set js/config.js SUPABASE_URL and SUPABASE_ANON_KEY
-- 4. In Auth settings, for local demos: disable "Confirm email" so register→login works immediately
-- 5. Register Teacher → create questions → create exam → Publish
-- 6. Register Student with register number → enter exam code → take exam
-- 7. Register Admin → unlock locked students as needed

-- Student auth mapping:
-- register_number "24131061" → email "24131061@students.securetest.local"
