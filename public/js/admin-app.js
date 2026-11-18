/**
 * Unistring Tech Solution - Coordinator Admin Console Logic
 */

import {
  allowStudentRetake,
  getActiveAdminSession,
  getBackendStatus,
  loadPortalSettings,
  loadQuestions,
  loginAdmin,
  logoutAdmin,
  resetQuestionsToDefault,
  savePortalSettings,
  saveQuestions,
  subscribeToAdminData
} from './db-service.js';

let settings = null;
let questions = [];
let allSubmissions = [];
let liveSessions = [];
let unsubData = null;

const loginView = document.getElementById('admin-login-view');
const dashView = document.getElementById('admin-dashboard-view');

/* -------------------------------------------------------------------------- */
/* Startup & Auth Gate                                                        */
/* -------------------------------------------------------------------------- */

async function initAdmin() {
  bindLoginEvents();
  bindDashboardEvents();

  const session = await getActiveAdminSession();
  if (session) {
    await enterDashboard(session);
  } else {
    showLoginView();
  }
}

function showLoginView() {
  if (unsubData) {
    unsubData();
    unsubData = null;
  }
  dashView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

async function enterDashboard(session) {
  loginView.classList.add('hidden');
  dashView.classList.remove('hidden');

  const backend = await getBackendStatus();
  const modeLabel =
    backend.mode === 'firebase' && backend.firestoreCloudHealthy
      ? `Cloud Firestore Live (${backend.projectId})`
      : backend.mode === 'firebase'
      ? `Connected to ${backend.projectId} (Cloud Sync Active)`
      : 'Local Sync Mode';
  document.getElementById('admin-backend-badge').textContent = `${session.email} · ${modeLabel}`;

  settings = await loadPortalSettings();
  currentManagingSlot = Number(settings.activeSlot || 1);
  questions = await loadQuestions(currentManagingSlot);

  applyBrandingLogos(settings?.logoUrl);
  populateSettingsForms();
  await refreshQuestionsSlotView();

  if (unsubData) unsubData();
  unsubData = await subscribeToAdminData(({ submissions, activeSessions }) => {
    allSubmissions = submissions || [];
    liveSessions = activeSessions || [];
    renderKPIs();
    renderLiveSessions();
    renderSubmissionsTable();
  });
}

function showToast(msg, isError = false) {
  const el = document.getElementById('admin-toast');
  el.textContent = msg;
  el.className = `alert ${isError ? 'alert-error' : 'alert-success'}`;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function applyBrandingLogos(url) {
  const activeUrl = url || '/assets/uts-logo.png';
  const ids = [
    'login-header-logo',
    'login-showcase-logo',
    'dash-header-logo',
    'admin-logo-preview'
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.src = activeUrl;
  });
}

/* -------------------------------------------------------------------------- */
/* Login Events                                                               */
/* -------------------------------------------------------------------------- */

function bindLoginEvents() {
  const pwInput = document.getElementById('admin-password');
  const toggleBtn = document.getElementById('btn-toggle-pw');
  toggleBtn.addEventListener('click', () => {
    const isPw = pwInput.type === 'password';
    pwInput.type = isPw ? 'text' : 'password';
    toggleBtn.textContent = isPw ? 'Hide' : 'Show';
  });

  document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('admin-login-error');
    errEl.classList.add('hidden');

    const email = document.getElementById('admin-email').value.trim();
    const password = pwInput.value;

    const btn = document.getElementById('btn-admin-signin');
    btn.disabled = true;
    btn.textContent = 'Verifying Admin Credentials...';

    try {
      const session = await loginAdmin(email, password);
      pwInput.value = '';
      await enterDashboard(session);
    } catch (err) {
      errEl.textContent = err?.message || 'Authentication failed.';
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In to Admin Console →';
    }
  });

  document.getElementById('btn-admin-logout').addEventListener('click', async () => {
    await logoutAdmin();
    showLoginView();
  });
}

let currentManagingSlot = 1;

/* -------------------------------------------------------------------------- */
/* Dashboard Events & Tabs                                                    */
/* -------------------------------------------------------------------------- */

