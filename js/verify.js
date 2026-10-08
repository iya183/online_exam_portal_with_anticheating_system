// js/verify.js - Photo Verification page logic (selfie/photo upload only)

(function() {
  // 1. Guard page access
  guardPage(1);

  // Retrieve current session state
  const state = getState();

  // Proactive lock/ban check
  if (state && state.examId && typeof checkStudentLock === 'function') {
    checkStudentLock(state.examId).then((lock) => {
      if (lock && lock.locked) {
        state.locked = true;
        saveState(state);
        alert('⚠️ Account Banned / Locked: Admin approval is required before taking this exam.');
        window.location.replace('index.html');
      }
    }).catch(() => {});
  }

  // Populate header info
  document.getElementById('candidate-meta').textContent = `${state.name} · ${state.roll}`;

  // DOM Elements — Selfie / Photo panel only
  const videoSelfie = document.getElementById('video-selfie');
  const imgSelfie = document.getElementById('img-selfie');
  const placeholderSelfie = document.getElementById('placeholder-selfie');
  const badgeSelfie = document.getElementById('badge-selfie');
  const controlsSelfieCam = document.getElementById('controls-selfie-cam');
  const controlsSelfieUpload = document.getElementById('controls-selfie-upload');
  const btnSelfieCapture = document.getElementById('btn-selfie-capture');
  const btnSelfieToUpload = document.getElementById('btn-selfie-to-upload');
  const btnSelfieToCam = document.getElementById('btn-selfie-to-cam');
  const btnSelfieSelectFile = document.getElementById('btn-selfie-select-file');
  const inputSelfieFile = document.getElementById('input-selfie-file');
  const btnSelfieReset = document.getElementById('btn-selfie-reset');

  const canvas = document.getElementById('hidden-canvas');
  const checkboxConfirm = document.getElementById('inp-verify-confirm');
  const btnProceed = document.getElementById('btn-verify-proceed');

  // Media stream reference to shut off webcam later
  let activeStream = null;
  let selfieMode = 'camera'; // 'camera' or 'upload'

  // Captured photo (base64)
  let capturedSelfiePhoto = '';

  // ---------------- Web Camera Initialization ----------------
  async function initWebcam() {
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
      activeStream = stream;

      if (selfieMode === 'camera' && !capturedSelfiePhoto) {
        videoSelfie.srcObject = stream;
        videoSelfie.muted = true;
        videoSelfie.playsInline = true;
        videoSelfie.style.display = 'block';
        placeholderSelfie.style.display = 'none';
        try { await videoSelfie.play(); } catch (_) {}
      }
    } catch (err) {
      console.warn('Webcam access failed/denied. Falling back to file upload.', err);
      switchToSelfieUpload();
    }
  }

  // Stop all camera tracks
  function stopWebcam() {
    if (activeStream) {
      activeStream.getTracks().forEach(track => track.stop());
      activeStream = null;
    }
  }

  // ---------------- Toggle Mode ----------------
  function switchToSelfieUpload() {
    selfieMode = 'upload';
    videoSelfie.style.display = 'none';
    videoSelfie.srcObject = null;
    imgSelfie.style.display = 'none';
    placeholderSelfie.style.display = 'flex';
    placeholderSelfie.querySelector('span').textContent = 'Please upload a photo image file';
    controlsSelfieCam.style.display = 'none';
    controlsSelfieUpload.style.display = 'flex';
    btnSelfieReset.style.display = 'none';
    if (!capturedSelfiePhoto) {
      badgeSelfie.className = 'status-badge pending';
      badgeSelfie.textContent = 'Pending';
    }
  }

  function switchToSelfieCam() {
    selfieMode = 'camera';
    placeholderSelfie.style.display = 'none';
    imgSelfie.style.display = 'none';
    controlsSelfieCam.style.display = 'flex';
    controlsSelfieUpload.style.display = 'none';
    btnSelfieReset.style.display = 'none';
    if (!capturedSelfiePhoto) {
      badgeSelfie.className = 'status-badge pending';
      badgeSelfie.textContent = 'Pending';
      if (activeStream) {
        videoSelfie.srcObject = activeStream;
        videoSelfie.muted = true;
        videoSelfie.playsInline = true;
        videoSelfie.style.display = 'block';
        videoSelfie.play().catch(() => {});
      } else {
        initWebcam();
      }
    }
  }

  // ---------------- Capture Snapshot ----------------
  function captureSnapshot() {
    if (!activeStream || videoSelfie.paused || videoSelfie.ended) return;

    const ctx = canvas.getContext('2d');
    canvas.width = videoSelfie.videoWidth || 640;
    canvas.height = videoSelfie.videoHeight || 480;
    ctx.drawImage(videoSelfie, 0, 0, canvas.width, canvas.height);
    const base64Data = canvas.toDataURL('image/jpeg', 0.85);

    capturedSelfiePhoto = base64Data;

    videoSelfie.style.display = 'none';
    imgSelfie.src = base64Data;
    imgSelfie.style.display = 'block';
    badgeSelfie.className = 'status-badge completed';
    badgeSelfie.textContent = 'Captured';
    controlsSelfieCam.style.display = 'none';
    btnSelfieReset.style.display = 'inline-flex';

    validateVerificationState();
  }

  // ---------------- File Upload ----------------
  function handleFileUpload() {
    const file = inputSelfieFile.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      capturedSelfiePhoto = e.target.result;

      placeholderSelfie.style.display = 'none';
      imgSelfie.src = capturedSelfiePhoto;
      imgSelfie.style.display = 'block';
      badgeSelfie.className = 'status-badge completed';
      badgeSelfie.textContent = 'Uploaded';
      controlsSelfieUpload.style.display = 'none';
      btnSelfieReset.style.display = 'inline-flex';

      validateVerificationState();
    };
    reader.readAsDataURL(file);
  }

  // ---------------- Reset Panel ----------------
  function resetSelfiePanel() {
    capturedSelfiePhoto = '';
    imgSelfie.style.display = 'none';
    imgSelfie.src = '';
    badgeSelfie.className = 'status-badge pending';
    badgeSelfie.textContent = 'Pending';
    btnSelfieReset.style.display = 'none';

    if (selfieMode === 'camera') {
      videoSelfie.style.display = 'block';
      controlsSelfieCam.style.display = 'flex';
      if (!activeStream) initWebcam();
    } else {
      placeholderSelfie.style.display = 'flex';
      controlsSelfieUpload.style.display = 'flex';
      inputSelfieFile.value = '';
    }
    validateVerificationState();
  }

  // ---------------- Page Validation ----------------
  function validateVerificationState() {
    const photoReady = capturedSelfiePhoto !== '';
    checkboxConfirm.disabled = !photoReady;

    if (!photoReady) {
      checkboxConfirm.checked = false;
    }

    btnProceed.disabled = !(photoReady && checkboxConfirm.checked);
  }

  // ---------------- Event Listeners ----------------
  btnSelfieCapture.addEventListener('click', captureSnapshot);

  if (btnSelfieToUpload) btnSelfieToUpload.addEventListener('click', switchToSelfieUpload);
  if (btnSelfieToCam) btnSelfieToCam.addEventListener('click', switchToSelfieCam);

  btnSelfieSelectFile.addEventListener('click', () => inputSelfieFile.click());
  inputSelfieFile.addEventListener('change', handleFileUpload);
  btnSelfieReset.addEventListener('click', resetSelfiePanel);

  checkboxConfirm.addEventListener('change', validateVerificationState);

  btnProceed.addEventListener('click', async () => {
    if (!(capturedSelfiePhoto && checkboxConfirm.checked)) return;

    btnProceed.disabled = true;
    btnProceed.textContent = 'Saving…';

    const sessionState = getState();
    sessionState.selfiePhoto = capturedSelfiePhoto;

    try {
      const profile = await getCurrentProfile();
      if (profile && isSupabaseConfigured()) {
        sessionState.selfiePhotoUrl = await uploadVerificationPhoto(profile.id, 'selfie', capturedSelfiePhoto);
      }
    } catch (err) {
      console.warn('Photo upload failed; keeping local preview only.', err);
    }

    sessionState.verified = true;
    saveState(sessionState);
    stopWebcam();
    window.location.href = 'rules.html';
  });

  // Start webcam automatically on page load
  initWebcam();
})();
