// js/state.js - Session state + route guards (Supabase-backed exam flow)

const STATE_KEY = 'secure_test_session_state';
const MAX_VIOLATIONS = 3;

function getState() {
  const data = sessionStorage.getItem(STATE_KEY);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    console.error('Error parsing state from storage', e);
    return null;
  }
}

function saveState(state) {
  sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function clearState() {
  sessionStorage.removeItem(STATE_KEY);
}

/**
 * Initialize student exam session after auth + exam lookup.
 * questions: array of { id, q, options, marks } — NO correct answers
 */
function initState({
  name,
  roll,
  examCode,
  examId,
  examTitle,
  durationMinutes,
  questions,
  attemptId,
}) {
  const qCount = questions.length;
  const durationSeconds = (durationMinutes || 15) * 60;
  const state = {
    name,
    roll,
    examCode,
    examId,
    examTitle: examTitle || examCode,
    attemptId: attemptId || null,
    questions, // safe payload only
    idCardPhoto: '',
    selfiePhoto: '',
    idCardPhotoUrl: null,
    selfiePhotoUrl: null,
    verified: false,
    consented: false,
    current: 0,
    answers: new Array(qCount).fill(null), // option indexes locally
    flagged: new Array(qCount).fill(false),
    violations: [],
    durationSeconds,
    timeLeft: durationSeconds,
    timerActive: false,
    startedAt: null,
    submitted: false,
    score: null,
    maxScore: qCount,
    fullscreenExitIsSelf: false,
    submitReason: null,
    elapsedSeconds: 0,
    locked: false,
  };
  saveState(state);
  return state;
}

function getQuestions() {
  const state = getState();
  return (state && state.questions) || [];
}

function buildAnswersPayload(state) {
  // Map question UUID → selected option index for server scoring
  const payload = {};
  const questions = state.questions || [];
  questions.forEach((q, i) => {
    if (state.answers[i] !== null && state.answers[i] !== undefined) {
      payload[q.id] = state.answers[i];
    }
  });
  return payload;
}

function mapViolationType(typeLabel) {
  const t = (typeLabel || '').toLowerCase();
  if (t.includes('tab') || t.includes('minimized') || t.includes('navigat')) return 'tab_switch';
  if (t.includes('fullscreen')) return 'fullscreen_exit';
  if (t.includes('developer') || t.includes('devtools') || t.includes('inspect')) return 'devtools';
  if (t.includes('copy') || t.includes('cut') || t.includes('paste')) return 'copy_paste';
  if (t.includes('camera') || t.includes('face')) return 'camera';
  if (t.includes('gaze')) return 'shortcut';
  if (t.includes('ai security') || t.includes('prohibited item') || t.includes('unauthorized person')) {
    return 'camera';
  }
  if (t.includes('shortcut') || t.includes('keyboard')) return 'shortcut';
  return 'tab_switch';
}

function guardPage(step) {
  const state = getState();

  if (step === 0) return;

  if (step === 1) {
    if (!state || !state.name || !state.roll || !state.examId) {
      window.location.replace('index.html');
      return;
    }
    if (state.locked) {
      window.location.replace('index.html');
      return;
    }
  }

  if (step === 2) {
    if (!state || !state.name || !state.roll || !state.examId) {
      window.location.replace('index.html');
      return;
    }
    if (!state.verified) {
      window.location.replace('verify.html');
      return;
    }
  }

  if (step === 3) {
    if (!state || !state.name || !state.roll || !state.examId) {
      window.location.replace('index.html');
      return;
    }
    if (!state.verified) {
      window.location.replace('verify.html');
      return;
    }
    if (!state.consented) {
      window.location.replace('rules.html');
      return;
    }
    if (state.submitted) {
      window.location.replace('result.html');
      return;
    }
  }

  if (step === 4) {
    if (!state || !state.submitted) {
      window.location.replace('index.html');
      return;
    }
  }
}