function bindDashboardEvents() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.admin-tab-panel').forEach((p) => {
        p.classList.toggle('hidden', p.id !== `tab-${target}`);
      });
      if (target === 'questions') {
        refreshQuestionsSlotView();
      }
    });
  });

  // Overall Quick Open/Close toggle
  document.getElementById('btn-quick-toggle-quiz').addEventListener('click', async () => {
    settings = await savePortalSettings({ quizOpen: !settings.quizOpen });
    populateSettingsForms();
    showToast(settings.quizOpen ? 'Assessment is now OPEN for candidates.' : 'Assessment is now PAUSED.');
  });

  // Slot 1 & Slot 2 Select / Toggle in Quick Bar
  const slot1Btn = document.getElementById('btn-select-slot-1');
  if (slot1Btn) {
    slot1Btn.addEventListener('click', async () => {
      // Toggle or activate Slot 1
      const isCurrentlyActive = Number(settings.activeSlot || 1) === 1;
      const newSlot1Open = isCurrentlyActive ? !settings.slot1Open : true;
      settings = await savePortalSettings({
        activeSlot: 1,
        slot1Open: newSlot1Open
      });
      populateSettingsForms();
      showToast(`Slot 1 is now ${newSlot1Open ? 'ACTIVE & OPEN' : 'PAUSED'} for candidates.`);
    });
  }

  const slot2Btn = document.getElementById('btn-select-slot-2');
  if (slot2Btn) {
    slot2Btn.addEventListener('click', async () => {
      // Toggle or activate Slot 2
      const isCurrentlyActive = Number(settings.activeSlot || 1) === 2;
      const newSlot2Open = isCurrentlyActive ? !settings.slot2Open : true;
      settings = await savePortalSettings({
        activeSlot: 2,
        slot2Open: newSlot2Open
      });
      populateSettingsForms();
      showToast(`Slot 2 is now ${newSlot2Open ? 'ACTIVE & OPEN' : 'PAUSED'} for candidates.`);
    });
  }

  // Question Bank Slot Switchers (Tab 3)
  const tabSlot1Btn = document.getElementById('btn-tab-slot-1');
  if (tabSlot1Btn) {
    tabSlot1Btn.addEventListener('click', async () => {
      currentManagingSlot = 1;
      await refreshQuestionsSlotView();
    });
  }

  const tabSlot2Btn = document.getElementById('btn-tab-slot-2');
  if (tabSlot2Btn) {
    tabSlot2Btn.addEventListener('click', async () => {
      currentManagingSlot = 2;
      await refreshQuestionsSlotView();
    });
  }

  // Quick Result Visibility selector
  document.getElementById('quick-result-visibility').addEventListener('change', async (e) => {
    settings = await savePortalSettings({ resultVisibility: e.target.value });
    showToast('Updated candidate post-submission result display mode.');
  });

  // Search & Filter & Sort
  document.getElementById('sub-search-input').addEventListener('input', renderSubmissionsTable);
  document.getElementById('sub-filter-select').addEventListener('change', renderSubmissionsTable);
  const sortSel = document.getElementById('sub-sort-select');
  if (sortSel) sortSel.addEventListener('change', renderSubmissionsTable);

  // Save Clock Unlock Schedule
  const saveUnlocksBtn = document.getElementById('btn-save-slot-unlocks');
  if (saveUnlocksBtn) {
    saveUnlocksBtn.addEventListener('click', async () => {
      const s1Val = document.getElementById('cfg-slot1-unlock').value;
      const s2Val = document.getElementById('cfg-slot2-unlock').value;
      settings = await savePortalSettings({
        slot1UnlockAt: s1Val ? new Date(s1Val).toISOString() : '',
        slot2UnlockAt: s2Val ? new Date(s2Val).toISOString() : ''
      });
      populateSettingsForms();
      showToast('Saved slot scheduled clock unlock settings.');
    });
  }

  // CSV Export
  document.getElementById('btn-export-full-csv').addEventListener('click', () => {
    if (!allSubmissions.length) return showToast('No submissions to export yet.', true);
    const csv = buildDetailedResultsCsv(allSubmissions);
    downloadTextFile(csv, `UTS_Placement_Results_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
  });

  // Settings Form (Tab 2)
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    settings = await savePortalSettings({
      quizTitle: document.getElementById('cfg-quiz-title').value.trim(),
      conductedBy: document.getElementById('cfg-conducted-by').value.trim(),
      durationMinutes: Math.max(5, Number(document.getElementById('cfg-duration').value || 30)),
      minSubmissionMinutes: Math.max(0, Number(document.getElementById('cfg-min-submit')?.value || 0)),
      examAccessCode: document.getElementById('cfg-hall-pin').value.trim(),
      maxWarnings: Math.max(0, Number(document.getElementById('cfg-max-warnings').value ?? 2)),
      returnGraceSeconds: Math.max(5, Number(document.getElementById('cfg-grace-sec').value ?? 20)),
      shuffleQuestions: document.getElementById('cfg-shuffle-q').checked,
      shuffleOptions: document.getElementById('cfg-shuffle-opt').checked,
      requireFullscreen: document.getElementById('cfg-fullscreen').checked,
      canvasAntiSearch: document.getElementById('cfg-canvas-shield').checked,
      watermarkRegNo: document.getElementById('cfg-watermark').checked
    });
    populateSettingsForms();
    showToast('Saved assessment & security configuration.');
  });

  // Logo file upload
  const logoInput = document.getElementById('logo-file-input');
  logoInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file (PNG, JPG, SVG, WebP).', true);
      return;
    }

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      settings = await savePortalSettings({ logoUrl: dataUrl });
      applyBrandingLogos(dataUrl);
      showToast('Company logo updated successfully!');
    };
    reader.onerror = () => {
      showToast('Failed to read image file.', true);
    };
    reader.readAsDataURL(file);
    logoInput.value = '';
  });

  // Reset default logo
  document.getElementById('btn-reset-default-logo').addEventListener('click', async () => {
    settings = await savePortalSettings({ logoUrl: '/assets/uts-logo.png' });
    applyBrandingLogos('/assets/uts-logo.png');
    showToast('Restored default UTS logo.');
  });

  // Question Bank Buttons (Tab 3)
  document.getElementById('btn-add-question').addEventListener('click', () => openQuestionEditor(-1));
  document.getElementById('btn-reset-questions').addEventListener('click', async () => {
    if (!confirm(`Clear all questions currently in Slot ${currentManagingSlot}?`)) return;
    questions = await saveQuestions([], currentManagingSlot);
    await refreshQuestionsSlotView();
    showToast(`Cleared questions in Slot ${currentManagingSlot}.`);
  });

  // JSON Question Upload
  const jsonInput = document.getElementById('json-upload-input');
  document.getElementById('btn-upload-json').addEventListener('click', () => {
    jsonInput.click();
  });

  jsonInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed = JSON.parse(text);

      let rawList = [];
      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else if (parsed && Array.isArray(parsed.questions)) {
        rawList = parsed.questions;
      } else if (parsed && typeof parsed === 'object') {
        const firstArrayProp = Object.values(parsed).find((val) => Array.isArray(val));
        if (firstArrayProp) rawList = firstArrayProp;
      }

      if (!rawList || !rawList.length) {
        throw new Error('No question array found in JSON file. Expected format: [{ question, options, correctIndex }, ...]');
      }

      const normalized = rawList.map((q, idx) => {
        const questionText = String(q.question || q.prompt || q.title || '').trim();
        if (!questionText) {
          throw new Error(`Question #${idx + 1} is missing a question text string.`);
        }

        let opts = [];
        if (Array.isArray(q.options)) {
          opts = q.options.map((opt) => String(opt).trim());
        } else if (q.type === 'tf') {
          opts = ['True', 'False'];
        }

        if (opts.length < 2) {
          throw new Error(`Question #${idx + 1} ("${questionText.slice(0, 30)}...") must have at least 2 options.`);
        }

        let correctIdx = 0;
        if (typeof q.correctIndex === 'number') {
          correctIdx = Math.max(0, Math.min(opts.length - 1, q.correctIndex));
        } else if (typeof q.correctOption === 'number') {
          correctIdx = q.correctOption > 0 && q.correctOption <= opts.length ? q.correctOption - 1 : 0;
        } else if (q.answer !== undefined) {
          if (typeof q.answer === 'number') {
            correctIdx = Math.max(0, Math.min(opts.length - 1, q.answer));
          } else if (typeof q.answer === 'string') {
            const foundIdx = opts.findIndex(
              (o) => o.toLowerCase() === q.answer.trim().toLowerCase()
            );
            correctIdx = foundIdx >= 0 ? foundIdx : 0;
          }
        }

        return {
          id: q.id || Date.now() + idx,
          slot: currentManagingSlot,
          category: String(q.category || q.topic || 'General').trim(),
          type: q.type === 'tf' ? 'tf' : 'mcq',
          question: questionText,
          options: opts,
          correctIndex: correctIdx,
          explanation: String(q.explanation || '').trim()
        };
      });

      questions = normalized;
      await saveQuestions(questions, currentManagingSlot);
      await refreshQuestionsSlotView();
      showToast(`Successfully uploaded ${normalized.length} questions to Slot ${currentManagingSlot}!`);
    } catch (err) {
      showToast(`Failed to parse JSON file: ${err.message}`, true);
    } finally {
      jsonInput.value = '';
    }
  });

  // Download JSON Template
  document.getElementById('btn-download-json-template').addEventListener('click', () => {
    const template = [];
    for (let i = 1; i <= 50; i++) {
      template.push({
        id: i,
        category: i <= 25 ? 'Technical Aptitude' : 'Core Engineering',
        type: 'mcq',
        question: `Question ${i}: Enter your question text here?`,
        options: [
          'Option A (Correct Answer)',
          'Option B',
          'Option C',
          'Option D'
        ],
        correctIndex: 0,
        explanation: 'Detailed explanation for this question.'
      });
    }
    downloadTextFile(
      JSON.stringify(template, null, 2),
      `uts_50_questions_template_slot${currentManagingSlot}.json`,
      'application/json;charset=utf-8'
    );
  });

  // Export current questions JSON
  document.getElementById('btn-export-json').addEventListener('click', () => {
    if (!questions || !questions.length) {
      return showToast(`No questions in Slot ${currentManagingSlot} to export.`, true);
    }
    downloadTextFile(
      JSON.stringify(questions, null, 2),
      `uts_questions_slot${currentManagingSlot}_export_${todayStamp()}.json`,
      'application/json;charset=utf-8'
    );
  });

  // Question modal editor
  document.getElementById('qedit-type').addEventListener('change', () => {
    renderQuestionModalOptionInputs(document.getElementById('qedit-type').value, []);
  });
  document.getElementById('btn-cancel-qmodal').addEventListener('click', () => {
    document.getElementById('question-modal').classList.add('hidden');
  });
  document.getElementById('question-edit-form').addEventListener('submit', handleSaveQuestionModal);

  // Close Detail Modal
  document.getElementById('btn-close-detail-modal').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.add('hidden');
  });
}

