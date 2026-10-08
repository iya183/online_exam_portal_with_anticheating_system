// js/api.js — Domain API over localStorage (exams, attempts, scoring, locks)
// No Supabase. All data persisted in browser localStorage.

// ─────────────────── Storage Key Constants ───────────────────
const LS_QUESTIONS = 'ST_DEMO_QUESTIONS';
const LS_EXAMS     = 'ST_DEMO_EXAMS';
const LS_ATTEMPTS  = 'ST_DEMO_ATTEMPTS';
const LS_LOCKS     = 'ST_DEMO_LOCKS';
const LS_USERS_KEY = 'ST_DEMO_USERS';

// ─────────────────── Default Seed Data ───────────────────

const DEFAULT_DEMO_QUESTIONS = [
  { id: 'q-demo-1', question_text: 'What does HTML stand for?', options: ['Hyper Text Markup Language', 'High Tech Modern Language', 'Hyperlink Text Manipulation Language', 'Home Tool Markup Language'], correct_option: 0, marks: 1, negative_marking_value: 0, topic: 'HTML', created_at: new Date().toISOString() },
  { id: 'q-demo-2', question_text: 'Which CSS property is used to change the background color of an element?', options: ['color', 'background-color', 'bgcolor', 'canvas-color'], correct_option: 1, marks: 1, negative_marking_value: 0, topic: 'CSS', created_at: new Date().toISOString() },
  { id: 'q-demo-3', question_text: 'What is the correct HTML element for inserting a JavaScript file?', options: ['<script src="app.js">', '<javascript src="app.js">', '<script href="app.js">', '<js file="app.js">'], correct_option: 0, marks: 1, negative_marking_value: 0, topic: 'JavaScript', created_at: new Date().toISOString() },
  { id: 'q-demo-4', question_text: 'Which HTTP status code indicates a successful GET request?', options: ['200 OK', '404 Not Found', '500 Internal Server Error', '301 Moved Permanently'], correct_option: 0, marks: 1, negative_marking_value: 0, topic: 'HTTP', created_at: new Date().toISOString() },
  { id: 'q-demo-5', question_text: 'Which array method in JavaScript creates a new array with all elements that pass a test?', options: ['map()', 'filter()', 'forEach()', 'reduce()'], correct_option: 1, marks: 1, negative_marking_value: 0, topic: 'JavaScript', created_at: new Date().toISOString() },
];

const DEFAULT_DEMO_EXAMS = [
  { id: 'demo-exam-id-wdf-2026', exam_code: 'WDF-2026', title: 'Web Development Fundamentals Exam 2026', duration_minutes: 15, status: 'published', is_locked: false, created_at: new Date().toISOString() },
];

const DEFAULT_DEMO_USERS = [
  { id: 'u-student-1', name: 'Demo Student', register_number: '24131061', staff_id: null, email: '24131061@students.examportal.local', role: 'student', is_approved: true, created_at: new Date().toISOString() },
  { id: 'u-teacher-default', name: 'Dr. Priya S', register_number: null, staff_id: 'TCH-1042', email: 'teacher@examportal.local', role: 'teacher', is_approved: true, created_at: new Date().toISOString() },
  { id: 'u-admin-default', name: 'Master Admin', register_number: null, staff_id: 'ADM-001', email: 'admin@examportal.local', role: 'admin', is_approved: true, created_at: new Date().toISOString() },
];

const DEFAULT_DEMO_LOCKS = [];
const DEFAULT_DEMO_ATTEMPTS = [];

// Also set up demo exam questions map
const _DEMO_EXAM_QUESTIONS = {
  'demo-exam-id-wdf-2026': ['q-demo-1', 'q-demo-2', 'q-demo-3', 'q-demo-4', 'q-demo-5'],
};

// ─────────────────── LocalStorage Helpers ───────────────────

function getDemoStore(key, defaultData) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    localStorage.setItem(key, JSON.stringify(defaultData));
    return defaultData;
  } catch (e) {
    return defaultData;
  }
}

function setDemoStore(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
}

// ─────────────────── Exam Lookup ───────────────────

async function lookupPublishedExam(examCode) {
  const cleanCode = (examCode || '').trim().toUpperCase();
  const exams = getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
  const found = exams.find(e => e.exam_code === cleanCode && e.status === 'published');
  if (!found) throw new Error('No published exam found for code: ' + cleanCode);
  return found;
}

