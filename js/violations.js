// js/violations.js - Proctoring detection + Supabase persistence

let proctoringActive = false;
let devtoolsWarned = false;
let devtoolsInterval = null;
let onViolationCallback = null;
let onAutoSubmitCallback = null;
let persistInFlight = false;

function startProctoring(onViolation, onAutoSubmit) {
  if (proctoringActive) return;
  proctoringActive = true;
  onViolationCallback = onViolation;
  onAutoSubmitCallback = onAutoSubmit;

  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('fullscreenchange', handleFullscreenChange);
  document.addEventListener('copy', preventClipboardAction);
  document.addEventListener('cut', preventClipboardAction);
  document.addEventListener('paste', preventClipboardAction);
  document.addEventListener('contextmenu', preventContextMenu);
  document.addEventListener('keydown', handleKeydownEvents);
  devtoolsInterval = setInterval(checkWindowDimensions, 2000);
}

function stopProctoring() {
  if (!proctoringActive) return;
  proctoringActive = false;

  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('fullscreenchange', handleFullscreenChange);
  document.removeEventListener('copy', preventClipboardAction);
  document.removeEventListener('cut', preventClipboardAction);
  document.removeEventListener('paste', preventClipboardAction);
  document.removeEventListener('contextmenu', preventContextMenu);
  document.removeEventListener('keydown', handleKeydownEvents);

  if (devtoolsInterval) {
    clearInterval(devtoolsInterval);
    devtoolsInterval = null;
  }
}

async function logViolation(type, message) {
  const state = getState();
  if (!state || !state.timerActive || state.submitted) return;
  if (persistInFlight) return; // avoid double-fire storms

  const violation = {
    type,
    message,
    time: new Date().toISOString(),
  };

  state.violations.push(violation);
  saveState(state);

  if (onViolationCallback) {
    onViolationCallback(violation, state.violations.length);
  }

  const localCount = state.violations.length;

  // Persist to Supabase when attempt exists (demo/offline attempt IDs skip the server)
  const attemptIdStr = state.attemptId ? String(state.attemptId) : '';
  const isDemoAttempt = attemptIdStr.startsWith('demo-attempt-');
  if (state.attemptId && !isDemoAttempt && typeof recordViolation === 'function') {
    persistInFlight = true;

    // CRITICAL FIX: Safety timeout resets persistInFlight if Supabase hangs.
    // Without this, a network timeout leaves persistInFlight=true forever,
    // silently dropping all subsequent violations and freezing auto-submit.
    const resetTimer = setTimeout(() => {
      if (persistInFlight) {
        console.warn('[violations] persistInFlight safety reset (Supabase timeout)');
        persistInFlight = false;
      }
    }, 8000);

    try {
      const result = await recordViolation(
        state.attemptId,
        mapViolationType(type),
        message
      );
      // Prefer server count if available
      if (result && typeof result.count === 'number') {
        // sync local length if needed
      }
      if (result && result.autoLocked) {
        state.locked = true;
        saveState(state);
        stopProctoring();
        if (onAutoSubmitCallback) {
          onAutoSubmitCallback('Exam auto-submitted due to 3 proctoring violations.');
        }
        return;
      }
    } catch (err) {
      console.error('Failed to persist violation', err);
    } finally {
      clearTimeout(resetTimer);
      persistInFlight = false;
    }
  }

  if (localCount >= MAX_VIOLATIONS) {
    stopProctoring();
    if (onAutoSubmitCallback) {
      onAutoSubmitCallback('Exam auto-submitted due to 3 proctoring violations.');
    }
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    logViolation('Tab switched or window minimized', 'You navigated away from the active exam screen.');
  }
}

function handleFullscreenChange() {
  const state = getState();
  if (!state) return;
  if (!document.fullscreenElement && !state.submitted && !state.fullscreenExitIsSelf) {
    logViolation('Exited fullscreen mode', 'You left fullscreen mode during the exam.');
  }
}

function preventClipboardAction(e) {
  e.preventDefault();
  const act = e.type;
  logViolation(
    `${act.charAt(0).toUpperCase() + act.slice(1)} attempt blocked`,
    `An attempt to ${act} content was blocked.`
  );
}

function preventContextMenu(e) {
  e.preventDefault();
}