/* -------------------------------------------------------------------------- */
/* Populate Forms & Render KPIs / Tables                                      */
/* -------------------------------------------------------------------------- */

function populateSettingsForms() {
  if (!settings) return;
  const openBtn = document.getElementById('btn-quick-toggle-quiz');
  if (settings.quizOpen) {
    openBtn.textContent = '● Assessment Status: OPEN';
    openBtn.className = 'btn btn-gold btn-sm';
  } else {
    openBtn.textContent = '⏸ Assessment Status: PAUSED';
    openBtn.className = 'btn btn-danger btn-sm';
  }

  // Update Slot Controls
  const activeSlot = Number(settings.activeSlot || 1);
  const slot1Open = settings.slot1Open !== false;
  const slot2Open = settings.slot2Open !== false;

  const slot1Btn = document.getElementById('btn-select-slot-1');
  const slot2Btn = document.getElementById('btn-select-slot-2');
  const s1Lbl = document.getElementById('slot1-state-label');
  const s2Lbl = document.getElementById('slot2-state-label');

  if (s1Lbl) s1Lbl.textContent = slot1Open ? 'ON' : 'OFF';
  if (s2Lbl) s2Lbl.textContent = slot2Open ? 'ON' : 'OFF';

  if (slot1Btn) {
    slot1Btn.className = activeSlot === 1
      ? (slot1Open ? 'btn btn-gold btn-sm' : 'btn btn-danger btn-sm')
      : 'btn btn-secondary btn-sm';
  }
  if (slot2Btn) {
    slot2Btn.className = activeSlot === 2
      ? (slot2Open ? 'btn btn-gold btn-sm' : 'btn btn-danger btn-sm')
      : 'btn btn-secondary btn-sm';
  }

  const slotBadge = document.getElementById('active-slot-badge');
  if (slotBadge) {
    slotBadge.textContent = `Slot ${activeSlot} Active for Students (${activeSlot === 1 ? (slot1Open ? 'OPEN' : 'PAUSED') : (slot2Open ? 'OPEN' : 'PAUSED')})`;
  }

  // Populate Clock Unlocks
  const s1DateInput = document.getElementById('cfg-slot1-unlock');
  if (s1DateInput) {
    s1DateInput.value = settings.slot1UnlockAt ? new Date(settings.slot1UnlockAt).toISOString().slice(0, 16) : '';
  }
  const s2DateInput = document.getElementById('cfg-slot2-unlock');
  if (s2DateInput) {
    s2DateInput.value = settings.slot2UnlockAt ? new Date(settings.slot2UnlockAt).toISOString().slice(0, 16) : '';
  }

  document.getElementById('quick-result-visibility').value =
    settings.resultVisibility || 'score_only';

  document.getElementById('cfg-quiz-title').value = settings.quizTitle || 'Placement Drive Assessment';
  document.getElementById('cfg-conducted-by').value = settings.conductedBy || 'Unistring Tech Solution';
  document.getElementById('cfg-duration').value = settings.durationMinutes ?? 45;
  const minSubEl = document.getElementById('cfg-min-submit');
  if (minSubEl) minSubEl.value = settings.minSubmissionMinutes ?? 0;
  document.getElementById('cfg-hall-pin').value = settings.examAccessCode || '';
  document.getElementById('cfg-max-warnings').value = settings.maxWarnings ?? 2;
  document.getElementById('cfg-grace-sec').value = settings.returnGraceSeconds ?? 20;

  document.getElementById('cfg-shuffle-q').checked = settings.shuffleQuestions !== false;
  document.getElementById('cfg-shuffle-opt').checked = settings.shuffleOptions !== false;
  document.getElementById('cfg-fullscreen').checked = settings.requireFullscreen !== false;
  document.getElementById('cfg-canvas-shield').checked = settings.canvasAntiSearch !== false;
  document.getElementById('cfg-watermark').checked = settings.watermarkRegNo !== false;

  applyBrandingLogos(settings.logoUrl);
}

