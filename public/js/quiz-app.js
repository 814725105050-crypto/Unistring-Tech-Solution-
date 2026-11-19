/**
 * Unistring Tech Solution Student Mobile-First Assessment Application
 * Placement Drive Assessment
 */

import {
  checkExistingSubmission,
  getLocalQuestions,
  getLocalSettings,
  loadPortalSettings,
  loadQuestions,
  recordQuizSubmission,
  removeActiveSession,
  requestStudentRetake,
  subscribeToPortalSettings,
  upsertActiveSession
} from './db-service.js';
import { renderProtectedQuestionCanvas } from './canvas-shield.js';
import { ExamProctor } from './proctor.js';

const ACTIVE_ATTEMPT_KEY = 'uts_student_active_attempt_v1';
const FIXED_DEPARTMENT = 'Placement Drive';
const FIXED_COLLEGE = 'Unistring Tech Solution';

let settings = null;
let rawQuestions = [];
let preparedQuestions = [];
let candidate = null;
let attemptState = null;
let proctor = null;
let quizTimerInterval = null;
let heartbeatInterval = null;

/* -------------------------------------------------------------------------- */
/* Seeded Deterministic PRNG (Mulberry32) so page refresh preserves order     */
/* -------------------------------------------------------------------------- */

function hashStringSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seedStr) {
  let a = hashStringSeed(seedStr);
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, rng) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildStudentQuestionSet(questions, studentSeed, doShuffleQuestions, doShuffleOptions) {
  const rng = createSeededRng(studentSeed);
  const mapped = questions.map((q) => {
    const indexedOpts = q.options.map((text, origIdx) => ({
      text,
      origIdx,
      isCorrect: origIdx === Number(q.correctIndex)
    }));
    const finalOpts =
      doShuffleOptions && q.type !== 'tf' ? seededShuffle(indexedOpts, rng) : indexedOpts;
    return {
      id: q.id,
      category: q.category || '',
      type: q.type || 'mcq',
      question: q.question,
      explanation: q.explanation || '',
      options: finalOpts.map((o) => o.text),
      correctShuffledIndex: finalOpts.findIndex((o) => o.isCorrect)
    };
  });

  return doShuffleQuestions ? seededShuffle(mapped, rng) : mapped;
}

/* -------------------------------------------------------------------------- */
/* Screen Switching                                                           */
/* -------------------------------------------------------------------------- */

const screens = {
  register: document.getElementById('screen-register'),
  briefing: document.getElementById('screen-briefing'),
  quiz: document.getElementById('screen-quiz'),
  result: document.getElementById('screen-result')
};

