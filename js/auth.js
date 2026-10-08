// js/auth.js — Pure localStorage multi-role authentication

// ─────────────────── Storage Key Constants ───────────────────
const LS_USERS       = 'EP_USERS';        // All registered users
const LS_SESSION     = 'EP_SESSION';      // Current logged-in user profile
const LS_ADMIN_PASS  = 'EP_ADMIN_PASS';   // Admin password hash

// ─────────────────── Utility ───────────────────

function _getUsers() {
  try { return JSON.parse(localStorage.getItem(LS_USERS)) || []; } catch (_) { return []; }
}

function _saveUsers(users) {
  try { localStorage.setItem(LS_USERS, JSON.stringify(users)); } catch (_) {}
}

function _getSession() {
  try { return JSON.parse(localStorage.getItem(LS_SESSION)); } catch (_) { return null; }
}

function _saveSession(profile) {
  try {
    if (profile) {
      localStorage.setItem(LS_SESSION, JSON.stringify(profile));
      localStorage.setItem('ST_ACTIVE_USER_PROFILE', JSON.stringify(profile));
    } else {
      localStorage.removeItem(LS_SESSION);
      localStorage.removeItem('ST_ACTIVE_USER_PROFILE');
    }
  } catch (_) {}
}

function _generateId() {
  return 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// ─────────────────── Bootstrap default data ───────────────────

function _ensureDefaultData() {
  const users = _getUsers();
  
  // Seed default teacher if none exists
  if (!users.some(u => u.role === 'teacher')) {
    users.push({
      id: 'u-teacher-default',
      name: 'Dr. Priya S',
      register_number: null,
      staff_id: 'TCH-1042',
      email: 'teacher@examportal.local',
      password_hash: hashPassword('teacher123'),
      role: 'teacher',
      is_approved: true,
      created_at: new Date().toISOString(),
    });
  }

  // Seed default admin if none exists
  if (!users.some(u => u.role === 'admin')) {
    users.push({
      id: 'u-admin-default',
      name: 'Master Admin',
      register_number: null,
      staff_id: 'ADM-001',
      email: MASTER_ADMIN_EMAIL,
      password_hash: hashPassword('admin123'),
      role: 'admin',
      is_approved: true,
      created_at: new Date().toISOString(),
    });
  }

  _saveUsers(users);
}

// Run bootstrap on load
_ensureDefaultData();

// ─────────────────── Session ───────────────────

async function getSession() {
  const profile = _getSession();
  return profile ? { user: { id: profile.id, email: profile.email } } : null;
}

async function getCurrentProfile() {
  const profile = _getSession();
  return profile || null;
}

async function requireRole(allowedRoles) {
  const profile = _getSession();
  if (profile && allowedRoles.includes(profile.role)) return profile;
  // Also check ST_ACTIVE_USER_PROFILE (used by some pages)
  try {
    const saved = localStorage.getItem('ST_ACTIVE_USER_PROFILE');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && allowedRoles.includes(parsed.role)) return parsed;
    }
  } catch (_) {}
  return null;
}

// ─────────────────── Student Auth ───────────────────

async function signUpStudent({ name, registerNumber, password }) {
  const regClean = String(registerNumber).trim();
  const nameClean = name.trim();
  if (!nameClean) throw new Error('Candidate Name is required.');
  if (!regClean) throw new Error('Register Number is required.');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const users = _getUsers();
  const email = studentEmailFromRegister(regClean);

  const existing = users.find(u => u.register_number === regClean && u.role === 'student');
  if (existing) {
    throw new Error('An account with this Register Number already exists. Please switch to "Sign In" to proceed.');
  }

  const newUser = {
    id: _generateId(),
    name: nameClean,
    register_number: regClean,
    staff_id: null,
    email,
    password_hash: hashPassword(password),
    role: 'student',
    is_approved: false, // Requires teacher/admin approval
    created_at: new Date().toISOString(),
  };
  users.push(newUser);
  _saveUsers(users);

  // Sync into demo store for teacher dashboard display
  const demoUsers = getDemoStore('ST_DEMO_USERS', DEFAULT_DEMO_USERS) || [];
  const idx = demoUsers.findIndex(u => u.register_number === regClean);
  const demoEntry = { id: newUser.id, name: nameClean, register_number: regClean, email, role: 'student', is_approved: false, created_at: newUser.created_at };
  if (idx >= 0) { demoUsers[idx] = { ...demoUsers[idx], ...demoEntry }; }
  else { demoUsers.unshift(demoEntry); }
  setDemoStore('ST_DEMO_USERS', demoUsers);

  return true;
}