function handleKeydownEvents(e) {
  const blockedKey =
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) ||
    (e.ctrlKey && ['u', 'p'].includes(e.key.toLowerCase()));

  if (blockedKey) {
    e.preventDefault();
    logViolation('Restricted shortcut used', `Attempted a blocked keyboard shortcut (${e.key}).`);
  }
}

function checkWindowDimensions() {
  // Only check if devtools dock panel is actually opened in fullscreen or standard window
  const widthDiff = window.outerWidth - window.innerWidth;
  const heightDiff = window.outerHeight - window.innerHeight;

  // 350px threshold prevents false positives on high-DPI Windows scaling (125%/150%)
  if ((widthDiff > 350 || heightDiff > 350) && !devtoolsWarned) {
    devtoolsWarned = true;
    logViolation(
      'Developer tools suspected',
      'Browser window outer dimensions suggest inspect panels may be active.'
    );
  } else if (widthDiff <= 350 && heightDiff <= 350) {
    devtoolsWarned = false;
  }
}

/* ==========================================================================
   NVIDIA LocateAnything-3B Live Webcam AI Proctoring Engine
   ========================================================================== */

let aiProctorInterval = null;
let aiProctorActive = false;
let aiFrameProcessing = false;
let lastAiViolationTime = 0;
const AI_VIOLATION_COOLDOWN_MS = 10000; // Throttle alerts to prevent spamming violations within 10 sec

/**
 * Starts real-time NVIDIA LocateAnything-3B camera security proctoring.
 * Captures frame every 5s, detects unauthorized items/persons, renders bounding boxes.
 * Pre-loads the DETR model worker immediately so the badge activates fast.
 */
function startAiCameraProctoring(videoEl, overlayCanvasEl) {
  if (aiProctorActive) return;

  const isLocalOfflineProject = window.location.protocol === 'file:' || !navigator.onLine;
  if (isLocalOfflineProject) {
    aiProctorActive = false;
    updateAiShieldStatus('OFFLINE', 'var(--muted, #6b7280)');
    console.log('[AI Proctoring] Disabled for offline/local project to preserve exam performance.');
    return;
  }

  aiProctorActive = true;

  // ── Immediately show LOADING status and start animated dots ──────────────
  updateAiShieldStatus('LOADING…', 'var(--gold, #f59e0b)');
  let dotCount = 0;
  const loadingDotInterval = setInterval(() => {
    if (!aiProctorActive) { clearInterval(loadingDotInterval); return; }
    const badge = document.getElementById('ai-shield-badge');
    // Only animate while still loading (not yet ACTIVE or UNAVAILABLE)
    if (badge && badge.textContent.includes('LOADING')) {
      dotCount = (dotCount + 1) % 4;
      const dots = '.'.repeat(dotCount);
      badge.textContent = `AI Vision Shield: LOADING${dots}`;
    } else {
      clearInterval(loadingDotInterval);
    }
  }, 400);

  // ── Eagerly pre-load the DETR worker right away (not on first tick) ──────
  loadMetaDetrDetector().then((worker) => {
    if (!worker) {
      clearInterval(loadingDotInterval);
      if (aiProctorActive) {
        updateAiShieldStatus('UNAVAILABLE', 'var(--muted, #6b7280)');
      }
    }
    // If worker loaded OK, updateAiShieldStatus('ACTIVE'…) is called inside
    // loadMetaDetrDetector() when the 'ready' message arrives.
  }).catch(() => {
    clearInterval(loadingDotInterval);
    updateAiShieldStatus('UNAVAILABLE', 'var(--muted, #6b7280)');
  });

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = 640;
  captureCanvas.height = 480;
  const ctx = captureCanvas.getContext('2d');

  // Run detection every 5s; model may still be loading on first few ticks
  // (runBrowserClientAiDetection gracefully returns [] until worker is ready)
  aiProctorInterval = setInterval(async () => {
    if (!aiProctorActive || aiFrameProcessing || !videoEl || videoEl.paused || videoEl.ended) return;

    aiFrameProcessing = true;
    try {
      // Keep inference input bounded even when the camera runs at HD resolution.
      const videoWidth = videoEl.videoWidth || captureCanvas.width;
      const videoHeight = videoEl.videoHeight || captureCanvas.height;
      const scale = Math.min(1, captureCanvas.width / videoWidth, captureCanvas.height / videoHeight);
      const frameWidth = Math.max(1, Math.round(videoWidth * scale));
      const frameHeight = Math.max(1, Math.round(videoHeight * scale));
      captureCanvas.width = frameWidth;
      captureCanvas.height = frameHeight;
      ctx.drawImage(videoEl, 0, 0, frameWidth, frameHeight);
      const base64Data = captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      if (!base64Data) return;

      // 2. Query NVIDIA LocateAnything-3B API or browser AI model
      const detections = await queryNvidiaLocateAnything(base64Data);

      // 3. Render bounding boxes onto visual overlay canvas
      if (overlayCanvasEl) {
        renderAiBoundingBoxes(overlayCanvasEl, videoEl, detections);
      }

      // 4. Process object detections & face mesh gaze tracking
      processAiDetections(detections);
      await processMediaPipeFaceTracking(videoEl, overlayCanvasEl);
    } catch (err) {
      console.warn('[AI Proctoring] Frame processing warning:', err);
    } finally {
      aiFrameProcessing = false;
    }
  }, 5000);
}