function renderKPIs() {
  const total = allSubmissions.length;
  const avg =
    total > 0
      ? Math.round(allSubmissions.reduce((acc, s) => acc + Number(s.percentage || 0), 0) / total)
      : 0;
  const autoCount = allSubmissions.filter((s) => s.isAutoSubmitted).length;
  const warnTotal = allSubmissions.reduce((acc, s) => acc + Number(s.warningsUsed || 0), 0);

  // Filter live sessions updated within last 2 minutes
  const freshLive = liveSessions.filter((ls) => {
    const t = ls.lastUpdatedAt ? new Date(ls.lastUpdatedAt).getTime() : 0;
    return Date.now() - t < 120000;
  });

  document.getElementById('kpi-total-sub').textContent = String(total);
  document.getElementById('kpi-live-active').textContent = String(freshLive.length);
  document.getElementById('kpi-avg-score').textContent = `${avg}%`;
  document.getElementById('kpi-auto-sub').textContent = String(autoCount);
  document.getElementById('kpi-warnings').textContent = String(warnTotal);
}

function renderLiveSessions() {
  const card = document.getElementById('live-sessions-card');
  const list = document.getElementById('live-sessions-list');
  const freshLive = liveSessions.filter((ls) => {
    const t = ls.lastUpdatedAt ? new Date(ls.lastUpdatedAt).getTime() : 0;
    return Date.now() - t < 120000;
  });

  if (!freshLive.length) {
    card.classList.add('hidden');
    return;
  }

  card.classList.remove('hidden');
  list.innerHTML = '';
  freshLive.forEach((ls) => {
    const div = document.createElement('div');
    div.style.padding = '12px';
    div.style.borderRadius = '10px';
    div.style.background = '#fbf9ff';
    div.style.border = ls.inWarningState
      ? '1.5px solid #dc2626'
      : '1.5px solid rgba(217, 119, 6, 0.35)';
    div.innerHTML = `
      <div style="font-weight:800; font-size:13.5px; color:#3b0764;">${escapeHtml(ls.fullName)}</div>
      <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(ls.registerNumber)} · ${escapeHtml(ls.year || 'Candidate')}</div>
      <div style="display:flex; justify-content:space-between; margin-top:8px; font-size:12px;">
        <span>Progress: <b>${ls.answeredCount || 0}/${ls.totalQuestions || questions.length || 30}</b></span>
        <span style="color:${ls.warningsUsed > 0 ? '#b91c1c' : '#047857'}; font-weight:700;">
          ${ls.inWarningState ? '⚠ 20s LOCKOUT!' : `${ls.warningsUsed || 0}/${ls.maxWarnings ?? 2} Warn`}
        </span>
      </div>
    `;
    list.appendChild(div);
  });
}

