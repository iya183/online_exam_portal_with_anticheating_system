/**
 * Copy this file to js/config.js and fill in your Supabase project values.
 * Dashboard → Project Settings → API
 */
const SUPABASE_URL = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

const STUDENT_EMAIL_DOMAIN = 'students.securetest.com';

function studentEmailFromRegister(registerNumber) {
  const cleaned = String(registerNumber).trim().toLowerCase().replace(/\s+/g, '');
  return `${cleaned}@${STUDENT_EMAIL_DOMAIN}`;
}

function isSupabaseConfigured() {
  return (
    SUPABASE_URL &&
    !SUPABASE_URL.includes('YOUR_PROJECT_REF') &&
    !SUPABASE_URL.includes('xxxxxxxxxxxx') &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE_ANON_KEY') &&
    !SUPABASE_ANON_KEY.endsWith('...')
  );
}