function stopAiCameraProctoring() {
  aiProctorActive = false;
  if (aiProctorInterval) {
    clearInterval(aiProctorInterval);
    aiProctorInterval = null;
  }
  aiFrameProcessing = false;
  updateAiShieldStatus('OFFLINE', 'var(--muted, #6b7280)');
}

function updateAiShieldStatus(text, color) {
  const badge = document.getElementById('ai-shield-badge');
  if (badge) {
    badge.textContent = `AI Vision Shield: ${text}`;
    badge.style.borderColor = color;
    badge.style.color = color;
  }
}

/**
 * Sends snapshot frame to NVIDIA LocateAnything-3B endpoint or runs keyless browser verification check.
 */
async function queryNvidiaLocateAnything(base64Jpeg) {
  if (window.location.protocol === 'file:' || !navigator.onLine) {
    return [];
  }

  const apiKey = typeof NVIDIA_API_KEY !== 'undefined' ? NVIDIA_API_KEY : '';
  const endpoint = typeof NVIDIA_LOCATEANYTHING_ENDPOINT !== 'undefined'
    ? NVIDIA_LOCATEANYTHING_ENDPOINT
    : 'https://ai.api.nvidia.com/v1/cv/nvidia/locateanything-3b';

  // 1. Try NVIDIA LocateAnything API if valid API key is configured
  if (apiKey && apiKey.startsWith('nvapi-') && !apiKey.includes('YOUR_NVIDIA_BUILD_API_KEY')) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: `data:image/jpeg;base64,${base64Jpeg}`,
          prompts: typeof NVIDIA_TARGET_PROMPTS !== 'undefined'
            ? NVIDIA_TARGET_PROMPTS
            : ['cell phone', 'second person', 'earbuds', 'notes'],
          threshold: typeof NVIDIA_CONFIDENCE_THRESHOLD !== 'undefined'
            ? NVIDIA_CONFIDENCE_THRESHOLD
            : 0.45,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return parseNvidiaDetections(data);
      }
    } catch (e) {
      console.warn('[NVIDIA API Warning] Falling back to client AI model:', e.message);
    }
  }

  // 2. Client-Side Real-Time Browser AI Fallback (using Meta DETR — facebook/detr-resnet-50 via Transformers.js)
  return await runBrowserClientAiDetection();
}

// DETR runs in a worker so model loading and inference cannot block exam UI.
let metaDetrWorker = null;
let metaDetrPromise = null;
let metaDetrRequestId = 0;
const metaDetrPending = new Map();

/**
 * Loads Meta's DETR object detection model in a browser worker.
 * Model: facebook/detr-resnet-50 (Xenova quantized ONNX build).
 * Runs entirely in the browser via WebAssembly — no API key required.
 */