function renderSubmissionsTable() {
  const tbody = document.getElementById('submissions-tbody');
  const q = document.getElementById('sub-search-input').value.trim().toLowerCase();
  const filter = document.getElementById('sub-filter-select').value;
  const sortMode = document.getElementById('sub-sort-select') ? document.getElementById('sub-sort-select').value : 'time_desc';

  let filtered = allSubmissions.filter((s) => {
    if (filter === 'slot1' && Number(s.slot || 1) !== 1) return false;
    if (filter === 'slot2' && Number(s.slot || 1) !== 2) return false;
    if (filter === 'autosubmit' && !s.isAutoSubmitted) return false;
    if (filter === 'warned' && !(Number(s.warningsUsed || 0) > 0)) return false;

    if (!q) return true;
    const hay = `${s.fullName} ${s.registerNumber} ${s.email} ${s.year || ''}`.toLowerCase();
    return hay.includes(q);
  });

  filtered.sort((a, b) => {
    switch (sortMode) {
      case 'time_asc':
        return String(a.submittedAt || '').localeCompare(String(b.submittedAt || ''));
      case 'time_desc':
        return String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''));
      case 'score_desc':
        return Number(b.score || 0) - Number(a.score || 0) || Number(b.percentage || 0) - Number(a.percentage || 0);
      case 'score_asc':
        return Number(a.score || 0) - Number(b.score || 0) || Number(a.percentage || 0) - Number(b.percentage || 0);
      case 'name_asc':
        return String(a.fullName || '').localeCompare(String(b.fullName || ''));
      case 'name_desc':
        return String(b.fullName || '').localeCompare(String(a.fullName || ''));
      case 'reg_asc':
        return String(a.registerNumber || '').localeCompare(String(b.registerNumber || ''));
      case 'warnings_desc':
        return Number(b.warningsUsed || 0) - Number(a.warningsUsed || 0);
      default:
        return 0;
    }
  });

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:var(--text-muted); padding:26px;">
          No matching submissions found.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach((s) => {
    const tr = document.createElement('tr');
    const mins = Math.floor((s.elapsedSeconds || 0) / 60);
    const secs = (s.elapsedSeconds || 0) % 60;

    const secTag = s.isAutoSubmitted
      ? `<span class="status-tag bad" title="${escapeHtml(s.submitReason)}">Auto-Submit (${s.warningsUsed || 0}W)</span>`
      : Number(s.warningsUsed || 0) > 0
      ? `<span class="status-tag warn">${s.warningsUsed}/${s.maxWarnings ?? 2} Warnings</span>`
      : `<span class="status-tag ok">Clean (0W)</span>`;

    tr.innerHTML = `
      <td>
        <div style="font-weight:700;">${escapeHtml(s.fullName)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(s.email)}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(s.phone || '')}</div>
      </td>
      <td>
        <div style="font-family:monospace; font-weight:800; color:#3b0764;">${escapeHtml(s.registerNumber)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">
          ${escapeHtml(s.year || 'Candidate')} · <span class="hero-chip" style="padding:2px 7px; font-size:10px;">Slot ${s.slot || 1}</span>
        </div>
      </td>
      <td>
        <strong style="font-size:15px; color:#5b21b6;">${s.score}/${s.totalQuestions}</strong>
        <div style="font-size:11.5px; color:#b45309; font-weight:700;">${s.percentage}%</div>
      </td>
      <td>${mins}m ${secs}s</td>
      <td>${secTag}</td>
      <td>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm act-inspect">Details</button>
          <button type="button" class="btn btn-danger btn-sm act-retake" title="Delete attempt & allow retake">↺ Retake</button>
        </div>
      </td>
    `;

    tr.querySelector('.act-inspect').addEventListener('click', () => openSubmissionModal(s));
    tr.querySelector('.act-retake').addEventListener('click', async () => {
      if (
        !confirm(
          `Allow ${s.fullName} (${s.registerNumber}) to retake the assessment? This clears their current submission record.`
        )
      )
        return;
      await allowStudentRetake(s.id);
      showToast(`Cleared submission for ${s.fullName}. They may now re-attempt.`);
    });

    tbody.appendChild(tr);
  });
}