async function fetchExamQuestions(examId) {
  const allQuestions = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  
  // Look for exam_questions links stored separately
  const examQLinks = getDemoStore('EP_EXAM_QUESTIONS', {});
  let questionIds = examQLinks[examId] || _DEMO_EXAM_QUESTIONS[examId] || null;
  
  let questions;
  if (questionIds) {
    questions = questionIds
      .map(qid => allQuestions.find(q => q.id === qid))
      .filter(Boolean);
  } else {
    // Fallback: return all questions if no link found
    questions = allQuestions;
  }

  if (!questions || questions.length === 0) {
    throw new Error('This exam has no questions yet. Contact your teacher.');
  }

  return questions.map((row, i) => ({
    id: row.id,
    q: row.question_text,
    options: row.options,
    marks: Number(row.marks),
    position: i,
  }));
}

// ─────────────────── Locking ───────────────────

async function checkStudentLock(examId) {
  let user = null;
  if (typeof getCurrentProfile === 'function') user = await getCurrentProfile();
  if (!user) {
    try {
      const saved = localStorage.getItem('ST_ACTIVE_USER_PROFILE');
      if (saved) user = JSON.parse(saved);
    } catch (_) {}
  }
  const state = (typeof getState === 'function' ? getState() : null) || {};
  user = user || {};

  const uId = user.id || state.studentId;
  const uRoll = user.register_number || state.roll;
  const uEmail = user.email || (uRoll ? studentEmailFromRegister(uRoll) : null);

  const locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  const foundLock = examId
    ? locks.find(l =>
        (l.exam_id === examId || l.exams?.id === examId) &&
        (
          (uId && (l.student_id === uId || l.users?.id === uId)) ||
          (uEmail && l.users?.email === uEmail) ||
          (uRoll && l.users?.register_number === uRoll)
        ) &&
        l.is_locked !== false
      )
    : null;
  if (foundLock) return { locked: true, lockedAt: foundLock.locked_at };

  const attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  const foundAttempt = examId
    ? attempts.find(a =>
        (a.exam_id === examId || a.exams?.id === examId) &&
        (
          (uId && (a.student_id === uId || a.users?.id === uId)) ||
          (uEmail && a.users?.email === uEmail) ||
          (uRoll && a.users?.register_number === uRoll)
        ) &&
        (a.status === 'violated' || a.status === 'disqualified')
      )
    : null;
  if (foundAttempt) return { locked: true, lockedAt: foundAttempt.submitted_at || foundAttempt.started_at };

  return { locked: false };
}

function syncDemoLock(examId, studentId, userObj, examObj) {
  let user = userObj;
  if (!user) {
    try {
      const saved = localStorage.getItem('ST_ACTIVE_USER_PROFILE');
      if (saved) user = JSON.parse(saved);
    } catch (_) {}
  }
  const state = (typeof getState === 'function' ? getState() : null) || {};
  user = user || {};

  const sRoll = state.roll || user.register_number;
  const sName = state.name || user.name || 'Student Candidate';
  const sEmail = user.email || (sRoll ? studentEmailFromRegister(sRoll) : 'student@examportal.local');
  const sId = studentId || user.id || state.studentId || (sRoll ? 'demo-student-' + sRoll : 'u-student-1');
  const eId = examId || state.examId || 'demo-exam-id-wdf-2026';
  const eCode = state.examCode || 'WDF-2026';
  const eTitle = state.examTitle || 'Web Development Fundamentals Exam';

  let locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  const newLock = {
    student_id: sId,
    exam_id: eId,
    is_locked: true,
    locked_at: new Date().toISOString(),
    users: { id: sId, name: sName, register_number: sRoll, email: sEmail, role: 'student' },
    exams: examObj || { id: eId, exam_code: eCode, title: eTitle },
  };

  const idx = locks.findIndex(l =>
    (l.student_id === sId || l.users?.id === sId || (sRoll && l.users?.register_number === sRoll) || (sEmail && l.users?.email === sEmail)) &&
    (l.exam_id === eId || l.exams?.id === eId)
  );
  if (idx >= 0) locks[idx] = newLock; else locks.unshift(newLock);
  setDemoStore(LS_LOCKS, locks);

  let attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  const attIdx = attempts.findIndex(a =>
    (a.student_id === sId || a.users?.id === sId || (sRoll && a.users?.register_number === sRoll) || (sEmail && a.users?.email === sEmail)) &&
    (a.exam_id === eId || a.exams?.id === eId)
  );
  if (attIdx >= 0) {
    attempts[attIdx].status = 'violated';
  } else {
    attempts.unshift({
      id: 'att-viol-' + Date.now(),
      student_id: sId,
      exam_id: eId,
      status: 'violated',
      score: state.score || 0,
      max_score: state.maxScore || 5,
      started_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      submit_reason: 'Automated lockout due to proctoring violations.',
      users: newLock.users,
      exams: newLock.exams,
    });
  }
  setDemoStore(LS_ATTEMPTS, attempts);
}