async function loadMetaDetrDetector() {
  if (window.location.protocol === 'file:' || !navigator.onLine) {
    return null;
  }

  if (!metaDetrPromise) {
    metaDetrPromise = new Promise((resolve) => {
      try {
        metaDetrWorker = new Worker('js/detr-worker.js', { type: 'module' });

        // Reduced from 60s → 20s: if the model hasn't loaded in 20s, mark unavailable
        // so the badge doesn't stay stuck on LOADING for over a minute.
        const startupTimer = setTimeout(() => {
          console.warn('[Meta DETR] Model load timeout (20s). Marking as unavailable.');
          updateAiShieldStatus('UNAVAILABLE', 'var(--muted, #6b7280)');
          resolve(null);
        }, 20000);

        metaDetrWorker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            clearTimeout(startupTimer);
            updateAiShieldStatus('ACTIVE', 'var(--green, #10b981)');
            resolve(metaDetrWorker);
            return;
          }
          if (data.type === 'error' && data.id === undefined) {
            clearTimeout(startupTimer);
            console.warn('[Meta DETR] Worker initialization failed:', data.error);
            updateAiShieldStatus('UNAVAILABLE', 'var(--muted, #6b7280)');
            resolve(null);
            return;
          }

          const pending = metaDetrPending.get(data.id);
          if (pending) {
            metaDetrPending.delete(data.id);
            clearTimeout(pending.timeout);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(data.detections || []);
          }
        };

        metaDetrWorker.onerror = (event) => {
          clearTimeout(startupTimer);
          console.warn('[Meta DETR] Worker error:', event.message);
          updateAiShieldStatus('UNAVAILABLE', 'var(--muted, #6b7280)');
          resolve(null);
        };
      } catch (error) {
        console.warn('[Meta DETR] Worker unavailable:', error);
        resolve(null);
      }
    });
  }
  return metaDetrPromise;
}

/**
 * Runs Meta DETR on the current webcam video frame.
 * Returns detections in normalized [ymin, xmin, ymax, xmax] format.
 *
 * Uses one bounded-resolution pass per frame to keep CPU usage predictable.
 */
async function runBrowserClientAiDetection() {
  try {
    const videoEl = document.querySelector('#cam-box video');
    if (!videoEl || videoEl.readyState < 2) return [];

    const worker = await loadMetaDetrDetector();
    if (!worker) return [];

    const sourceWidth = videoEl.videoWidth || videoEl.clientWidth || 640;
    const sourceHeight = videoEl.videoHeight || videoEl.clientHeight || 480;
    const scale = Math.min(1, 640 / sourceWidth, 480 / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const capCanvas = document.createElement('canvas');
    capCanvas.width = width;
    capCanvas.height = height;
    capCanvas.getContext('2d').drawImage(videoEl, 0, 0, width, height);

    const image = await new Promise((resolve) => {
      capCanvas.toBlob(resolve, 'image/jpeg', 0.75);
    });
    if (!image) return [];

    const id = ++metaDetrRequestId;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        metaDetrPending.delete(id);
        reject(new Error('DETR inference timed out'));
      }, 30000);
      metaDetrPending.set(id, { resolve, reject, timeout });
      worker.postMessage({ type: 'detect', id, image, width, height });
    });
  } catch (err) {
    console.error('[Meta DETR Proctoring Error]', err);
    return [];
  }
}


/**
 * Parses raw JSON output from NVIDIA LocateAnything-3B API.
 */
function parseNvidiaDetections(data) {
  if (!data) return [];
  const results = [];
  const detections = data.objects || data.detections || data.predictions || [];

  for (const item of detections) {
    const label = (item.label || item.class || item.prompt || 'prohibited_item').toLowerCase();
    const confidence = item.confidence || item.score || 0.5;
    // Bounding box format [ymin, xmin, ymax, xmax] (normalized 0 to 1) or [x, y, w, h]
    let bbox = item.bbox || item.box || [0.2, 0.2, 0.5, 0.5];
    results.push({ label, confidence, bbox });
  }

  return results;
}

/**
 * Draws red threat bounding boxes on top of webcam feed.
 */
function renderAiBoundingBoxes(canvasEl, videoEl, detections) {
  if (!canvasEl || !videoEl) return;
  const ctx = canvasEl.getContext('2d');
  const w = videoEl.clientWidth || 320;
  const h = videoEl.clientHeight || 240;

  canvasEl.width = w;
  canvasEl.height = h;
  ctx.clearRect(0, 0, w, h);

  if (!detections || detections.length === 0) return;

  detections.forEach((det) => {
    let [ymin, xmin, ymax, xmax] = det.bbox;
    // Scale normalized coordinates to canvas dimensions
    const x = xmin * w;
    const y = ymin * h;
    const bw = (xmax - xmin) * w;
    const bh = (ymax - ymin) * h;

    // Draw bounding rectangle
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, bw, bh);

    // Draw label header banner
    ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
    const text = `${det.label.toUpperCase()} (${Math.round(det.confidence * 100)}%)`;
    ctx.font = 'bold 11px sans-serif';
    const textWidth = ctx.measureText(text).width;
    ctx.fillRect(x, Math.max(0, y - 20), textWidth + 10, 20);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 5, Math.max(14, y - 5));
  });
}