function showScreen(name) {
  document.body.classList.toggle('in-exam', name === 'quiz');
  Object.entries(screens).forEach(([key, el]) => {
    if (el) el.classList.toggle('hidden', key !== name);
  });
  const brandHeader = document.getElementById('portal-brand-header');
  if (brandHeader) {
    brandHeader.classList.toggle('hidden', name === 'quiz');
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* -------------------------------------------------------------------------- */
/* Initialization                                                             */
/* -------------------------------------------------------------------------- */

async function initPortal() {
  // Support URL parameters for direct assessment or slot targeting: ?slot=2 or ?drive=xyz
  const urlParams = new URLSearchParams(window.location.search);
  const requestedSlot = urlParams.get('slot');

  // Render immediately with fast cached/default values so students never see a delay or freeze
  settings = getLocalSettings();
  if (requestedSlot && !isNaN(Number(requestedSlot))) {
    settings.activeSlot = Number(requestedSlot);
  }
  const currentSlot = Number(settings.activeSlot || 1);
  rawQuestions = getLocalQuestions(currentSlot);

  applySettingsToLandingUI();
  bindUIEvents();

  // Non-blocking parallel background sync
  (async () => {
    try {
      const [freshSettings, freshQuestions] = await Promise.all([
        loadPortalSettings(),
        loadQuestions(currentSlot)
      ]);
      settings = freshSettings;
      if (requestedSlot && !isNaN(Number(requestedSlot))) {
        settings.activeSlot = Number(requestedSlot);
      }
      rawQuestions = freshQuestions;
      if (!attemptState) {
        applySettingsToLandingUI();
      }
    } catch (_) {}
  })();

  // Real-time synchronization: dynamically update without requiring manual page reload!
  subscribeToPortalSettings(async (newSettings) => {
    const prevSlot = settings?.activeSlot;
    settings = newSettings;

    if (!attemptState) {
      if (prevSlot !== newSettings.activeSlot) {
        rawQuestions = await loadQuestions(Number(newSettings.activeSlot || 1));
      }
      applySettingsToLandingUI();
    }
  });

  await tryRestoreActiveAttempt();
}

function isSlotUnlockedNow(slotNum, settings) {
  // Support dynamic slot map or slot1Open/slot2Open legacy fields
  let isManuallyOpen = true;
  if (settings.slotStatusMap && settings.slotStatusMap[String(slotNum)] !== undefined) {
    isManuallyOpen = Boolean(settings.slotStatusMap[String(slotNum)]);
  } else if (slotNum === 2) {
    isManuallyOpen = settings.slot2Open !== false;
  } else if (slotNum === 1) {
    isManuallyOpen = settings.slot1Open !== false;
  }

  // Check clock unlock
  let unlockDateStr = '';
  if (settings.slotUnlockMap && settings.slotUnlockMap[String(slotNum)]) {
    unlockDateStr = settings.slotUnlockMap[String(slotNum)];
  } else if (slotNum === 2) {
    unlockDateStr = settings.slot2UnlockAt;
  } else if (slotNum === 1) {
    unlockDateStr = settings.slot1UnlockAt;
  }

  if (unlockDateStr) {
    const unlockTime = new Date(unlockDateStr).getTime();
    if (!isNaN(unlockTime)) {
      if (Date.now() < unlockTime) {
        return {
          unlocked: false,
          reason: `Slot ${slotNum} unlocks on ${new Date(unlockTime).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
          })}`
        };
      }
    }
  }

  if (!isManuallyOpen) {
    return { unlocked: false, reason: `Slot ${slotNum} is currently closed / paused by coordinator.` };
  }
  return { unlocked: true };
}

function applySettingsToLandingUI() {
  const currentSlot = Number(settings.activeSlot || 1);
  const slotCheck = isSlotUnlockedNow(currentSlot, settings);
  const isOverallOpen = settings.quizOpen !== false && slotCheck.unlocked;

  const activeLogo = settings.logoUrl || window.__UTS_PRELOADED_LOGO__ || '/assets/uts-logo.png';
  const headerLogo = document.getElementById('portal-header-logo');
  if (headerLogo && headerLogo.src !== activeLogo && !headerLogo.src.endsWith(activeLogo)) {
    headerLogo.src = activeLogo;
  }
  const showcaseLogo = document.getElementById('landing-showcase-logo');
  if (showcaseLogo && showcaseLogo.src !== activeLogo && !showcaseLogo.src.endsWith(activeLogo)) {
    showcaseLogo.src = activeLogo;
  }

  document.getElementById('landing-quiz-title').textContent =
    settings.quizTitle || `Placement Drive Assessment · Slot ${currentSlot}`;
  document.getElementById('landing-workshop-subtitle').textContent =
    settings.workshopName || `Online Technical & Aptitude Assessment (Slot ${currentSlot})`;
  document.getElementById('meta-q-count').textContent = String(rawQuestions.length || 50);
  document.getElementById('meta-duration').textContent = `${settings.durationMinutes || 45} Min`;

  document.getElementById('brief-max-warn').textContent = String(settings.maxWarnings ?? 2);
  document.getElementById('brief-grace-sec').textContent = String(settings.returnGraceSeconds ?? 20);
  document.getElementById('brief-grace-sec-2').textContent = String(settings.returnGraceSeconds ?? 20);
  document.getElementById('brief-grace-sec-3').textContent = String(settings.returnGraceSeconds ?? 20);

  const hasPasscode = Boolean(String(settings.examAccessCode || '').trim());
  document.getElementById('access-code-field').classList.toggle('hidden', !hasPasscode);

  const closedBanner = document.getElementById('quiz-closed-banner');
  const submitBtn = document.getElementById('btn-register-continue');
  const dot = document.getElementById('live-status-dot');
  const statusLabel = document.getElementById('live-status-label');

  if (!isOverallOpen) {
    closedBanner.classList.remove('hidden');
    closedBanner.innerHTML = `<strong>Assessment Notice:</strong> ${slotCheck.reason || `Slot ${currentSlot} is currently closed.`}`;
    submitBtn.disabled = true;
    dot.style.background = '#dc2626';
    statusLabel.textContent = `Slot ${currentSlot} Locked`;
  } else {
    closedBanner.classList.add('hidden');
    submitBtn.disabled = false;
    dot.style.background = '#10b981';
    statusLabel.textContent = `Slot ${currentSlot} Assessment Active`;
  }
}

/* -------------------------------------------------------------------------- */
/* Registration & Briefing                                                    */
/* -------------------------------------------------------------------------- */

function showRegisterError(msg) {
  const el = document.getElementById('register-error');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function bindUIEvents() {
  const regForm = document.getElementById('registration-form');
  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    showRegisterError('');

    settings = await loadPortalSettings();
    const currentSlot = Number(settings.activeSlot || 1);
    const slotCheck = isSlotUnlockedNow(currentSlot, settings);
    if (!settings.quizOpen || !slotCheck.unlocked) {
      applySettingsToLandingUI();
      showRegisterError(`Slot ${currentSlot} is currently closed or paused by administrator. Please wait for coordinator instructions.`);
      return;
    }

    const fullName = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim().toLowerCase();
    const registerNumber = document.getElementById('reg-number').value.trim().toUpperCase();
    const phone = document.getElementById('reg-phone').value.trim().replace(/\s+/g, '');
    const year = document.getElementById('reg-year').value.trim();
    const enteredPin = document.getElementById('reg-passcode').value.trim();

    if (fullName.length < 2) return showRegisterError('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showRegisterError('Please enter a valid email address.');
    if (!email.endsWith('@trp.srmtrichy.edu.in')) {
      return showRegisterError('Please use your official college email (@trp.srmtrichy.edu.in).');
    }
    if (registerNumber.length < 2) return showRegisterError('Please enter your Candidate / Register ID.');
    if (!/^\+?\d{7,15}$/.test(phone)) return showRegisterError('Please enter a valid mobile number (at least 7 to 10 digits).');
    if (!year) return showRegisterError('Please select your Qualification / Year.');

    const requiredPin = String(settings.examAccessCode || '').trim();
    if (requiredPin && enteredPin !== requiredPin) {
      return showRegisterError('Incorrect Access PIN. Please check with the coordinator.');
    }

    const btn = document.getElementById('btn-register-continue');
    btn.disabled = true;
    btn.textContent = 'Checking Eligibility...';

    try {
      if (!settings.allowDuplicateEmail) {
        try {
          const existing = await checkExistingSubmission(email, registerNumber, currentSlot);
          if (existing) {
            renderResultScreen(existing, true);
            return;
          }
        } catch (checkErr) {
          console.warn('Submission check fallback:', checkErr);
        }
      }

      candidate = {
        fullName,
        email,
        registerNumber,
        phone,
        slot: currentSlot,
        department: FIXED_DEPARTMENT,
        year,
        college: FIXED_COLLEGE
      };

      const elName = document.getElementById('brief-student-name');
      if (elName) elName.textContent = fullName;
      const elReg = document.getElementById('brief-student-reg');
      if (elReg) elReg.textContent = registerNumber;
      const elEmail = document.getElementById('brief-student-email');
      if (elEmail) elEmail.textContent = email;
      const elConsent = document.getElementById('chk-security-consent');
      if (elConsent) elConsent.checked = false;
      const elStartBtn = document.getElementById('btn-start-quiz');
      if (elStartBtn) elStartBtn.disabled = true;

      showScreen('briefing');
    } catch (submitErr) {
      console.error('Registration processing error:', submitErr);
      showRegisterError('An error occurred during verification. Please try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register & Proceed to Security Check →';
    }
  });

  const consentChk = document.getElementById('chk-security-consent');
  const startBtn = document.getElementById('btn-start-quiz');
  consentChk.addEventListener('change', () => {
    startBtn.disabled = !consentChk.checked;
  });

  document.getElementById('btn-back-edit-reg').addEventListener('click', () => {
    showScreen('register');
  });

  startBtn.addEventListener('click', async () => {
    if (!candidate) return;
    startBtn.disabled = true;
    startBtn.textContent = 'Locking Screen...';

    try {
      const activeSlot = candidate.slot || Number(settings.activeSlot || 1);
      rawQuestions = await loadQuestions(activeSlot);
      if (!rawQuestions || !rawQuestions.length) {
        alert(`No questions found for Slot ${activeSlot}. Please contact the coordinator.`);
        return;
      }
      const durationMs = Number(settings.durationMinutes || 45) * 60 * 1000;
      const now = Date.now();

      attemptState = {
        candidate,
        slot: activeSlot,
        startedAt: now,
        deadlineAt: now + durationMs,
        currentIndex: 0,
        answers: {},
        flagged: {},
        visited: { 0: true }, // Track viewed questions
        warningsUsed: 0,
        violations: [],
        warningOverlayOpen: false,
        warningDeadlineAt: 0,
        currentReason: ''
      };
      persistAttemptLocal();

      if (settings.requireFullscreen && ExamProctor.isFullscreenSupported()) {
        try {
          const el = document.documentElement;
          if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
          else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
        } catch (_) {}
      }

      launchActiveQuiz();
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = 'Lock Screen & Start Quiz';
    }
  });

  document.getElementById('btn-prev-q').addEventListener('click', () => {
    if (!attemptState || attemptState.currentIndex <= 0) return;
    if (!canNavigateAwayFromCurrentQuestion()) {
      notifyCooldownRemaining();
      return;
    }
    attemptState.currentIndex--;
    attemptState.visited = attemptState.visited || {};
    attemptState.visited[attemptState.currentIndex] = true;
    persistAttemptLocal();
    renderCurrentQuestion();
  });

  document.getElementById('btn-next-q').addEventListener('click', () => {
    if (!attemptState) return;
    if (!canNavigateAwayFromCurrentQuestion()) {
      notifyCooldownRemaining();
      return;
    }
    if (attemptState.currentIndex < preparedQuestions.length - 1) {
      attemptState.currentIndex++;
      attemptState.visited = attemptState.visited || {};
      attemptState.visited[attemptState.currentIndex] = true;
      persistAttemptLocal();
      renderCurrentQuestion();
    } else {
      if (!canSubmitAssessment()) {
        notifySubmissionTimerRemaining();
        return;
      }
      openSubmitConfirmation();
    }
  });

  const desktopSubmitBtn = document.getElementById('btn-desktop-submit');
  if (desktopSubmitBtn) {
    desktopSubmitBtn.addEventListener('click', () => {
      if (!canNavigateAwayFromCurrentQuestion()) {
        notifyCooldownRemaining();
        return;
      }
      if (!canSubmitAssessment()) {
        notifySubmissionTimerRemaining();
        return;
      }
      openSubmitConfirmation();
    });
  }

  document.getElementById('btn-flag-q').addEventListener('click', () => {
    if (!attemptState) return;
    const q = preparedQuestions[attemptState.currentIndex];
    if (!q) return;
    attemptState.flagged[q.id] = !attemptState.flagged[q.id];
    persistAttemptLocal();
    renderCurrentQuestion();
  });

  document.getElementById('btn-open-palette').addEventListener('click', () => {
    renderPaletteGrid();
    document.getElementById('palette-drawer').classList.remove('hidden');
  });
  document.getElementById('btn-close-palette').addEventListener('click', () => {
    document.getElementById('palette-drawer').classList.add('hidden');
  });
  document.getElementById('btn-open-submit-confirm').addEventListener('click', () => {
    document.getElementById('palette-drawer').classList.add('hidden');
    if (!canSubmitAssessment()) {
      notifySubmissionTimerRemaining();
      return;
    }
    openSubmitConfirmation();
  });

  document.getElementById('btn-cancel-submit').addEventListener('click', () => {
    document.getElementById('submit-confirm-modal').classList.add('hidden');
  });
  document.getElementById('btn-confirm-submit').addEventListener('click', () => {
    if (!canSubmitAssessment()) {
      document.getElementById('submit-confirm-modal').classList.add('hidden');
      notifySubmissionTimerRemaining();
      return;
    }
    document.getElementById('submit-confirm-modal').classList.add('hidden');
    finalizeQuizSubmission('Manual Submit', false);
  });

  document.getElementById('btn-resume-exam').addEventListener('click', async () => {
    if (!proctor) return;
    await proctor.acknowledgeAndResume();
    renderCurrentQuestion();
  });

  window.addEventListener('resize', () => {
    if (!screens.quiz.classList.contains('hidden') && attemptState) {
      renderCurrentQuestion();
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Active Attempt Restore                                                     */
/* -------------------------------------------------------------------------- */

function persistAttemptLocal() {
  if (!attemptState) return;
  try {
    localStorage.setItem(ACTIVE_ATTEMPT_KEY, JSON.stringify(attemptState));
  } catch (_) {}
}

function clearAttemptLocal() {
  try {
    localStorage.removeItem(ACTIVE_ATTEMPT_KEY);
  } catch (_) {}
}

async function tryRestoreActiveAttempt() {
  let saved = null;
  try {
    const raw = localStorage.getItem(ACTIVE_ATTEMPT_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (_) {
    saved = null;
  }
  if (!saved || !saved.candidate || !saved.deadlineAt) return;

  candidate = saved.candidate;
  attemptState = saved;

  try {
    const existing = await checkExistingSubmission(candidate.email, candidate.registerNumber);
    if (existing) {
      clearAttemptLocal();
      renderResultScreen(existing, true);
      return;
    }
  } catch (err) {
    console.warn('Submission check fallback during restore:', err);
  }

  if (Date.now() >= attemptState.deadlineAt) {
    preparedQuestions = buildStudentQuestionSet(
      rawQuestions,
      `${candidate.email}:${candidate.registerNumber}`,
      settings.shuffleQuestions,
      settings.shuffleOptions
    );
    await finalizeQuizSubmission('Time Expired (Auto-Submitted)', true);
    return;
  }

  launchActiveQuiz();
}

/* -------------------------------------------------------------------------- */
/* Quiz Execution & Proctoring Wiring                                         */
/* -------------------------------------------------------------------------- */

function launchActiveQuiz() {
  preparedQuestions = buildStudentQuestionSet(
    rawQuestions,
    `${candidate.email}:${candidate.registerNumber}`,
    settings.shuffleQuestions,
    settings.shuffleOptions
  );

  showScreen('quiz');
  renderCurrentQuestion();

  if (proctor) proctor.stop();
  proctor = new ExamProctor({
    maxWarnings: settings.maxWarnings ?? 2,
    returnGraceSeconds: settings.returnGraceSeconds ?? 20,
    requireFullscreen: settings.requireFullscreen ?? true,
    initialWarningsUsed: attemptState.warningsUsed || 0,
    initialViolations: attemptState.violations || [],
    initialWarningOverlayOpen: attemptState.warningOverlayOpen || false,
    initialWarningDeadlineAt: attemptState.warningDeadlineAt || 0,
    initialReason: attemptState.currentReason || '',
    onStateChange: ({ warningsUsed, maxWarnings }) => {
      updateShieldUI(warningsUsed, maxWarnings);
    },
    onWarning: ({ warningsUsed, maxWarnings, reason, remainingSeconds }) => {
      showWarningCurtainUI(warningsUsed, maxWarnings, reason, remainingSeconds);
      syncHeartbeat();
    },
    onCountdownTick: ({ remainingSeconds }) => {
      const el = document.getElementById('warning-countdown-num');
      if (el) el.textContent = String(remainingSeconds);
    },
    onPersist: (proctorPatch) => {
      if (!attemptState) return;
      Object.assign(attemptState, proctorPatch);
      persistAttemptLocal();
    },
    onAutoSubmit: ({ reason, warningsUsed, violations }) => {
      if (attemptState) {
        attemptState.warningsUsed = warningsUsed;
        attemptState.violations = violations;
      }
      // If student triggered auto-submit while early submission lock was active, flag as premature exit
      const remLockSec = getRemainingSubmissionLockSec();
      let finalReason = reason;
      if (remLockSec > 0) {
        finalReason = `${reason} (Premature Exit: ${Math.ceil(remLockSec / 60)}m early submission penalty)`;
      }
      finalizeQuizSubmission(finalReason, true);
    }
  });
  proctor.start();

  if (quizTimerInterval) clearInterval(quizTimerInterval);
  const tickQuizClock = () => {
    if (!attemptState) return;
    const remMs = attemptState.deadlineAt - Date.now();
    if (remMs <= 0) {
      clearInterval(quizTimerInterval);
      finalizeQuizSubmission('Time Limit Reached (Auto-Submitted)', true);
      return;
    }
    const totalSec = Math.ceil(remMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    document.getElementById('exam-timer-text').textContent = `${String(mins).padStart(
      2,
      '0'
    )}:${String(secs).padStart(2, '0')}`;

    const remSec = getRemainingSubmissionLockSec();
    const canSubmit = remSec <= 0;
    const desktopSubmitBtn = document.getElementById('btn-desktop-submit');
    const mobileSubmitBtn = document.getElementById('btn-open-submit-confirm');
    if (desktopSubmitBtn) {
      if (!canSubmit) {
        const m = Math.floor(remSec / 60);
        const s = remSec % 60;
        desktopSubmitBtn.textContent = `Submit Locked (${m > 0 ? `${m}m ` : ''}${s}s)`;
        desktopSubmitBtn.title = `Early submission locked by administrator until timer elapses.`;
      } else {
        desktopSubmitBtn.textContent = 'Finish & Submit Assessment';
        desktopSubmitBtn.title = '';
      }
    }
    if (mobileSubmitBtn) {
      if (!canSubmit) {
        const m = Math.floor(remSec / 60);
        const s = remSec % 60;
        mobileSubmitBtn.textContent = `Submit Locked (${m > 0 ? `${m}m ` : ''}${s}s)`;
      } else {
        mobileSubmitBtn.textContent = 'Finish & Submit Assessment Now';
      }
    }

    const pill = document.getElementById('exam-timer-pill');
    pill.classList.toggle('danger', totalSec <= 60);
    pill.classList.toggle('warn', totalSec > 60 && totalSec <= 300);
  };
  tickQuizClock();
  quizTimerInterval = setInterval(tickQuizClock, 500);

  syncHeartbeat();
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(syncHeartbeat, 10000);
}

function syncHeartbeat() {
  if (!attemptState || !candidate) return;
  const answeredCount = Object.keys(attemptState.answers || {}).length;
  upsertActiveSession({
    fullName: candidate.fullName,
    email: candidate.email,
    registerNumber: candidate.registerNumber,
    department: candidate.department || FIXED_DEPARTMENT,
    year: candidate.year,
    answeredCount,
    totalQuestions: preparedQuestions.length,
    warningsUsed: attemptState.warningsUsed || 0,
    maxWarnings: settings.maxWarnings ?? 2,
    inWarningState: Boolean(attemptState.warningOverlayOpen),
    startedAt: new Date(attemptState.startedAt).toISOString()
  });
}

function updateShieldUI(warningsUsed, maxWarnings) {
  const pill = document.getElementById('exam-shield-pill');
  const txt = document.getElementById('exam-warning-counter');
  txt.textContent = `${warningsUsed}/${maxWarnings} Warn`;
  pill.classList.toggle('has-warning', warningsUsed > 0);
}

function showWarningCurtainUI(warningsUsed, maxWarnings, reason, remainingSeconds) {
  const isFinal = warningsUsed >= maxWarnings;
  document.getElementById('warning-badge-text').textContent = isFinal
    ? `FINAL WARNING ${warningsUsed} OF ${maxWarnings}`
    : `SECURITY WARNING ${warningsUsed} OF ${maxWarnings}`;
  document.getElementById('warning-reason-text').textContent = reason;
  document.getElementById('warning-countdown-num').textContent = String(remainingSeconds);
  document.getElementById('warning-grace-label').textContent = `${settings.returnGraceSeconds ?? 20}s`;
  document.body.classList.add('security-curtain-active');
}

/* -------------------------------------------------------------------------- */
/* Question & Palette Rendering                                               */
/* -------------------------------------------------------------------------- */

// 3-Second First-View timer per question
let questionCooldownTimer = null;
let currentQuestionCanNavigate = true;

function getRemainingSubmissionLockSec() {
  if (!attemptState || !settings) return 0;
  const minMinutes = Number(settings.minSubmissionMinutes || 0);
  if (minMinutes <= 0) return 0;
  const minRequiredMs = minMinutes * 60 * 1000;
  const startedAt = Number(attemptState.startedAt || Date.now());
  const elapsedMs = Date.now() - startedAt;
  const remMs = minRequiredMs - elapsedMs;
  return remMs > 0 ? Math.ceil(remMs / 1000) : 0;
}

function canSubmitAssessment() {
  return getRemainingSubmissionLockSec() <= 0;
}

function notifySubmissionTimerRemaining() {
  const remSec = getRemainingSubmissionLockSec();
  if (remSec <= 0) return;
  const mins = Math.floor(remSec / 60);
  const secs = remSec % 60;
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  let toast = document.getElementById('cooldown-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cooldown-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '85px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#293262';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '999px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '700';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.pointerEvents = 'none';
    toast.style.transition = 'opacity 0.2s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = `⏳ Early submission locked: ${timeStr} remaining`;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 2000);
}

function canNavigateAwayFromCurrentQuestion() {
  if (!attemptState) return true;
  const idx = attemptState.currentIndex;
  attemptState.questionSpentSec = attemptState.questionSpentSec || {};
  return (attemptState.questionSpentSec[idx] || 0) >= 3;
}

function notifyCooldownRemaining() {
  if (!attemptState) return;
  const idx = attemptState.currentIndex;
  const spent = (attemptState.questionSpentSec && attemptState.questionSpentSec[idx]) || 0;
  const remaining = Math.max(1, 3 - spent);
  
  // Show brief floating toast or alert on palette
  let toast = document.getElementById('cooldown-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cooldown-toast';
    toast.style.position = 'fixed';
    toast.style.bottom = '85px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = '#293262';
    toast.style.color = '#fff';
    toast.style.padding = '8px 16px';
    toast.style.borderRadius = '999px';
    toast.style.fontSize = '12px';
    toast.style.fontWeight = '700';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.pointerEvents = 'none';
    toast.style.transition = 'opacity 0.2s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = `⏱ Please review for ${remaining}s before switching`;
  toast.style.opacity = '1';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 1200);
}

function updatePaletteDisabledState() {
  const isLocked = !canNavigateAwayFromCurrentQuestion();
  const currentIdx = attemptState ? attemptState.currentIndex : -1;
  document.querySelectorAll('.palette-cell').forEach(btn => {
    const btnIdx = Number(btn.getAttribute('data-q-idx'));
    if (isLocked && btnIdx !== currentIdx) {
      btn.classList.add('palette-locked');
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.classList.remove('palette-locked');
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  });

  const prevBtn = document.getElementById('btn-prev-q');
  if (prevBtn && isLocked) {
    prevBtn.disabled = true;
  } else if (prevBtn && currentIdx > 0) {
    prevBtn.disabled = false;
  }
}

function startQuestionCooldown() {
  if (questionCooldownTimer) clearInterval(questionCooldownTimer);

  const idx = attemptState.currentIndex;
  attemptState.questionSpentSec = attemptState.questionSpentSec || {};

  const nextBtn = document.getElementById('btn-next-q');
  const desktopSubmitBtn = document.getElementById('btn-desktop-submit');

  const alreadyMet = (attemptState.questionSpentSec[idx] || 0) >= 3;
  if (alreadyMet) {
    currentQuestionCanNavigate = true;
    if (nextBtn) nextBtn.disabled = false;
    if (desktopSubmitBtn) desktopSubmitBtn.disabled = false;
    updatePaletteDisabledState();
    return;
  }

  currentQuestionCanNavigate = false;

  // Disable Next until 3 seconds spent for first time viewing this question
  let remainingSec = 3 - (attemptState.questionSpentSec[idx] || 0);
  const originalText = idx === preparedQuestions.length - 1 ? 'Finish & Submit ✓' : 'Next →';

  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.textContent = `${originalText} (${remainingSec}s)`;
  }
  if (desktopSubmitBtn) {
    desktopSubmitBtn.disabled = true;
  }
  updatePaletteDisabledState();

  questionCooldownTimer = setInterval(() => {
    remainingSec--;
    attemptState.questionSpentSec[idx] = 3 - remainingSec;
    if (remainingSec <= 0) {
      clearInterval(questionCooldownTimer);
      questionCooldownTimer = null;
      currentQuestionCanNavigate = true;
      attemptState.questionSpentSec[idx] = 3;
      persistAttemptLocal();
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = originalText;
      }
      if (desktopSubmitBtn) {
        desktopSubmitBtn.disabled = false;
      }
      updatePaletteDisabledState();
    } else {
      if (nextBtn) {
        nextBtn.textContent = `${originalText} (${remainingSec}s)`;
      }
      updatePaletteDisabledState();
    }
  }, 1000);
}

function renderCurrentQuestion() {
  if (!attemptState || !preparedQuestions.length) return;
  const idx = attemptState.currentIndex;
  const q = preparedQuestions[idx];
  const total = preparedQuestions.length;

  attemptState.visited = attemptState.visited || {};
  attemptState.visited[idx] = true;

  const answeredCount = Object.keys(attemptState.answers).length;
  document.getElementById('answered-counter-text').textContent = `${answeredCount}/${total}`;
  document.getElementById('exam-progress-fill').style.width = `${Math.round(
    ((idx + 1) / total) * 100
  )}%`;

  const slotBadge = document.getElementById('desktop-slot-indicator');
  if (slotBadge) {
    slotBadge.textContent = `Slot ${attemptState.slot || settings.activeSlot || 1}`;
  }

  const canvas = document.getElementById('question-canvas');
  const fallbackEl = document.getElementById('question-fallback-text');
  renderProtectedQuestionCanvas(canvas, {
    questionNumber: idx + 1,
    totalQuestions: total,
    category: q.category,
    questionText: q.question,
    watermarkText: settings.watermarkRegNo !== false ? candidate.registerNumber : '',
    canvasAntiSearch: settings.canvasAntiSearch !== false,
    fallbackTextEl: fallbackEl
  });

  const container = document.getElementById('options-container');
  container.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const selectedIdx = attemptState.answers[q.id];

  q.options.forEach((optText, optIdx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option-btn' + (selectedIdx === optIdx ? ' selected' : '');

    const badge = document.createElement('span');
    badge.className = 'option-letter';
    badge.textContent = q.type === 'tf' ? (optIdx === 0 ? 'T' : 'F') : letters[optIdx] || String(optIdx + 1);

    const label = document.createElement('span');
    label.textContent = optText;

    btn.appendChild(badge);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      attemptState.answers[q.id] = optIdx;
      persistAttemptLocal();
      renderCurrentQuestion();
    });

    container.appendChild(btn);
  });

  document.getElementById('btn-prev-q').disabled = idx === 0;
  const flagBtn = document.getElementById('btn-flag-q');
  const isFlagged = Boolean(attemptState.flagged[q.id]);
  flagBtn.textContent = isFlagged ? '⚑ Marked' : '⚑ Review';
  flagBtn.style.borderColor = isFlagged ? '#d97706' : '';
  flagBtn.style.background = isFlagged ? '#fffbeb' : '';
  flagBtn.style.color = isFlagged ? '#b45309' : '';

  const nextBtn = document.getElementById('btn-next-q');
  if (idx === total - 1) {
    nextBtn.textContent = 'Finish & Submit ✓';
    nextBtn.className = 'btn btn-primary';
  } else {
    nextBtn.textContent = 'Next →';
    nextBtn.className = 'btn btn-primary';
  }

  // Start the 3-second reading delay for first-time visits
  startQuestionCooldown();

  // Update both mobile drawer & desktop sidebar palettes
  renderPaletteGrid();
  renderDesktopPaletteSidebar();
}

function getQuestionStatus(q, idx) {
  const isAnswered = attemptState.answers[q.id] !== undefined;
  const isFlagged = Boolean(attemptState.flagged[q.id]);
  const isVisited = Boolean(attemptState.visited && attemptState.visited[idx]);

  if (isFlagged) return 'flagged';
  if (isAnswered) return 'answered';
  if (isVisited) return 'not-answered';
  return 'not-visited';
}

function renderPaletteGrid() {
  const grid = document.getElementById('palette-grid');
  if (!grid) return;
  grid.innerHTML = '';
  preparedQuestions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-q-idx', String(idx));
    const status = getQuestionStatus(q, idx);
    const isCurrent = idx === attemptState.currentIndex;

    btn.className = `palette-cell ${status}${isCurrent ? ' current' : ''}`;
    btn.textContent = String(idx + 1);
    btn.addEventListener('click', () => {
      if (idx === attemptState.currentIndex) return;
      if (!canNavigateAwayFromCurrentQuestion()) {
        notifyCooldownRemaining();
        return;
      }
      attemptState.currentIndex = idx;
      attemptState.visited = attemptState.visited || {};
      attemptState.visited[idx] = true;
      persistAttemptLocal();
      document.getElementById('palette-drawer').classList.add('hidden');
      renderCurrentQuestion();
    });
    grid.appendChild(btn);
  });
  updatePaletteDisabledState();
}

function renderDesktopPaletteSidebar() {
  const grid = document.getElementById('desktop-palette-grid');
  if (!grid) return;
  grid.innerHTML = '';

  let countAnswered = 0;
  let countNotAnswered = 0;
  let countFlagged = 0;
  let countNotVisited = 0;

  preparedQuestions.forEach((q, idx) => {
    const status = getQuestionStatus(q, idx);
    if (status === 'answered') countAnswered++;
    else if (status === 'not-answered') countNotAnswered++;
    else if (status === 'flagged') countFlagged++;
    else countNotVisited++;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-q-idx', String(idx));
    const isCurrent = idx === attemptState.currentIndex;
    btn.className = `palette-cell ${status}${isCurrent ? ' current' : ''}`;
    btn.textContent = String(idx + 1);
    btn.title = `Question ${idx + 1}: ${status.replace('-', ' ').toUpperCase()}`;

    btn.addEventListener('click', () => {
      if (idx === attemptState.currentIndex) return;
      if (!canNavigateAwayFromCurrentQuestion()) {
        notifyCooldownRemaining();
        return;
      }
      attemptState.currentIndex = idx;
      attemptState.visited = attemptState.visited || {};
      attemptState.visited[idx] = true;
      persistAttemptLocal();
      renderCurrentQuestion();
    });
    grid.appendChild(btn);
  });
  updatePaletteDisabledState();

  const elA = document.getElementById('leg-count-answered');
  if (elA) elA.textContent = String(countAnswered);
  const elNA = document.getElementById('leg-count-not-answered');
  if (elNA) elNA.textContent = String(countNotAnswered);
  const elF = document.getElementById('leg-count-flagged');
  if (elF) elF.textContent = String(countFlagged);
  const elNV = document.getElementById('leg-count-not-visited');
  if (elNV) elNV.textContent = String(countNotVisited);
}

function openSubmitConfirmation() {
  const answered = Object.keys(attemptState.answers).length;
  const total = preparedQuestions.length;
  const unanswered = total - answered;
  document.getElementById('submit-summary-text').textContent =
    unanswered === 0
      ? `Great job! You have answered all ${total} questions. Ready to submit?`
      : `You have answered ${answered} of ${total} questions (${unanswered} unanswered). Once submitted, you cannot re-enter.`;
  document.getElementById('submit-confirm-modal').classList.remove('hidden');
}

/* -------------------------------------------------------------------------- */
/* Submission, Grading & Automated CAMS Certificate Trigger                   */
/* -------------------------------------------------------------------------- */

let isSubmittingNow = false;

async function finalizeQuizSubmission(submitReason = 'Manual Submit', isAutoSubmitted = false) {
  if (isSubmittingNow || !attemptState) return;
  isSubmittingNow = true;

  if (proctor) proctor.stop();
  if (quizTimerInterval) clearInterval(quizTimerInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  ExamProctor.exitFullscreenSafe();

  let score = 0;
  const detailedBreakdown = preparedQuestions.map((q) => {
    const chosenIdx = attemptState.answers[q.id];
    const isCorrect = chosenIdx !== undefined && chosenIdx === q.correctShuffledIndex;
    if (isCorrect) score++;
    return {
      questionId: q.id,
      question: q.question,
      selectedText: chosenIdx !== undefined ? q.options[chosenIdx] : '(Not Answered)',
      correctText: q.options[q.correctShuffledIndex],
      isCorrect,
      explanation: q.explanation
    };
  });

  const totalQuestions = preparedQuestions.length;
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - attemptState.startedAt) / 1000));

  const remLockSec = getRemainingSubmissionLockSec();
  const prematureExit = isAutoSubmitted && remLockSec > 0;

  const submissionPayload = {
    fullName: candidate.fullName,
    email: candidate.email,
    registerNumber: candidate.registerNumber,
    phone: candidate.phone,
    slot: candidate.slot || attemptState.slot || Number(settings.activeSlot || 1),
    assessmentId: settings.assessmentId || 'default',
    department: FIXED_DEPARTMENT,
    year: candidate.year,
    college: FIXED_COLLEGE,
    score,
    totalQuestions,
    percentage,
    answeredCount: Object.keys(attemptState.answers).length,
    elapsedSeconds,
    warningsUsed: attemptState.warningsUsed || 0,
    maxWarnings: settings.maxWarnings ?? 2,
    violations: attemptState.violations || [],
    submitReason,
    isAutoSubmitted,
    prematureExit,
    retakeRequested: false,
    breakdown: detailedBreakdown,
    submittedAt: new Date().toISOString()
  };

  clearAttemptLocal();
  const savedRecord = await recordQuizSubmission(submissionPayload);
  await removeActiveSession(candidate.email, candidate.registerNumber);

  renderResultScreen(savedRecord, false);
}

/* -------------------------------------------------------------------------- */
/* Result View Rendering                                                      */
/* -------------------------------------------------------------------------- */

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function renderResultScreen(record, isReturningLookup) {
  showScreen('result');

  document.getElementById('result-mode-chip').textContent = isReturningLookup
    ? 'Verified Submission'
    : record.isAutoSubmitted
    ? 'Auto-Submitted & Recorded'
    : 'Successfully Recorded';

  const headingEl = document.getElementById('result-heading');
  if (headingEl) {
    headingEl.textContent = isReturningLookup
      ? 'Your Assessment Has Been Verified & Recorded'
      : record.isAutoSubmitted
      ? 'Assessment Session Closed & Response Recorded'
      : 'Your Assessment Has Been Successfully Recorded';
  }

  document.getElementById('result-candidate-line').textContent = `${record.fullName} · ${
    record.registerNumber
  } (${record.year || 'Candidate'})`;

  const visibility = settings.resultVisibility || 'score_only';
  const scoreSection = document.getElementById('result-score-section');
  if (visibility === 'receipt_only') {
    scoreSection.classList.add('hidden');
  } else {
    scoreSection.classList.remove('hidden');
    document.getElementById('result-score-fraction').textContent = `${record.score}/${record.totalQuestions}`;
    document.getElementById('result-score-percent').textContent = `${record.percentage}% Accuracy`;
  }

  document.getElementById('result-time-taken').textContent = formatDuration(record.elapsedSeconds || 0);
  document.getElementById('result-warnings-used').textContent = `${record.warningsUsed || 0} / ${
    record.maxWarnings ?? 2
  }`;
  document.getElementById('result-submit-type').textContent = record.isAutoSubmitted
    ? 'Auto-Submit'
    : 'Completed';

  const autoAlert = document.getElementById('result-autosubmit-alert');
  if (record.isAutoSubmitted) {
    autoAlert.textContent = record.submitReason || 'Auto-submitted by security proctor.';
    autoAlert.classList.remove('hidden');
  } else {
    autoAlert.classList.add('hidden');
  }

  // Handle Retake Request Section
  const retakeSec = document.getElementById('result-retake-section');
  const reqBtn = document.getElementById('btn-request-retake');
  const reqStatus = document.getElementById('retake-request-status');
  if (retakeSec && reqBtn) {
    if (record.isAutoSubmitted || record.retakeRequested) {
      retakeSec.classList.remove('hidden');
      if (record.retakeRequested) {
        reqBtn.disabled = true;
        reqBtn.textContent = 'Retake Request Submitted ✓';
        reqStatus.textContent = 'Your retake request has been submitted to the administrator and is pending approval.';
        reqStatus.classList.remove('hidden');
      } else {
        reqBtn.disabled = false;
        reqBtn.textContent = 'Request Retake from Admin ✉';
        reqStatus.classList.add('hidden');
        reqBtn.onclick = async () => {
          const reason = prompt('Please explain the reason for requesting a retake (e.g., accidental tab switch, phone call):', 'Accidental window focus interruption');
          if (reason === null) return;
          reqBtn.disabled = true;
          reqBtn.textContent = 'Submitting Request...';
          try {
            await requestStudentRetake(record.id, reason);
            record.retakeRequested = true;
            reqBtn.textContent = 'Retake Request Submitted ✓';
            reqStatus.textContent = 'Your retake request has been recorded and flagged in the Admin Dashboard.';
            reqStatus.classList.remove('hidden');
          } catch (err) {
            alert('Failed to send retake request: ' + err.message);
            reqBtn.disabled = false;
            reqBtn.textContent = 'Request Retake from Admin ✉';
          }
        };
      }
    } else {
      retakeSec.classList.add('hidden');
    }
  }

  const reviewWrap = document.getElementById('result-answers-review');
  const reviewList = document.getElementById('result-answers-list');
  if (visibility === 'full_answers' && Array.isArray(record.breakdown)) {
    reviewWrap.classList.remove('hidden');
    reviewList.innerHTML = '';
    record.breakdown.forEach((item, i) => {
      const box = document.createElement('div');
      box.style.padding = '12px 14px';
      box.style.borderRadius = '12px';
      box.style.background = '#fbf9ff';
      box.style.border = `1.5px solid ${
        item.isCorrect ? 'rgba(4, 120, 87, 0.35)' : 'rgba(185, 28, 28, 0.35)'
      }`;
      box.innerHTML = `
        <div style="font-size:13.5px; font-weight:700; margin-bottom:6px; color:#1e1035;">Q${i + 1}. ${escapeHtml(
        item.question
      )}</div>
        <div style="font-size:12.5px; color:${item.isCorrect ? '#047857' : '#b91c1c'};">
          Your Answer: <b>${escapeHtml(item.selectedText)}</b> ${item.isCorrect ? '✓' : '✕'}
        </div>
        ${
          !item.isCorrect
            ? `<div style="font-size:12.5px; color:#047857; margin-top:2px;">Correct Answer: <b>${escapeHtml(
                item.correctText
              )}</b></div>`
            : ''
        }
        ${
          item.explanation
            ? `<div style="font-size:12px; color:#4a3869; margin-top:6px;">${escapeHtml(
                item.explanation
              )}</div>`
            : ''
        }
      `;
      reviewList.appendChild(box);
    });
  } else {
    reviewWrap.classList.add('hidden');
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initPortal();
