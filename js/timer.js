// js/timer.js - Countdown Timer Logic for Exam Session

let examTimerInterval = null;

/**
 * Starts the countdown timer.
 * @param {Function} onTick - Callback function invoked every second with remaining seconds.
 * @param {Function} onExpired - Callback function invoked when the timer reaches 0.
 */
function startExamTimer(onTick, onExpired) {
  // Clear any existing timer
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
  }

  const syncTimerState = () => {
    const state = getState();
    if (!state || state.submitted || !state.timerActive) {
      return null;
    }

    const durationSeconds = Number(state.durationSeconds || state.timeLeft || 0);
    if (!state.startedAt) {
      state.startedAt = Date.now();
    }

    const elapsedSeconds = Math.floor((Date.now() - state.startedAt) / 1000);
    const remaining = Math.max(0, durationSeconds - elapsedSeconds);

    state.timeLeft = remaining;
    saveState(state);

    if (remaining <= 0) {
      state.timeLeft = 0;
      saveState(state);
      clearInterval(examTimerInterval);
      examTimerInterval = null;
      if (onExpired) {
        onExpired();
      }
      return 'expired';
    }

    if (onTick) {
      onTick(remaining);
    }

    return remaining;
  };

  const initialState = getState();
  if (initialState && onTick) {
    const syncResult = syncTimerState();
    if (syncResult === 'expired') {
      return;
    }
  }

  examTimerInterval = setInterval(() => {
    const syncResult = syncTimerState();
    if (syncResult === 'expired') {
      return;
    }
  }, 1000);
}

/**
 * Stops/pauses the active exam timer interval.
 */
function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
}