// ─────────────────── Attempt ───────────────────

async function startAttempt(examId, idCardUrl, selfieUrl) {
  const lock = await checkStudentLock(examId);
  if (lock.locked) throw new Error('LOCKED: You are locked out of this exam pending admin review');

  const attemptId = 'att-' + Date.now();
  // Store pending attempt in state; actual save on submit
  return attemptId;
}

async function uploadVerificationPhoto(userId, kind, dataUrl) {
  // In local mode, photos are stored as base64 in localStorage (or just returned as-is)
  const key = `EP_PHOTO_${userId}_${kind}`;
  try { localStorage.setItem(key, dataUrl); } catch (_) {}
  return dataUrl;
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const binary = atob(parts[1]);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ─────────────────── Violations ───────────────────

async function recordViolation(attemptId, type, message) {
  const state = (typeof getState === 'function' ? getState() : null) || {};
  const vCount = ((state.violations || []).length) + 1;
  const isAutoLocked = vCount >= 3;
  if (isAutoLocked) syncDemoLock(state.examId, state.studentId);
  return { count: vCount, autoLocked: isAutoLocked };
}

// ─────────────────── Submit ───────────────────

async function submitAttemptServer(attemptId, answersMap, reason, forceViolated) {
  const state = (typeof getState === 'function' ? getState() : null) || {};
  const questions = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  const isViolated = !!forceViolated || ((state.violations || []).length) >= 3;

  // Calculate score
  let score = 0;
  let maxScore = 0;
  (state.questions || []).forEach(q => {
    maxScore += (q.marks || 1);
    const answered = answersMap[q.id];
    const fullQ = questions.find(fq => fq.id === q.id);
    if (answered !== undefined && answered !== null && fullQ) {
      if (Number(answered) === Number(fullQ.correct_option)) {
        score += (q.marks || 1);
      } else if (fullQ.negative_marking_value > 0) {
        score -= fullQ.negative_marking_value;
      }
    }
  });
  score = Math.max(0, score);

  const status = isViolated ? 'violated' : 'submitted';

  // Persist attempt
  let user = null;
  if (typeof getCurrentProfile === 'function') user = await getCurrentProfile();
  if (!user) {
    try { user = JSON.parse(localStorage.getItem('ST_ACTIVE_USER_PROFILE')); } catch (_) {}
  }
  user = user || {};

  const sId = state.studentId || user.id || 'u-student-1';
  const sRoll = state.roll || user.register_number;
  const sName = state.name || user.name || 'Student';
  const sEmail = user.email || studentEmailFromRegister(sRoll || '');
  const eId = state.examId || 'demo-exam-id-wdf-2026';
  const eCode = state.examCode || 'WDF-2026';
  const eTitle = state.examTitle || 'Exam';

  const exams = getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
  const examObj = exams.find(e => e.id === eId) || { id: eId, exam_code: eCode, title: eTitle };

  const attemptRecord = {
    id: attemptId || ('att-' + Date.now()),
    student_id: sId,
    exam_id: eId,
    status,
    score,
    max_score: maxScore,
    started_at: state.startedAt || new Date().toISOString(),
    submitted_at: new Date().toISOString(),
    submit_reason: reason || 'Candidate finalized test.',
    violation_count: (state.violations || []).length,
    violations: state.violations || [],
    users: { id: sId, name: sName, register_number: sRoll, email: sEmail, role: 'student' },
    exams: examObj,
  };

  let attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  // Replace existing attempt for same student+exam or prepend
  const existingIdx = attempts.findIndex(a =>
    (a.student_id === sId || a.users?.id === sId) &&
    (a.exam_id === eId || a.exams?.id === eId) &&
    a.status !== 'violated' && a.status !== 'disqualified'
  );
  if (existingIdx >= 0) attempts[existingIdx] = attemptRecord;
  else attempts.unshift(attemptRecord);
  setDemoStore(LS_ATTEMPTS, attempts);

  if (isViolated) syncDemoLock(eId, sId, user, examObj);

  return {
    score,
    maxScore,
    status,
    violationCount: (state.violations || []).length,
  };
}

// ─────────────────── Teacher — Questions ───────────────────

async function listMyQuestions() {
  return getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
}

async function createQuestion(payload) {
  const list = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  const newQ = {
    id: 'q-' + Date.now(),
    question_text: payload.question_text,
    options: payload.options,
    correct_option: payload.correct_option,
    marks: payload.marks ?? 1,
    negative_marking_value: payload.negative_marking_value ?? 0,
    topic: payload.topic || null,
    created_at: new Date().toISOString(),
  };
  list.unshift(newQ);
  setDemoStore(LS_QUESTIONS, list);
  return newQ;
}

async function updateQuestion(id, payload) {
  const list = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  const idx = list.findIndex(q => q.id === id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...payload, updated_at: new Date().toISOString() };
    setDemoStore(LS_QUESTIONS, list);
    return list[idx];
  }
  return payload;
}