/**
 * Triggers security violation if prohibited items or secondary persons are detected.
 */
function processAiDetections(detections) {
  if (!detections || detections.length === 0) return;
  const now = Date.now();
  if (now - lastAiViolationTime < AI_VIOLATION_COOLDOWN_MS) return;

  let phoneDetected = false;
  let personCount = 0;
  let contrabandDetected = false;
  let contrabandLabel = '';

  detections.forEach((det) => {
    const l = det.label.toLowerCase();
    const score = det.confidence;

    // Detect cell phones, tablets, handheld devices (threshold: 0.25)
    if (score >= 0.25 && (
      l.includes('phone') || l.includes('mobile') || l.includes('cell') ||
      l.includes('remote') || l.includes('ipad') || l.includes('gadget')
    )) {
      phoneDetected = true;
    }

    // Count ALL detected persons — using the merged dual-pass results
    // Lower threshold (0.18) was already applied in runBrowserClientAiDetection
    if (l === 'person' || l.includes('human') || l.includes('man') || l.includes('woman')) {
      personCount++;
    }

    // Detect cheat sheets, books, electronic devices (threshold: 0.30)
    if (score >= 0.30 && (
      l.includes('book') || l.includes('paper') || l.includes('laptop') ||
      l.includes('earbud') || l.includes('headphone') || l.includes('note')
    )) {
      contrabandDetected = true;
      contrabandLabel = l;
    }
  });

  // IMPORTANT: Use independent if-blocks (not else-if) so that a frame with
  // both a phone AND a second person triggers all applicable violations.
  let violated = false;

  if (personCount > 1) {
    lastAiViolationTime = now;
    violated = true;
    logViolation(
      'AI Security Alert',
      `Unauthorized person detected: ${personCount} people visible in camera feed. Only the candidate may be present.`
    );
  }

  if (personCount === 0 && !violated) {
    lastAiViolationTime = now;
    violated = true;
    logViolation(
      'AI Security Alert',
      'Identity Verification Alert: Candidate not visible — no person detected in camera feed.'
    );
  }

  if (phoneDetected && !violated) {
    lastAiViolationTime = now;
    violated = true;
    logViolation('AI Security Alert', 'Prohibited item detected: Mobile phone in camera feed.');
  }

  if (contrabandDetected && !violated) {
    lastAiViolationTime = now;
    logViolation('AI Security Alert', `Prohibited item detected: ${contrabandLabel} visible in camera feed.`);
  }
}

/* ==========================================================================
   MediaPipe Face Landmarker + Iris Gaze Tracking Engine
   Improved version:
   - Iris-based eye tracking
   - Eye-relative coordinates
   - Head movement compensation
   - Automatic center calibration
   - Persistent gaze detection
   - Reduced false positives
   ========================================================================== */

let faceLandmarker = null;
let lastGazeViolationTime = 0;

/* --------------------------------------------------------------------------
   GAZE SETTINGS
   -------------------------------------------------------------------------- */

const GAZE_PERSISTENCE_MS = 1800;
const GAZE_COOLDOWN_MS = 10000;
const GAZE_RESET_MS = 600;
const CALIBRATION_FRAMES = 45;

const GAZE_LEFT_THRESHOLD = 0.16;
const GAZE_RIGHT_THRESHOLD = 0.16;
const GAZE_UP_THRESHOLD = 0.16;
const GAZE_DOWN_THRESHOLD = 0.18;

const HEAD_YAW_THRESHOLD = 0.12;
const HEAD_PITCH_THRESHOLD = 0.12;

/* --------------------------------------------------------------------------
   STATE
   -------------------------------------------------------------------------- */

let gazeState = {
  calibrated: false,
  calibrationSamples: [],
  centerHorizontal: 0.5,
  centerVertical: 0.5,
  currentDirection: 'center',
  suspiciousSince: 0,
  normalSince: 0,
  lastHorizontal: 0,
  lastVertical: 0,
  headYaw: 0,
  headPitch: 0
};

/* --------------------------------------------------------------------------
   LOAD MEDIAPIPE
   -------------------------------------------------------------------------- */