async function signInStudent({ registerNumber, password }) {
  const regClean = String(registerNumber).trim();
  const users = _getUsers();
  const user = users.find(u => u.register_number === regClean && u.role === 'student');

  if (!user) {
    throw new Error('No student account found for this Register Number. Please register first.');
  }

  if (!verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid login credentials. Please check your Register Number and password.');
  }

  if (!user.is_approved) {
    throw new Error('PENDING_APPROVAL: Your account is awaiting approval from your Teacher or Administrator. You will be able to sign in once approved.');
  }

  const profile = {
    id: user.id,
    name: user.name,
    register_number: user.register_number,
    staff_id: null,
    email: user.email,
    role: 'student',
    is_approved: true,
    created_at: user.created_at,
  };
  _saveSession(profile);
  return { session: { user: { id: profile.id, email: profile.email } }, profile };
}

// ─────────────────── Staff Auth ───────────────────

async function signUpStaff({ name, email, staffId, password, role }) {
  if (role === 'admin') {
    throw new Error('Public registration for administrator accounts is disabled.');
  }
  if (!['teacher'].includes(role)) throw new Error('Invalid staff role.');

  const emailClean = email.trim().toLowerCase();
  const staffClean = String(staffId).trim();
  const nameClean = name.trim();

  const users = _getUsers();
  const existing = users.find(u => u.email === emailClean && u.role === 'teacher');
  if (existing) {
    throw new Error('A teacher account with this email already exists. Please sign in instead.');
  }

  const newUser = {
    id: _generateId(),
    name: nameClean,
    register_number: null,
    staff_id: staffClean,
    email: emailClean,
    password_hash: hashPassword(password),
    role: 'teacher',
    is_approved: false, // Requires admin approval
    created_at: new Date().toISOString(),
  };
  users.push(newUser);
  _saveUsers(users);

  // Sync into demo store
  const demoUsers = getDemoStore('ST_DEMO_USERS', DEFAULT_DEMO_USERS) || [];
  demoUsers.unshift({ id: newUser.id, name: nameClean, staff_id: staffClean, email: emailClean, role: 'teacher', is_approved: false, created_at: newUser.created_at });
  setDemoStore('ST_DEMO_USERS', demoUsers);

  return true;
}

async function signInStaff({ email, password, expectedRole }) {
  const emailClean = email.trim().toLowerCase();
  const users = _getUsers();
  const user = users.find(u => u.email === emailClean && u.role === expectedRole);

  if (!user) {
    throw new Error(`No ${expectedRole} account found for this email. Please register first.`);
  }

  if (!verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid login credentials. Please check your email and password.');
  }

  if (expectedRole === 'teacher' && !user.is_approved) {
    throw new Error('PENDING_APPROVAL: Your teacher account is awaiting administrator approval before you can access the faculty dashboard.');
  }

  const profile = {
    id: user.id,
    name: user.name,
    register_number: null,
    staff_id: user.staff_id,
    email: user.email,
    role: user.role,
    is_approved: user.is_approved,
    created_at: user.created_at,
  };
  _saveSession(profile);
  return { session: { user: { id: profile.id, email: profile.email } }, profile };
}

// ─────────────────── Sign Out ───────────────────

async function signOut() {
  _saveSession(null);
  if (typeof clearState === 'function') clearState();
}

// ─────────────────── Error Messages ───────────────────

function authErrorMessage(err) {
  if (!err) return 'Unknown error';
  const msg = err.message || String(err);
  if (msg.includes('PENDING_APPROVAL')) {
    return msg.includes('teacher account')
      ? '⏳ Your teacher account is awaiting administrator approval. You will be able to sign in once an admin approves you in the Admin Control Room.'
      : '⏳ Your account is awaiting approval from your Teacher or Administrator. You cannot sign in until your account is approved. Please contact your teacher.';
  }
  if (msg.includes('Invalid login credentials') || msg.includes('No student account') || msg.includes('No teacher') || msg.includes('No admin')) {
    return msg;
  }
  if (msg.includes('already exists') || msg.includes('already registered')) return msg;
  return msg;
}

// Stub for any legacy Google OAuth references (not supported in local mode)
async function signInWithGoogle() {
  throw new Error('Google OAuth is not available in local storage mode. Please use email/password login.');
}

function setFastOfflineMode() {
  // No-op in local mode — we're always "online" (to localStorage)
}