async function deleteQuestion(id, force = false) {
  let list = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  list = list.filter(q => q.id !== id);
  setDemoStore(LS_QUESTIONS, list);
}

async function deleteAllQuestions() {
  setDemoStore(LS_QUESTIONS, []);
}

async function bulkCreateQuestions(questions) {
  const list = getDemoStore(LS_QUESTIONS, DEFAULT_DEMO_QUESTIONS);
  const created = questions.map((q, idx) => ({
    id: 'q-word-' + Date.now() + '-' + idx,
    question_text: q.question_text,
    options: q.options,
    correct_option: q.correct_option,
    marks: q.marks ?? 1,
    negative_marking_value: q.negative_marking_value ?? 0,
    topic: q.topic || 'MS Word Import',
    created_at: new Date().toISOString(),
  }));
  list.unshift(...created);
  setDemoStore(LS_QUESTIONS, list);
  return created;
}

// ─────────────────── Teacher — Exams ───────────────────

async function listMyExams() {
  return getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
}

async function createExam({ exam_code, title, duration_minutes, questionIds }) {
  const list = getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
  const newExam = {
    id: 'exam-' + Date.now(),
    exam_code: exam_code.trim().toUpperCase(),
    title: title.trim(),
    duration_minutes: Number(duration_minutes),
    status: 'draft',
    is_locked: false,
    created_at: new Date().toISOString(),
  };
  list.unshift(newExam);
  setDemoStore(LS_EXAMS, list);

  if (questionIds && questionIds.length) {
    const examQLinks = getDemoStore('EP_EXAM_QUESTIONS', {});
    examQLinks[newExam.id] = questionIds;
    setDemoStore('EP_EXAM_QUESTIONS', examQLinks);
  }
  return newExam;
}

async function setExamStatus(examId, status) {
  const list = getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
  const idx = list.findIndex(e => e.id === examId);
  if (idx !== -1) {
    list[idx].status = status;
    if (status === 'draft') list[idx].is_locked = false;
    setDemoStore(LS_EXAMS, list);
    return list[idx];
  }
  return { id: examId, status };
}

async function deleteExam(examId) {
  let list = getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
  list = list.filter(e => e.id !== examId);
  setDemoStore(LS_EXAMS, list);
  // Also remove question links
  const examQLinks = getDemoStore('EP_EXAM_QUESTIONS', {});
  delete examQLinks[examId];
  setDemoStore('EP_EXAM_QUESTIONS', examQLinks);
}

async function deleteAllExams() {
  setDemoStore(LS_EXAMS, []);
  setDemoStore('EP_EXAM_QUESTIONS', {});
}

async function getExamQuestionIds(examId) {
  const examQLinks = getDemoStore('EP_EXAM_QUESTIONS', {});
  const ids = examQLinks[examId] || _DEMO_EXAM_QUESTIONS[examId] || [];
  return ids.map((qid, i) => ({ question_id: qid, position: i }));
}