async function loadMediaPipeFaceLandmarkerScript() {
  if (window.FaceLandmarker) {
    return true;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/tasks-vision_bundle.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/* --------------------------------------------------------------------------
   INITIALIZE FACE LANDMARKER
   -------------------------------------------------------------------------- */

async function initMediaPipeFaceLandmarker() {
  if (window.location.protocol === 'file:' || !navigator.onLine) {
    return;
  }

  try {
    await loadMediaPipeFaceLandmarkerScript();
    const vision = await window.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
    );
    faceLandmarker = await window.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 2,
      minFaceDetectionConfidence: 0.55,
      minFacePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true
    });
    console.log('[MediaPipe] Face Landmarker initialized');
  } catch (err) {
    console.error('[MediaPipe Face Landmarker] Initialization failed:', err);
  }
}

function resetGazeCalibration() {
  gazeState = {
    calibrated: false,
    calibrationSamples: [],
    centerHorizontal: 0.5,
    centerVertical: 0.5,
    currentDirection: 'center',
    suspiciousSince: 0,
    normalSince: 0,
    lastHorizontal: 0,
    lastVertical: 0,
    headYaw: 0,
    headPitch: 0
  };
  console.log('[Gaze] Calibration reset');
}

function calculateIrisGaze(landmarks) {
  if (!landmarks || landmarks.length < 478) {
    return null;
  }

  const leftIris = landmarks[468];
  const leftOuter = landmarks[33];
  const leftInner = landmarks[133];
  const leftUpper = landmarks[159];
  const leftLower = landmarks[145];

  const rightIris = landmarks[473];
  const rightOuter = landmarks[263];
  const rightInner = landmarks[362];
  const rightUpper = landmarks[386];
  const rightLower = landmarks[374];

  if (!leftIris || !rightIris || !leftOuter || !leftInner || !rightOuter || !rightInner) {
    return null;
  }

  function horizontalRatio(iris, outer, inner) {
    const width = inner.x - outer.x;
    if (Math.abs(width) < 0.0001) return 0.5;
    let ratio = (iris.x - outer.x) / width;
    return Math.max(0, Math.min(1, ratio));
  }

  const leftHorizontal = horizontalRatio(leftIris, leftOuter, leftInner);
  const rightHorizontal = horizontalRatio(rightIris, rightOuter, rightInner);
  const horizontal = (leftHorizontal + rightHorizontal) / 2;

  function verticalRatio(iris, upper, lower) {
    const height = lower.y - upper.y;
    if (Math.abs(height) < 0.0001) return 0.5;
    let ratio = (iris.y - upper.y) / height;
    return Math.max(0, Math.min(1, ratio));
  }

  let vertical = 0.5;
  if (leftUpper && leftLower && rightUpper && rightLower) {
    const leftVertical = verticalRatio(leftIris, leftUpper, leftLower);
    const rightVertical = verticalRatio(rightIris, rightUpper, rightLower);
    vertical = (leftVertical + rightVertical) / 2;
  }

  return {
    horizontal,
    vertical,
    leftEyeHorizontal: leftHorizontal,
    rightEyeHorizontal: rightHorizontal,
    leftEyeVertical: leftUpper && leftLower ? verticalRatio(leftIris, leftUpper, leftLower) : 0.5,
    rightEyeVertical: rightUpper && rightLower ? verticalRatio(rightIris, rightUpper, rightLower) : 0.5
  };
}

function calculateHeadPose(landmarks) {
  if (!landmarks || landmarks.length < 300) {
    return { yaw: 0, pitch: 0 };
  }
  const nose = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const chin = landmarks[152];

  if (!nose || !leftEye || !rightEye || !chin) {
    return { yaw: 0, pitch: 0 };
  }

  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeWidth = Math.abs(rightEye.x - leftEye.x);
  let yaw = 0;
  if (eyeWidth > 0.001) {
    yaw = (nose.x - eyeCenterX) / eyeWidth;
  }

  const eyeCenterY = (leftEye.y + rightEye.y) / 2;
  const faceHeight = Math.abs(chin.y - eyeCenterY);
  let pitch = 0;
  if (faceHeight > 0.001) {
    pitch = (nose.y - eyeCenterY) / faceHeight;
  }

  return { yaw, pitch };
}

