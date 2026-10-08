/**
 * Online Exam Portal with Anti Cheating System
 * Local Storage Configuration — No external database required.
 *
 * AUTH MODEL:
 * - Students authenticate with register_number + password (stored locally).
 * - Teachers use email + password (stored locally).
 * - Admin uses a hardcoded master credential (stored locally).
 *
 * All data is persisted in browser localStorage.
 */

const APP_NAME = 'Online Exam Portal with Anti Cheating System';
const APP_SHORT = 'ExamPortal';

const STUDENT_EMAIL_DOMAIN = 'students.examportal.local';

// NVIDIA AI Proctoring Configuration (optional — UI only, no server calls)
const NVIDIA_API_KEY = ''; // Not required for local mode
const NVIDIA_LOCATEANYTHING_ENDPOINT = 'https://ai.api.nvidia.com/v1/cv/nvidia/locateanything-3b';
const NVIDIA_CONFIDENCE_THRESHOLD = 0.45;
const NVIDIA_TARGET_PROMPTS = ['cell phone', 'second person', 'person', 'earbuds', 'headphones', 'notes', 'cheat sheet'];

// Master admin credentials (local only)
const MASTER_ADMIN_EMAIL = 'admin@examportal.local';
const MASTER_ADMIN_PASSWORD_HASH_KEY = 'EXAM_PORTAL_ADMIN_HASH';

function studentEmailFromRegister(registerNumber) {
  const cleaned = String(registerNumber).trim().toLowerCase().replace(/\s+/g, '');
  return `${cleaned}@${STUDENT_EMAIL_DOMAIN}`;
}

/** Always returns true — we are always in local storage mode */
function isSupabaseConfigured() {
  return true; // Local mode is always "configured"
}

/** Always returns false — we never fall back; local storage IS the primary store */
function isOfflineDemoMode() {
  return false; // Not a demo, this IS the real storage
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Simple password hashing using a deterministic string transform (not cryptographic — for demo use) */
function hashPassword(password) {
  // Simple obfuscation: base64 of reversed password + salt
  const salted = 'EXAM_SALT_2026::' + password.split('').reverse().join('');
  return btoa(salted);
}

function verifyPassword(password, hash) {
  return hashPassword(password) === hash;
}
