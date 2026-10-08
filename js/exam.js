// js/exam.js - Exam UI + server-side scoring (no correct answers on client)

(function () {
  guardPage(3);

  let state = getState();
  if (state && state.examId && typeof checkStudentLock === 'function') {
    checkStudentLock(state.examId).then((lock) => {
      if (lock && lock.locked) {
        state.locked = true;
        saveState(state);
        alert('🚫 Exam Access Banned: You are banned from retaking this exam due to proctoring violations. Please contact your Teacher — they can approve your unban via Teacher Dashboard → Banned Students.');
        window.location.replace('index.html');
      }
    }).catch(() => {});
  }

  const QUESTIONS = () => getQuestions();

  document.getElementById('hdr-name').textContent = state.name;
  document.getElementById('hdr-roll').textContent = 'ROLL NO. ' + state.roll;

  const examTitleEl = document.querySelector('.exam-header .center');
  if (examTitleEl && state.examTitle) examTitleEl.textContent = state.examTitle;

  const startOverlay = document.getElementById('start-overlay');
  const btnLaunchRoom = document.getElementById('btn-launch-room');
  const screenExam = document.getElementById('screen-exam');
  const qIndex = document.getElementById('q-index');
  const qText = document.getElementById('q-text');
  const qOptions = document.getElementById('q-options');
  const btnFlag = document.getElementById('btn-flag');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const btnSubmit = document.getElementById('btn-submit');
  const timerEl = document.getElementById('timer');
  const overlayViolation = document.getElementById('overlay-violation');
  const modalTitle = document.getElementById('modal-title');
  const modalText = document.getElementById('modal-text');
  const modalCount = document.getElementById('modal-count');
  const btnModalOk = document.getElementById('btn-modal-ok');

  let examCameraStream = null;
  let modalAutoSubmit = false;
  let submitting = false;

  // Initial timer display
  const m0 = Math.floor(state.timeLeft / 60).toString().padStart(2, '0');
  const s0 = (state.timeLeft % 60).toString().padStart(2, '0');
  timerEl.textContent = m0 + ':' + s0;

  if (state.timerActive) {
    document.getElementById('start-title').textContent = 'Resume Proctored Session';
    document.getElementById('start-text').textContent =
      'An active proctored exam is in progress. You must re-enter full-screen mode and activate camera monitoring to resume your session.';
    btnLaunchRoom.textContent = 'Resume Proctored Session →';
  }

  btnLaunchRoom.addEventListener('click', async () => {
    btnLaunchRoom.disabled = true;
    btnLaunchRoom.textContent = 'Starting…';

    try {
      await document.documentElement.requestFullscreen();
    } catch (e) {
      console.warn('Fullscreen request rejected', e);
    }

    await startProctorCamera();

    state = getState();

    // Create / resume attempt on server
    if (!state.attemptId) {
      try {
        const attemptId = await startAttempt(
          state.examId,
          state.idCardPhotoUrl,
          state.selfiePhotoUrl
        );
        state.attemptId = attemptId;
      } catch (err) {
        const msg = err.message || String(err);
        if (msg.includes('LOCKED')) {
          alert('🚫 Exam Access Banned: You are banned from retaking this exam due to proctoring violations. Please contact your Teacher — they can approve your unban via Teacher Dashboard → Banned Students.');
          window.location.href = 'index.html';
          return;
        }
        if (msg.includes('Only students can start attempts')) {
          alert('You are currently signed in with a Staff/Admin account (iyappanfintech@gmail.com). Exams can only be taken by Student accounts.\n\nYou will now be redirected to the Student Sign In page.');
          await signOut();
          window.location.href = 'index.html';
          return;
        }
        alert('Could not start attempt: ' + msg);
        btnLaunchRoom.disabled = false;
        btnLaunchRoom.textContent = 'Initialize Proctored Session →';
        return;
      }
    }

    state.timerActive = true;
    if (!state.startedAt) state.startedAt = Date.now();
    saveState(state);

    startOverlay.style.display = 'none';
    screenExam.style.display = 'block';

    renderQuestion();
    renderPalette();
    renderProctorLog();
    updateSealUI(state.violations.length);

    startExamTimer(updateTimerUI, handleTimeExpired);
    startProctoring(handleViolationLogged, handleAutoSubmit);
  });

  async function startProctorCamera() {
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
      } catch (firstErr) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      examCameraStream = stream;
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const camBox = document.getElementById('cam-box');
      camBox.innerHTML = '';
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      camBox.appendChild(video);
      try { await video.play(); } catch (_) {}

      const canvasOverlay = document.createElement('canvas');
      canvasOverlay.id = 'ai-webcam-canvas';
      canvasOverlay.style.position = 'absolute';
      canvasOverlay.style.top = '0';
      canvasOverlay.style.left = '0';
      canvasOverlay.style.width = '100%';
      canvasOverlay.style.height = '100%';
      canvasOverlay.style.pointerEvents = 'none';
      canvasOverlay.style.zIndex = '5';
      camBox.appendChild(canvasOverlay);

      const label = document.createElement('div');
      label.className = 'cam-label';
      label.innerHTML = '<span class="rec-dot"></span> MONITORING';
      camBox.appendChild(label);

      if (typeof startAiCameraProctoring === 'function') {
        startAiCameraProctoring(video, canvasOverlay);
      }
    } catch (e) {
      console.warn('Webcam access denied', e);
      document.getElementById('cam-box').innerHTML =
        '<div class="cam-off">Camera preview unavailable. Monitoring is suspended locally. This is logged as a violation.</div>';
      logViolation('Camera permission denied', 'Candidate did not provide webcam access.');
    }
  }

  function stopProctorCamera() {
    if (typeof stopAiCameraProctoring === 'function') {
      stopAiCameraProctoring();
    }
    if (examCameraStream) {
      examCameraStream.getTracks().forEach((track) => track.stop());
      examCameraStream = null;
    }
  }


  function renderQuestion() {
    state = getState();
    const qs = QUESTIONS();
    const idx = state.current;
    const item = qs[idx];
    if (!item) return;

    qIndex.textContent = `QUESTION ${idx + 1} OF ${qs.length}`;
    qText.textContent = item.q;
    btnFlag.classList.toggle('active', state.flagged[idx]);

    qOptions.innerHTML = '';
    (item.options || []).forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'option' + (state.answers[idx] === i ? ' selected' : '');
      div.setAttribute('role', 'radio');
      div.setAttribute('aria-checked', state.answers[idx] === i ? 'true' : 'false');
      div.innerHTML = `<span class="letter">${String.fromCharCode(65 + i)}</span><span>${opt}</span>`;
      div.addEventListener('click', () => {
        state.answers[idx] = i;
        saveState(state);
        renderQuestion();
        renderPalette();
      });
      qOptions.appendChild(div);
    });

    btnPrev.disabled = idx === 0;
    btnPrev.style.opacity = idx === 0 ? 0.4 : 1;
    btnNext.textContent = idx === qs.length - 1 ? 'Submit Exam' : 'Next →';
    btnNext.className = idx === qs.length - 1 ? 'btn btn-danger' : 'btn btn-ghost';
  }

  function renderPalette() {
    state = getState();
    const qs = QUESTIONS();
    const wrap = document.getElementById('palette');
    wrap.innerHTML = '';
    qs.forEach((_, i) => {
      const btn = document.createElement('div');
      let cls = 'pnum';
      if (i === state.current) cls += ' current';
      if (state.flagged[i]) cls += ' flagged';
      else if (state.answers[i] !== null) cls += ' answered';
      btn.className = cls;
      btn.textContent = i + 1;
      btn.addEventListener('click', () => {
        state.current = i;
        saveState(state);
        renderQuestion();
        renderPalette();
      });
      wrap.appendChild(btn);
    });
  }

  function renderProctorLog() {
    state = getState();
    const list = document.getElementById('log-list');
    document.getElementById('log-count').textContent = state.violations.length;
    if (state.violations.length === 0) {
      list.innerHTML = '<li class="log-empty">No violations recorded.</li>';
      return;
    }
    list.innerHTML = '';
    state.violations
      .slice()
      .reverse()
      .forEach((v) => {
        const li = document.createElement('li');
        const t = new Date(v.time).toLocaleTimeString();
        li.innerHTML = `<span class="msg">${v.type}</span><span class="time mono">${t}</span>`;
        list.appendChild(li);
      });
  }

  function updateSealUI(count) {
    const seal = document.getElementById('seal');
    seal.classList.remove('flag1', 'flag2', 'flag3');
    let svg, label;
    if (count === 0) {
      svg = '<path d="M20 6L9 17l-5-5"/>';
      label = 'SECURE';
    } else if (count === 1) {
      seal.classList.add('flag1');
      svg =
        '<path d="M12 9v3M12 16h.01M10.3 3.9L2 18a1.8 1.8 0 001.5 2.7h17a1.8 1.8 0 001.5-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z"/>';
      label = 'NOTED';
    } else if (count === 2) {
      seal.classList.add('flag2');
      svg =
        '<path d="M12 9v3M12 16h.01M10.3 3.9L2 18a1.8 1.8 0 001.5 2.7h17a1.8 1.8 0 001.5-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z"/>';
      label = 'WARNED';
    } else {
      seal.classList.add('flag3');
      svg =
        '<path d="M12 9v3M12 16h.01M10.3 3.9L2 18a1.8 1.8 0 001.5 2.7h17a1.8 1.8 0 001.5-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z"/>';
      label = 'FLAGGED';
    }
    seal.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">${svg}</svg>${label}`;
  }

  btnPrev.addEventListener('click', () => {
    state = getState();
    if (state.current > 0) {
      state.current--;
      saveState(state);
      renderQuestion();
      renderPalette();
    }
  });

  btnNext.addEventListener('click', () => {
    state = getState();
    const qs = QUESTIONS();
    if (state.current < qs.length - 1) {
      state.current++;
      saveState(state);
      renderQuestion();
      renderPalette();
    } else {
      confirmAndSubmit();
    }
  });

  btnFlag.addEventListener('click', () => {
    state = getState();
    state.flagged[state.current] = !state.flagged[state.current];
    saveState(state);
    renderQuestion();
    renderPalette();
  });

  btnSubmit.addEventListener('click', confirmAndSubmit);

  function confirmAndSubmit() {
    if (confirm('Are you sure you want to submit your examination now? This action is final and cannot be undone.')) {
      submitExam(false, 'Candidate finalized test.');
    }
  }

  function updateTimerUI(timeLeft) {
    const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
    const s = (timeLeft % 60).toString().padStart(2, '0');
    timerEl.textContent = m + ':' + s;
    timerEl.classList.toggle('warn', timeLeft <= 60);
  }

  function handleTimeExpired() {
    submitExam(true, 'Time limit exceeded.');
  }

  function handleViolationLogged(violation, count) {
    renderProctorLog();
    updateSealUI(count);
    if (count >= 3) {
      showViolationModal(
        'Final Violation — Auto-Submitting',
        violation.message + ' You have accumulated 3 proctoring violations. Your exam session is being auto-finalized and you are locked out of retaking this exam.',
        count,
        true
      );
    } else {
      const warnTitle = count === 1 ? 'Violation Logged' : 'Second Violation — Final Warning';
      showViolationModal(warnTitle, violation.message, count, false);
    }
  }

  function handleAutoSubmit(reason) {
    submitExam(true, reason, true);
  }

  function showViolationModal(title, text, count, autoSubmit) {
    modalTitle.textContent = title;
    modalText.textContent = text;
    modalCount.textContent = `Violation ${count} of 3`;
    modalAutoSubmit = autoSubmit;
    btnModalOk.textContent = autoSubmit ? 'Acknowledge Submission' : 'Return to Exam';
    // Force the overlay visible and fully interactive
    overlayViolation.style.display = 'flex';
    overlayViolation.style.pointerEvents = 'auto';
    overlayViolation.style.zIndex = '9999';
    overlayViolation.classList.add('active');
    overlayViolation.setAttribute('aria-hidden', 'false');
    // Auto-focus button so Enter key / tap works immediately
    setTimeout(() => { try { btnModalOk.focus(); } catch(_) {} }, 80);
  }

  /**
   * FIXED: Comprehensive modal dismiss that works on mouse, touch, and keyboard.
   * Also force-hides the overlay with display:none so it can NEVER block the screen
   * even if the CSS class removal fails for any reason.
   */
  function dismissViolationModal() {
    // Prevent double-fire
    if (overlayViolation.getAttribute('aria-hidden') === 'true') return;

    // Force-hide the overlay completely — removes ALL blocking of the screen
    overlayViolation.classList.remove('active');
    overlayViolation.setAttribute('aria-hidden', 'true');
    overlayViolation.style.display = 'none';        // belt
    overlayViolation.style.pointerEvents = 'none';  // braces
    overlayViolation.style.zIndex = '';

    if (modalAutoSubmit) {
      submitExam(true, 'Exam auto-submitted due to 3 proctoring violations.', true);
    } else {
      // Re-enter fullscreen after warning dismissal
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }
  }

  // Click (mouse)
  btnModalOk.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissViolationModal();
  });
  // Touchstart: mark the touch so touchend fires reliably
  btnModalOk.addEventListener('touchstart', (e) => {
    e.stopPropagation();
  }, { passive: true });
  // Touchend (mobile/tablet): prevent 300ms ghost-click delay
  btnModalOk.addEventListener('touchend', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissViolationModal();
  });
  // Keyboard: Enter or Space also dismiss
  btnModalOk.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dismissViolationModal();
    }
  });
  // Safety escape: pressing Escape on keyboard dismisses non-final modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayViolation.getAttribute('aria-hidden') === 'false' && !modalAutoSubmit) {
      dismissViolationModal();
    }
  });

  async function submitExam(auto, reason, forceViolated) {
    state = getState();
    if (state.submitted || submitting) return;
    submitting = true;

    // Stop everything immediately so no further violations or timer events fire
    stopExamTimer();
    stopProctoring();
    stopProctorCamera();

    state.fullscreenExitIsSelf = true;
    state.timerActive = false;
    saveState(state);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    const elapsedSeconds = state.startedAt
      ? Math.floor((Date.now() - state.startedAt) / 1000)
      : 0;

    let score = 0;
    let maxScore = QUESTIONS().length;

    // CRITICAL FIX: Server submission errors must NEVER freeze the exam screen.
    // We save answers locally first, attempt the server call, then navigate
    // to result.html regardless of success or failure. If the server call fails
    // the student still sees a result page and the admin can reconcile later.
    state.submitted = true;
    state.elapsedSeconds = elapsedSeconds;
    state.submitReason = reason;
    saveState(state); // save before server call so a crash can't re-open the exam

    try {
      if (state.attemptId) {
        const result = await submitAttemptServer(
          state.attemptId,
          buildAnswersPayload(state),
          reason,
          !!forceViolated || (state.violations.length >= MAX_VIOLATIONS)
        );
        score = result.score;
        maxScore = result.maxScore;
        if (result.status === 'violated') state.locked = true;
      }
    } catch (err) {
      // Log but DO NOT freeze — navigate to result.html with local score (0)
      console.error('[submitExam] Server scoring failed, navigating with local state:', err);
      score = 0;
      maxScore = QUESTIONS().length;
    }

    state.score = score;
    state.maxScore = maxScore;
    saveState(state);

    // Always navigate — this is the only exit point
    window.location.href = 'result.html';
  }
})();