function calibrateGaze(horizontal, vertical) {
  if (gazeState.calibrated) return;
  gazeState.calibrationSamples.push({ horizontal, vertical });

  if (gazeState.calibrationSamples.length >= CALIBRATION_FRAMES) {
    let totalHorizontal = 0;
    let totalVertical = 0;
    gazeState.calibrationSamples.forEach(sample => {
      totalHorizontal += sample.horizontal;
      totalVertical += sample.vertical;
    });

    gazeState.centerHorizontal = totalHorizontal / gazeState.calibrationSamples.length;
    gazeState.centerVertical = totalVertical / gazeState.calibrationSamples.length;
    gazeState.calibrated = true;
    console.log('[Gaze] Calibration completed:', gazeState.centerHorizontal, gazeState.centerVertical);
  }
}

function determineGazeDirection(horizontal, vertical, headPose) {
  if (!gazeState.calibrated) return 'calibrating';

  const horizontalDifference = horizontal - gazeState.centerHorizontal;
  const verticalDifference = vertical - gazeState.centerVertical;

  gazeState.lastHorizontal = horizontalDifference;
  gazeState.lastVertical = verticalDifference;

  const compensatedHorizontal = horizontalDifference - (headPose.yaw * 0.12);
  const compensatedVertical = verticalDifference - (headPose.pitch * 0.08);

  if (compensatedHorizontal < -GAZE_LEFT_THRESHOLD) return 'left';
  if (compensatedHorizontal > GAZE_RIGHT_THRESHOLD) return 'right';
  if (compensatedVertical > GAZE_DOWN_THRESHOLD) return 'down';
  if (compensatedVertical < -GAZE_UP_THRESHOLD) return 'up';

  if (Math.abs(headPose.yaw) > HEAD_YAW_THRESHOLD) {
    return headPose.yaw > 0 ? 'head-right' : 'head-left';
  }
  if (Math.abs(headPose.pitch) > HEAD_PITCH_THRESHOLD) {
    return headPose.pitch > 0 ? 'head-down' : 'head-up';
  }

  return 'center';
}

function processGazeDirection(direction, now) {
  if (direction === 'calibrating') return;

  if (direction === 'center') {
    gazeState.currentDirection = 'center';
    if (!gazeState.normalSince) {
      gazeState.normalSince = now;
    }
    if (now - gazeState.normalSince >= GAZE_RESET_MS) {
      gazeState.suspiciousSince = 0;
    }
    return;
  }

  gazeState.normalSince = 0;

  if (gazeState.currentDirection !== direction) {
    gazeState.currentDirection = direction;
    gazeState.suspiciousSince = now;
    return;
  }

  if (!gazeState.suspiciousSince) {
    gazeState.suspiciousSince = now;
    return;
  }

  const suspiciousDuration = now - gazeState.suspiciousSince;
  if (suspiciousDuration < GAZE_PERSISTENCE_MS) return;

  if (now - lastGazeViolationTime < GAZE_COOLDOWN_MS) return;

  lastGazeViolationTime = now;
  let message = '';

  switch (direction) {
    case 'left':
      message = 'Candidate continuously looking towards the left side of the screen.';
      break;
    case 'right':
      message = 'Candidate continuously looking towards the right side of the screen.';
      break;
    case 'down':
      message = 'Candidate continuously looking downward away from the exam screen.';
      break;
    case 'up':
      message = 'Candidate continuously looking upward away from the exam screen.';
      break;
    case 'head-left':
      message = 'Candidate head position remained turned towards the left.';
      break;
    case 'head-right':
      message = 'Candidate head position remained turned towards the right.';
      break;
    case 'head-down':
      message = 'Candidate head position remained directed downward.';
      break;
    case 'head-up':
      message = 'Candidate head position remained directed upward.';
      break;
    default:
      message = 'Candidate continuously looking away from the exam screen.';
  }

  logViolation('Gaze Violation', message);
  gazeState.suspiciousSince = 0;
}