async function replaceExamQuestions(examId, questionIds) {
  const examQLinks = getDemoStore('EP_EXAM_QUESTIONS', {});
  examQLinks[examId] = questionIds;
  setDemoStore('EP_EXAM_QUESTIONS', examQLinks);
}

async function listExamAttempts(examId) {
  const attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  return attempts.filter(a => a.exam_id === examId || a.exams?.id === examId);
}

async function listViolationsForAttempt(attemptId) {
  const attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  const attempt = attempts.find(a => a.id === attemptId);
  return (attempt && attempt.violations) ? attempt.violations : [];
}

// ─────────────────── Student Approval ───────────────────

async function teacherListPendingStudents() {
  const all = await teacherListAllStudents();
  return all.filter(s => !s.is_approved);
}

async function teacherListAllStudents() {
  // Merge EP_USERS (auth store) with ST_DEMO_USERS (display store)
  const authUsers = JSON.parse(localStorage.getItem('EP_USERS') || '[]').filter(u => u.role === 'student');
  const demoUsers = getDemoStore(LS_USERS_KEY, DEFAULT_DEMO_USERS).filter(u => u.role === 'student');
  const merged = [...authUsers];
  demoUsers.forEach(u => {
    if (!merged.some(m => m.id === u.id || (m.register_number && m.register_number === u.register_number))) {
      merged.push(u);
    }
  });
  return merged;
}

async function teacherApproveStudent(studentId, approve = true) {
  // Update EP_USERS (auth)
  const authUsers = JSON.parse(localStorage.getItem('EP_USERS') || '[]');
  const authIdx = authUsers.findIndex(u => u.id === studentId);
  if (authIdx !== -1) {
    if (approve) { authUsers[authIdx].is_approved = true; }
    else { authUsers.splice(authIdx, 1); }
    localStorage.setItem('EP_USERS', JSON.stringify(authUsers));
  }

  // Update ST_DEMO_USERS (display)
  const list = getDemoStore(LS_USERS_KEY, DEFAULT_DEMO_USERS);
  const idx = list.findIndex(u => u.id === studentId);
  if (idx !== -1) {
    if (approve) { list[idx].is_approved = true; }
    else { list.splice(idx, 1); }
    setDemoStore(LS_USERS_KEY, list);
  }
  return true;
}

async function teacherDeleteStudent(studentId) {
  return teacherApproveStudent(studentId, false);
}

// ─────────────────── Teacher — Violated/Banned ───────────────────

async function teacherListViolatedStudents() {
  const locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  const attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  const combined = [...locks.filter(l => l.is_locked !== false)];
  attempts.forEach(a => {
    if (a.status !== 'violated' && a.status !== 'disqualified') return;
    const studentId = a.student_id || a.users?.id;
    const examId = a.exam_id || a.exams?.id;
    const exists = combined.some(l =>
      (l.student_id === studentId || l.users?.id === studentId) &&
      (l.exam_id === examId || l.exams?.id === examId)
    );
    if (!exists) {
      combined.push({
        student_id: studentId,
        exam_id: examId,
        is_locked: true,
        locked_at: a.submitted_at || a.started_at || new Date().toISOString(),
        score: a.score,
        max_score: a.max_score,
        submit_reason: a.submit_reason,
        users: a.users || { id: studentId, name: 'Student', register_number: '', email: '' },
        exams: a.exams || { id: examId, exam_code: '', title: '' },
      });
    }
  });
  return combined;
}

async function teacherUnlockStudent(studentId, examId) {
  let locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  locks = locks.filter(l => !(
    (l.student_id === studentId || l.users?.id === studentId) &&
    (l.exam_id === examId || l.exams?.id === examId)
  ));
  setDemoStore(LS_LOCKS, locks);

  let attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  attempts = attempts.map(a => {
    if (
      (a.student_id === studentId || a.users?.id === studentId) &&
      (a.exam_id === examId || a.exams?.id === examId) &&
      (a.status === 'violated' || a.status === 'disqualified')
    ) { return { ...a, status: 'unlocked' }; }
    return a;
  });
  setDemoStore(LS_ATTEMPTS, attempts);
  return true;
}

// ─────────────────── Admin APIs ───────────────────

async function adminGetPendingTeachers() {
  const users = await adminListUsers();
  return users.filter(u => u.role === 'teacher' && !u.is_approved);
}