function openSubmissionModal(s) {
  document.getElementById('detail-modal-title').textContent = `${s.fullName} (${s.registerNumber})`;
  const body = document.getElementById('detail-modal-body');

  const violations = Array.isArray(s.violations) ? s.violations : [];
  const violationHtml = violations.length
    ? violations
        .map(
          (v) => `
        <div style="padding:8px 10px; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:12.5px; margin-bottom:6px;">
          <strong>Incident #${v.incidentNumber}:</strong> ${escapeHtml(v.reason)}
          <div style="font-size:11px; color:#7f1d1d;">${new Date(v.timestamp).toLocaleString()}</div>
        </div>`
        )
        .join('')
    : `<div style="font-size:13px; color:#047857; font-weight:600;">✓ Zero security violations recorded.</div>`;

  const breakdownHtml = Array.isArray(s.breakdown)
    ? s.breakdown
        .map(
          (b, idx) => `
        <div style="padding:8px 10px; border-bottom:1px solid rgba(91,33,182,0.1); font-size:12.5px;">
          <div style="color:#1e1035;"><strong>Q${idx + 1}.</strong> ${escapeHtml(b.question)}</div>
          <div style="color:${b.isCorrect ? '#047857' : '#b91c1c'}; margin-top:2px;">
            Selected: <b>${escapeHtml(b.selectedText)}</b> ${
            b.isCorrect ? '✓' : `(Correct: ${escapeHtml(b.correctText)})`
          }
          </div>
        </div>`
        )
        .join('')
    : '';

  body.innerHTML = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:13px; margin-bottom:14px; padding:12px; background:#fbf9ff; border:1px solid rgba(217,119,6,0.3); border-radius:10px;">
      <div><strong>Email:</strong> ${escapeHtml(s.email)}</div>
      <div><strong>Mobile:</strong> ${escapeHtml(s.phone || '-')}</div>
      <div><strong>Batch / Year:</strong> ${escapeHtml(s.year || '-')}</div>
      <div><strong>Company:</strong> Unistring Tech Solution</div>
      <div><strong>Score:</strong> ${s.score}/${s.totalQuestions} (${s.percentage}%)</div>
      <div><strong>Submit Reason:</strong> ${escapeHtml(s.submitReason || 'Manual Submit')}</div>
    </div>

    <h4 style="margin:12px 0 8px; font-size:14px; color:#3b0764;">Proctoring &amp; Violation Timeline (${violations.length})</h4>
    ${violationHtml}

    <h4 style="margin:16px 0 8px; font-size:14px; color:#3b0764;">Question-by-Question Responses</h4>
    <div style="max-height:280px; overflow-y:auto; border:1px solid rgba(91,33,182,0.16); border-radius:10px; background:#fff;">
      ${breakdownHtml || '<div style="padding:12px; color:var(--text-muted);">No breakdown available.</div>'}
    </div>
  `;

  document.getElementById('detail-modal').classList.remove('hidden');
}

/* -------------------------------------------------------------------------- */
/* Question Bank Editor (Tab 3: Slot 1 & Slot 2)                              */
/* -------------------------------------------------------------------------- */

async function refreshQuestionsSlotView() {
  questions = await loadQuestions(currentManagingSlot);

  const slot1Questions = await loadQuestions(1);
  const slot2Questions = await loadQuestions(2);

  const s1CountEl = document.getElementById('slot1-count');
  if (s1CountEl) s1CountEl.textContent = String(slot1Questions.length);
  const s2CountEl = document.getElementById('slot2-count');
  if (s2CountEl) s2CountEl.textContent = String(slot2Questions.length);

  const slot1TabBtn = document.getElementById('btn-tab-slot-1');
  const slot2TabBtn = document.getElementById('btn-tab-slot-2');
  if (slot1TabBtn) slot1TabBtn.className = currentManagingSlot === 1 ? 'btn btn-gold btn-sm' : 'btn btn-secondary btn-sm';
  if (slot2TabBtn) slot2TabBtn.className = currentManagingSlot === 2 ? 'btn btn-gold btn-sm' : 'btn btn-secondary btn-sm';

  const titleEl = document.getElementById('current-managing-slot-title');
  if (titleEl) titleEl.textContent = `Slot ${currentManagingSlot}`;

  document.querySelectorAll('.slot-name-btn-lbl').forEach((el) => {
    el.textContent = `Slot ${currentManagingSlot}`;
  });

  renderQuestionsBank();
}

function renderQuestionsBank() {
  const countStr = String(questions.length);
  document.getElementById('qbank-count').textContent = countStr;
  const tabCountEl = document.getElementById('tab-qbank-count');
  if (tabCountEl) tabCountEl.textContent = countStr;

  const wrap = document.getElementById('questions-admin-list');
  wrap.innerHTML = '';

  if (!questions.length) {
    wrap.innerHTML = `
      <div style="padding:32px 18px; text-align:center; background:#fbf9ff; border:2px dashed rgba(91,33,182,0.2); border-radius:12px;">
        <div style="font-size:16px; font-weight:800; color:#5b21b6; margin-bottom:6px;">No Questions in Slot ${currentManagingSlot}</div>
        <p style="font-size:13.5px; color:var(--text-muted); margin:0 0 14px;">
          Default questions removed. Click <strong>Upload Slot ${currentManagingSlot} JSON</strong> above or <strong>+ Add Question</strong> to populate this slot.
        </p>
      </div>
    `;
    return;
  }

  questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.style.padding = '14px';
    card.style.borderRadius = '12px';
    card.style.background = '#fbf9ff';
    card.style.border = '1px solid rgba(91, 33, 182, 0.16)';
    card.style.borderLeft = '3.5px solid #d97706';

    const optsHtml = q.options
      .map(
        (opt, oIdx) => `
        <div style="font-size:13px; padding:3px 0; font-weight:${
          oIdx === Number(q.correctIndex) ? '700' : '500'
        }; color:${
          oIdx === Number(q.correctIndex) ? '#047857' : 'var(--text-secondary)'
        };">
          ${oIdx === Number(q.correctIndex) ? '✓' : '○'} ${escapeHtml(opt)}
        </div>`
      )
      .join('');

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
        <div>
          <span style="font-size:11px; color:#5b21b6; font-weight:800; text-transform:uppercase;">
            Slot ${currentManagingSlot} · Q${idx + 1} · ${escapeHtml(q.category || 'General')} (${q.type === 'tf' ? 'True/False' : 'MCQ'})
          </span>
          <div style="font-weight:700; font-size:14.5px; margin:4px 0 8px; color:#1e1035;">${escapeHtml(q.question)}</div>
          ${optsHtml}
        </div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button type="button" class="btn btn-secondary btn-sm q-edit">Edit</button>
          <button type="button" class="btn btn-danger btn-sm q-del">✕</button>
        </div>
      </div>
    `;

    card.querySelector('.q-edit').addEventListener('click', () => openQuestionEditor(idx));
    card.querySelector('.q-del').addEventListener('click', async () => {
      if (!confirm(`Delete Question #${idx + 1} from Slot ${currentManagingSlot}?`)) return;
      questions.splice(idx, 1);
      await saveQuestions(questions, currentManagingSlot);
      await refreshQuestionsSlotView();
      showToast('Deleted question.');
    });

    wrap.appendChild(card);
  });
}