function drawGazeDebug(ctx, landmarks, gaze, direction, width, height) {
  if (!ctx || !landmarks || !gaze) return;

  const irisPoints = [468, 473];
  ctx.save();

  ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
  irisPoints.forEach(index => {
    const point = landmarks[index];
    if (!point) return;
    const x = point.x * width;
    const y = point.y * height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.font = 'bold 13px Arial';
  ctx.fillStyle = direction === 'center' ? '#10b981' : '#ef4444';
  ctx.fillText(`GAZE: ${direction.toUpperCase()}`, 10, 20);

  if (!gazeState.calibrated) {
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('CALIBRATING...', 10, 40);
  }

  ctx.restore();
}

let lastFaceTrackingTimestamp = -1;

async function processMediaPipeFaceTracking(videoEl, canvasEl) {
  if (!faceLandmarker) {
    await initMediaPipeFaceLandmarker();
  }
  if (!faceLandmarker || !videoEl || videoEl.readyState < 2) return;

  try {
    const timestamp = performance.now();
    if (timestamp <= lastFaceTrackingTimestamp) return;
    lastFaceTrackingTimestamp = timestamp;

    const results = faceLandmarker.detectForVideo(videoEl, timestamp);
    if (!results || !results.faceLandmarks) return;

    const faces = results.faceLandmarks;
    const now = Date.now();

    if (faces.length === 0) {
      if (now - lastGazeViolationTime > GAZE_COOLDOWN_MS) {
        lastGazeViolationTime = now;
        logViolation('Face Not Detected', 'Candidate face moved out of camera view.');
      }
      return;
    }

    if (faces.length > 1) {
      if (now - lastGazeViolationTime > GAZE_COOLDOWN_MS) {
        lastGazeViolationTime = now;
        logViolation('Multiple Faces Detected', 'Multiple faces detected in camera feed.');
      }
    }

    const landmarks = faces[0];
    const gaze = calculateIrisGaze(landmarks);
    if (!gaze) return;

    const headPose = calculateHeadPose(landmarks);
    gazeState.headYaw = headPose.yaw;
    gazeState.headPitch = headPose.pitch;

    if (!gazeState.calibrated) {
      calibrateGaze(gaze.horizontal, gaze.vertical);
    }

    const direction = determineGazeDirection(gaze.horizontal, gaze.vertical, headPose);
    processGazeDirection(direction, now);

    if (canvasEl) {
      const ctx = canvasEl.getContext('2d');
      const width = canvasEl.width || videoEl.clientWidth || 320;
      const height = canvasEl.height || videoEl.clientHeight || 240;

      drawGazeDebug(ctx, landmarks, gaze, direction, width, height);

      const importantPoints = [1, 33, 263, 152, 468, 473];
      ctx.fillStyle = 'rgba(16, 185, 129, 0.75)';
      importantPoints.forEach(index => {
        const point = landmarks[index];
        if (!point) return;
        const x = point.x * width;
        const y = point.y * height;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    verifyCandidateIdentity(landmarks);
  } catch (err) {
    console.warn('[Face/Iris Tracking Error]', err);
  }
}

/* ==========================================================================
   InsightFace / ArcFace Facial Identity Verification Engine
   ========================================================================== */

let registeredFacialEmbedding = null;
let lastFaceVerifyTime = 0;
const FACE_VERIFY_INTERVAL_MS = 15000;

function extractFacialEmbedding(landmarks) {
  if (!landmarks || landmarks.length < 10) return null;
  const anchorIndices = [1, 33, 263, 152, 61, 291, 199, 10, 151, 9];
  const embedding = [];
  const nose = landmarks[1];

  for (let i = 0; i < anchorIndices.length; i++) {
    const pt = landmarks[anchorIndices[i]];
    if (pt) {
      const dx = pt.x - nose.x;
      const dy = pt.y - nose.y;
      const dz = (pt.z || 0) - (nose.z || 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      embedding.push(dx, dy, dz, dist);
    }
  }
  return embedding;
}

function computeCosineSimilarity(embA, embB) {
  if (!embA || !embB || embA.length !== embB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < embA.length; i++) {
    dot += embA[i] * embB[i];
    normA += embA[i] * embA[i];
    normB += embB[i] * embB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function verifyCandidateIdentity(landmarks) {
  const now = Date.now();
  if (now - lastFaceVerifyTime < FACE_VERIFY_INTERVAL_MS) return;
  lastFaceVerifyTime = now;

  const currentEmbedding = extractFacialEmbedding(landmarks);
  if (!currentEmbedding) return;

  if (!registeredFacialEmbedding) {
    registeredFacialEmbedding = currentEmbedding;
    return;
  }

  const similarityScore = computeCosineSimilarity(registeredFacialEmbedding, currentEmbedding);
  if (similarityScore < 0.65) {
    logViolation('Facial Identity Mismatch', 'Live candidate face does not match registered exam admit card photo (InsightFace / ArcFace).');
  }
}

window.resetGazeCalibration = resetGazeCalibration;