async function adminApproveTeacher(teacherId, approve = true) {
  // Update EP_USERS
  const authUsers = JSON.parse(localStorage.getItem('EP_USERS') || '[]');
  const authIdx = authUsers.findIndex(u => u.id === teacherId);
  if (authIdx !== -1) {
    if (approve) { authUsers[authIdx].is_approved = true; }
    else { authUsers.splice(authIdx, 1); }
    localStorage.setItem('EP_USERS', JSON.stringify(authUsers));
  }

  // Update ST_DEMO_USERS
  const list = getDemoStore(LS_USERS_KEY, DEFAULT_DEMO_USERS);
  const idx = list.findIndex(u => u.id === teacherId);
  if (idx !== -1) {
    if (approve) { list[idx].is_approved = true; }
    else { list.splice(idx, 1); }
    setDemoStore(LS_USERS_KEY, list);
  }
  return true;
}

async function adminListLocks() {
  const locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  const attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  const combined = [...locks];
  attempts.forEach(a => {
    if (a.status === 'violated' || a.status === 'disqualified') {
      const studentId = a.student_id || a.users?.id || 'u-student-1';
      const examId = a.exam_id || a.exams?.id || 'demo-exam-id-wdf-2026';
      const exists = combined.some(l =>
        (l.student_id === studentId || l.users?.id === studentId) &&
        (l.exam_id === examId || l.exams?.id === examId) && l.is_locked !== false
      );
      if (!exists) {
        combined.push({
          student_id: studentId,
          exam_id: examId,
          is_locked: true,
          locked_at: a.submitted_at || a.started_at || new Date().toISOString(),
          users: a.users || { id: studentId, name: 'Demo Student', register_number: '24131061', email: '24131061@students.examportal.local', role: 'student' },
          exams: a.exams || { id: examId, exam_code: 'WDF-2026', title: 'Web Development Fundamentals Exam 2026' },
        });
      }
    }
  });
  return combined.filter(l => l.is_locked !== false);
}

async function adminUnlock(studentId, examId) {
  let locks = getDemoStore(LS_LOCKS, DEFAULT_DEMO_LOCKS) || [];
  locks = locks.filter(l => !(
    (l.student_id === studentId || l.users?.id === studentId) &&
    (l.exam_id === examId || l.exams?.id === examId)
  ));
  setDemoStore(LS_LOCKS, locks);

  let attempts = getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS) || [];
  attempts = attempts.map(a => {
    if (
      (a.student_id === studentId || a.users?.id === studentId) &&
      (a.exam_id === examId || a.exams?.id === examId) &&
      (a.status === 'violated' || a.status === 'disqualified')
    ) { return { ...a, status: 'unlocked' }; }
    return a;
  });
  setDemoStore(LS_ATTEMPTS, attempts);
  return true;
}

async function adminListAllExams() {
  return getDemoStore(LS_EXAMS, DEFAULT_DEMO_EXAMS);
}

async function adminListAllAttempts() {
  return getDemoStore(LS_ATTEMPTS, DEFAULT_DEMO_ATTEMPTS);
}

async function adminListUsers() {
  const authUsers = JSON.parse(localStorage.getItem('EP_USERS') || '[]');
  const demoUsers = getDemoStore(LS_USERS_KEY, DEFAULT_DEMO_USERS);
  const merged = [...authUsers];
  demoUsers.forEach(u => {
    if (!merged.some(m =>
      m.id === u.id ||
      (m.register_number && u.register_number && m.register_number === u.register_number) ||
      (m.email && u.email && m.email === u.email)
    )) { merged.push(u); }
  });
  return merged;
}

async function adminDeleteUser(userId) {
  // Remove from EP_USERS
  let authUsers = JSON.parse(localStorage.getItem('EP_USERS') || '[]');
  authUsers = authUsers.filter(u => u.id !== userId);
  localStorage.setItem('EP_USERS', JSON.stringify(authUsers));

  // Remove from ST_DEMO_USERS
  let list = getDemoStore(LS_USERS_KEY, DEFAULT_DEMO_USERS);
  list = list.filter(u => u.id !== userId);
  setDemoStore(LS_USERS_KEY, list);
  return true;
}

// ─────────────────── Misc ───────────────────

function withFastTimeout(promise, ms = 5000) {
  // In local mode no timeouts needed, but keep the function for compatibility
  return promise;
}