function openQuestionEditor(idx) {
  document.getElementById('qedit-idx').value = String(idx);
  const isNew = idx < 0;
  document.getElementById('qmodal-title').textContent = isNew
    ? 'Add New Question'
    : `Edit Question #${idx + 1}`;

  const q = isNew
    ? {
        category: 'Technical',
        type: 'mcq',
        question: '',
        options: ['', '', '', ''],
        correctIndex: 0,
        explanation: ''
      }
    : questions[idx];

  document.getElementById('qedit-category').value = q.category || '';
  document.getElementById('qedit-type').value = q.type || 'mcq';
  document.getElementById('qedit-prompt').value = q.question || '';
  document.getElementById('qedit-explanation').value = q.explanation || '';

  renderQuestionModalOptionInputs(q.type || 'mcq', q.options || [], q.correctIndex || 0);
  document.getElementById('question-modal').classList.remove('hidden');
}

function renderQuestionModalOptionInputs(type, values = [], correctIdx = 0) {
  const wrap = document.getElementById('qedit-options-wrap');
  const sel = document.getElementById('qedit-correct');
  wrap.innerHTML = '';
  sel.innerHTML = '';

  const opts = type === 'tf' ? ['True', 'False'] : [values[0] || '', values[1] || '', values[2] || '', values[3] || ''];
  const letters = ['A', 'B', 'C', 'D'];

  opts.forEach((val, i) => {
    const div = document.createElement('div');
    div.className = 'field';
    div.innerHTML = `
      <label>Option ${type === 'tf' ? i + 1 : letters[i]}</label>
      <input type="text" class="qedit-opt-input" value="${escapeHtml(val)}" ${type === 'tf' ? 'readonly' : 'required'} />
    `;
    wrap.appendChild(div);

    const optEl = document.createElement('option');
    optEl.value = String(i);
    optEl.textContent = type === 'tf' ? val : `Option ${letters[i]}`;
    if (i === Number(correctIdx)) optEl.selected = true;
    sel.appendChild(optEl);
  });
}

async function handleSaveQuestionModal(e) {
  e.preventDefault();
  const idx = Number(document.getElementById('qedit-idx').value);
  const type = document.getElementById('qedit-type').value;
  const options = Array.from(document.querySelectorAll('.qedit-opt-input')).map((el) =>
    el.value.trim()
  );

  const item = {
    id: idx >= 0 && questions[idx] ? questions[idx].id : Date.now(),
    slot: currentManagingSlot,
    category: document.getElementById('qedit-category').value.trim() || 'General',
    type,
    question: document.getElementById('qedit-prompt').value.trim(),
    options,
    correctIndex: Number(document.getElementById('qedit-correct').value),
    explanation: document.getElementById('qedit-explanation').value.trim()
  };

  if (idx >= 0) questions[idx] = item;
  else questions.push(item);

  await saveQuestions(questions, currentManagingSlot);
  document.getElementById('question-modal').classList.add('hidden');
  await refreshQuestionsSlotView();
  showToast(`Saved question to Slot ${currentManagingSlot}.`);
}

/* -------------------------------------------------------------------------- */
/* Utilities & CSV Export                                                     */
/* -------------------------------------------------------------------------- */

function buildDetailedResultsCsv(submissions) {
  const headers = [
    'Submitted At',
    'Full Name',
    'Candidate ID',
    'Email',
    'Mobile',
    'Batch',
    'Score',
    'Total Questions',
    'Percentage',
    'Time Seconds',
    'Warnings Used',
    'Auto Submitted',
    'Submit Reason'
  ];

  const rows = submissions.map((s) => [
    s.submittedAt || '',
    s.fullName || '',
    s.registerNumber || '',
    s.email || '',
    s.phone || '',
    s.year || '',
    s.score ?? 0,
    s.totalQuestions ?? (questions.length || 30),
    `${s.percentage ?? 0}%`,
    s.elapsedSeconds ?? 0,
    s.warningsUsed ?? 0,
    s.isAutoSubmitted ? 'YES' : 'NO',
    s.submitReason || ''
  ]);

  return [headers, ...rows]
    .map((r) =>
      r
        .map((c) => {
          const str = String(c ?? '');
          return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        })
        .join(',')
    )
    .join('\r\n');
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

initAdmin();
