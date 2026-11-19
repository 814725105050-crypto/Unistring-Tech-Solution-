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
  subscribeToAdminData,
  subscribeToPortalSettings
} from './db-service.js';

let settings = null;
let questions = [];
let allSubmissions = [];
let liveSessions = [];
let unsubData = null;
let unsubSettings = null;
let viewingResponseSlot = 'active'; // 'active' | 'all' | 1 | 2 | 3 ...

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
  if (unsubSettings) {
    unsubSettings();
    unsubSettings = null;
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

  // Real-time live synchronization for settings & ON/OFF states:
  if (unsubSettings) unsubSettings();
  unsubSettings = await subscribeToPortalSettings((freshSettings) => {
    settings = freshSettings;
    populateSettingsForms();
    renderSlotResponsesSelectorBar();
  });
  });

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
  if (toggleBtn && pwInput) {
    const handleToggle = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const isCurrentlyPassword = pwInput.type === 'password';
      pwInput.setAttribute('type', isCurrentlyPassword ? 'text' : 'password');
      toggleBtn.textContent = isCurrentlyPassword ? 'Hide' : 'Show';
      toggleBtn.style.background = isCurrentlyPassword ? '#293262' : '#e2e8f0';
      toggleBtn.style.color = isCurrentlyPassword ? '#ffffff' : '#0f172a';
      pwInput.focus();
    };

    toggleBtn.addEventListener('click', handleToggle);
    toggleBtn.addEventListener('pointerdown', (e) => e.preventDefault());
  }

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

  // Add new Slot button
  const addSlotBtn = document.getElementById('btn-add-new-slot');
  if (addSlotBtn) {
    addSlotBtn.addEventListener('click', async () => {
      const currentTotal = Math.max(1, Number(settings.totalSlots || 2));
      const newTotal = currentTotal + 1;
      const statusMap = settings.slotStatusMap || {};
      statusMap[String(newTotal)] = true;
      settings = await savePortalSettings({
        totalSlots: newTotal,
        slotStatusMap: statusMap
      });
      populateSettingsForms();
      await refreshQuestionsSlotView();
      showToast(`Added Slot ${newTotal} to the assessment! You can now upload questions to it.`);
    });
  }

  // Remove Slot button
  const removeSlotBtn = document.getElementById('btn-remove-last-slot');
  if (removeSlotBtn) {
    removeSlotBtn.addEventListener('click', async () => {
      const currentTotal = Math.max(1, Number(settings.totalSlots || 2));
      if (currentTotal <= 1) {
        return showToast('Cannot remove Slot 1. Assessments need at least one active slot.', true);
      }
      const slotToRemove = currentTotal;
      if (!confirm(`Are you sure you want to remove Slot ${slotToRemove}? Any questions in Slot ${slotToRemove} will no longer be visible to students.`)) {
        return;
      }
      const newTotal = currentTotal - 1;
      const statusMap = { ...(settings.slotStatusMap || {}) };
      delete statusMap[String(slotToRemove)];

      const patch = {
        totalSlots: newTotal,
        slotStatusMap: statusMap
      };
      if (Number(settings.activeSlot || 1) === slotToRemove) {
        patch.activeSlot = newTotal;
      }
      settings = await savePortalSettings(patch);
      currentManagingSlot = Math.min(currentManagingSlot, newTotal);
      populateSettingsForms();
      await refreshQuestionsSlotView();
      showToast(`Removed Slot ${slotToRemove}. Total slots now: ${newTotal}.`);
    });
  }

  // Assessment Drives Create Modal
  const createDriveBtn = document.getElementById('btn-create-drive-modal');
  if (createDriveBtn) {
    createDriveBtn.addEventListener('click', () => {
      document.getElementById('drive-modal').classList.remove('hidden');
    });
  }
  const cancelDriveBtn = document.getElementById('btn-cancel-drive-modal');
  if (cancelDriveBtn) {
    cancelDriveBtn.addEventListener('click', () => {
      document.getElementById('drive-modal').classList.add('hidden');
    });
  }
  const driveForm = document.getElementById('drive-create-form');
  if (driveForm) {
    driveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = document.getElementById('drive-title').value.trim();
      const rawId = document.getElementById('drive-id').value.trim();
      const driveId = rawId || `UTS-${Date.now().toString(36).toUpperCase()}`;
      const slotsCount = Math.max(1, Number(document.getElementById('drive-slots').value || 2));
      const duration = Math.max(5, Number(document.getElementById('drive-duration').value || 45));

      const existingDrives = settings.assessmentDrives || [];
      const newDrive = {
        id: driveId,
        title,
        slotsCount,
        durationMinutes: duration,
        createdAt: new Date().toISOString(),
        active: true
      };
      existingDrives.push(newDrive);

      const statusMap = {};
      for (let i = 1; i <= slotsCount; i++) statusMap[String(i)] = true;

      settings = await savePortalSettings({
        assessmentId: driveId,
        quizTitle: title,
        totalSlots: slotsCount,
        activeSlot: 1,
        slotStatusMap: statusMap,
        durationMinutes: duration,
        assessmentDrives: existingDrives
      });

      document.getElementById('drive-modal').classList.add('hidden');
      populateSettingsForms();
      await refreshQuestionsSlotView();
      showToast(`Created & Activated assessment drive: "${title}" (${driveId})!`);
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

  // CSV Export — All
  document.getElementById('btn-export-full-csv').addEventListener('click', () => {
    if (!allSubmissions.length) return showToast('No submissions to export yet.', true);
    const csv = buildDetailedResultsCsv(allSubmissions);
    downloadTextFile(csv, `UTS_Placement_Results_All_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
  });

  // CSV Export — Slot 1 Only
  document.getElementById('btn-export-slot1-csv').addEventListener('click', () => {
    const slot1Subs = allSubmissions.filter((s) => Number(s.slot || 1) === 1);
    if (!slot1Subs.length) return showToast('No Slot 1 submissions to export yet.', true);
    const csv = buildDetailedResultsCsv(slot1Subs);
    downloadTextFile(csv, `UTS_Placement_Results_Slot1_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
  });

  // CSV Export — Slot 2 Only
  document.getElementById('btn-export-slot2-csv').addEventListener('click', () => {
    const slot2Subs = allSubmissions.filter((s) => Number(s.slot || 1) === 2);
    if (!slot2Subs.length) return showToast('No Slot 2 submissions to export yet.', true);
    const csv = buildDetailedResultsCsv(slot2Subs);
    downloadTextFile(csv, `UTS_Placement_Results_Slot2_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
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
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        throw new Error(`Invalid JSON syntax in file: ${parseErr.message}`);
      }

      let rawList = [];
      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else if (parsed && Array.isArray(parsed.questions)) {
        rawList = parsed.questions;
      } else if (parsed && Array.isArray(parsed.items)) {
        rawList = parsed.items;
      } else if (parsed && Array.isArray(parsed.data)) {
        rawList = parsed.data;
      } else if (parsed && typeof parsed === 'object') {
        const firstArrayProp = Object.values(parsed).find((val) => Array.isArray(val));
        if (firstArrayProp) rawList = firstArrayProp;
      }

      if (!rawList || !rawList.length) {
        throw new Error('No questions found in JSON file. Expected an array of question objects or an object with a "questions" array.');
      }

      const normalized = rawList.map((q, idx) => {
        // 1. Flexible Question Text: question | text | q | title | prompt
        const questionText = String(
          q.question || q.text || q.q || q.title || q.prompt || ''
        ).trim();

        if (!questionText) {
          throw new Error(`Question #${idx + 1} is missing a question text string.`);
        }

        // 2. Flexible Options Array: options | choices | answers
        let rawOpts = q.options || q.choices || q.answers;
        let opts = [];

        if (Array.isArray(rawOpts)) {
          opts = rawOpts.map((opt) => String(opt ?? '').trim());
        } else if (typeof rawOpts === 'object' && rawOpts !== null) {
          // If options is an object like { A: "...", B: "..." } or { "0": "...", "1": "..." }
          opts = Object.values(rawOpts).map((opt) => String(opt ?? '').trim());
        } else if (q.type === 'tf' || q.type === 'true_false' || q.type === 'boolean') {
          opts = ['True', 'False'];
        }

        if (opts.length < 2) {
          throw new Error(`Question #${idx + 1} ("${questionText.slice(0, 35)}...") must have at least 2 options.`);
        }

        // 3. Flexible Correct Answer Mapping:
        // Handles: 0-based index (0-3), 1-based index (1-4), letter ("A"-"D", "a"-"d"), or exact option text
        let correctIdx = 0;
        const rawAns = q.correctAnswer ?? q.correctIndex ?? q.correctOption ?? q.answer ?? q.correct;

        if (typeof rawAns === 'number') {
          if (rawAns >= 0 && rawAns < opts.length) {
            correctIdx = rawAns;
          } else if (rawAns >= 1 && rawAns <= opts.length) {
            correctIdx = rawAns - 1;
          } else {
            correctIdx = 0;
          }
        } else if (typeof rawAns === 'string') {
          const trimmedAns = rawAns.trim();
          const upperAns = trimmedAns.toUpperCase();

          // Check if it's a numeric string like "0", "1", "2"
          const parsedNum = parseInt(trimmedAns, 10);
          if (!isNaN(parsedNum) && String(parsedNum) === trimmedAns) {
            if (parsedNum >= 0 && parsedNum < opts.length) {
              correctIdx = parsedNum;
            } else if (parsedNum >= 1 && parsedNum <= opts.length) {
              correctIdx = parsedNum - 1;
            }
          } else if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upperAns)) {
            // Check letter format A-F
            const letterIdx = upperAns.charCodeAt(0) - 65;
            if (letterIdx >= 0 && letterIdx < opts.length) {
              correctIdx = letterIdx;
            }
          } else {
            // Check exact text match or case-insensitive match against options
            const exactIdx = opts.findIndex((o) => o.toLowerCase() === trimmedAns.toLowerCase());
            if (exactIdx >= 0) {
              correctIdx = exactIdx;
            } else {
              correctIdx = 0;
            }
          }
        }

        // 4. Metadata: category / topic, difficulty / level, type, sequential question ID
        const category = String(q.category || q.topic || 'General').trim();
        const difficulty = String(q.difficulty || q.level || 'BASICS').trim().toUpperCase();
        const qType = (q.type === 'tf' || opts.length === 2) ? 'tf' : 'mcq';
        const qNum = `Q${idx + 1}`;

        return {
          id: q.id || qNum || `${currentManagingSlot}_${idx + 1}`,
          questionNumber: qNum,
          slot: currentManagingSlot,
          category,
          difficulty,
          type: qType,
          question: questionText,
          options: opts,
          correctIndex: correctIdx,
          explanation: String(q.explanation || '').trim()
        };
      });

      // Update state and write to Cloud Firestore
      questions = normalized;
      await saveQuestions(questions, currentManagingSlot);

      // Immediately refresh Question Bank UI
      await refreshQuestionsSlotView();
      showToast(`Successfully imported ${normalized.length} questions into Slot ${currentManagingSlot}!`);
    } catch (err) {
      console.error('Question Bank JSON Import Error:', err);
      showToast(`Upload failed: ${err.message}`, true);
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
    openBtn.className = 'btn btn-primary btn-sm';
  } else {
    openBtn.textContent = '⏸ Assessment Status: PAUSED';
    openBtn.className = 'btn btn-danger btn-sm';
  }

  // Update Dynamic Slot Controls
  const totalSlots = Math.max(2, Number(settings.totalSlots || 2));
  const activeSlot = Number(settings.activeSlot || 1);
  const statusMap = settings.slotStatusMap || {
    "1": settings.slot1Open !== false,
    "2": settings.slot2Open !== false
  };

  const quickSlotsContainer = document.getElementById('quick-slot-buttons-container');
  if (quickSlotsContainer) {
    quickSlotsContainer.innerHTML = '';
    for (let s = 1; s <= totalSlots; s++) {
      const isOpen = statusMap[String(s)] !== false;
      const isActive = activeSlot === s;

      const group = document.createElement('div');
      group.style.display = 'inline-flex';
      group.style.alignItems = 'center';
      group.style.borderRadius = '8px';
      group.style.overflow = 'hidden';
      group.style.border = isActive ? '2px solid #293262' : '1px solid #cbd5e1';
      group.style.boxShadow = isActive ? '0 0 0 1.5px #293262' : 'none';

      // Select Active Slot Button
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.style.padding = '4px 9px';
      selectBtn.style.fontSize = '12px';
      selectBtn.style.fontWeight = '700';
      selectBtn.style.border = 'none';
      selectBtn.style.cursor = 'pointer';
      selectBtn.style.background = isActive ? '#293262' : '#f1f5f9';
      selectBtn.style.color = isActive ? '#ffffff' : '#334155';
      selectBtn.textContent = `Slot ${s}`;
      selectBtn.title = `Click to make Slot ${s} the active assessment for students`;
      selectBtn.onclick = async () => {
        settings = await savePortalSettings({
          activeSlot: s,
          totalSlots
        });
        populateSettingsForms();
        await refreshQuestionsSlotView();
        showToast(`Slot ${s} is now selected as the active slot for candidates.`);
      };

      // Toggle ON/OFF Button
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.style.padding = '4px 9px';
      toggleBtn.style.fontSize = '11px';
      toggleBtn.style.fontWeight = '800';
      toggleBtn.style.border = 'none';
      toggleBtn.style.borderLeft = '1px solid rgba(0,0,0,0.15)';
      toggleBtn.style.cursor = 'pointer';
      toggleBtn.style.background = isOpen ? '#10b981' : '#ef4444';
      toggleBtn.style.color = '#ffffff';
      toggleBtn.textContent = isOpen ? 'OPEN' : 'CLOSED';
      toggleBtn.title = `Toggle Slot ${s} ${isOpen ? 'CLOSED' : 'OPEN'}`;
      toggleBtn.onclick = async () => {
        const newStatus = !isOpen;
        statusMap[String(s)] = newStatus;
        const patch = {
          slotStatusMap: statusMap
        };
        if (s === 1) patch.slot1Open = newStatus;
        if (s === 2) patch.slot2Open = newStatus;
        settings = await savePortalSettings(patch);
        populateSettingsForms();
        renderSlotResponsesSelectorBar();
        showToast(`Slot ${s} is now ${newStatus ? 'OPEN' : 'CLOSED'}.`);
      };

      group.appendChild(selectBtn);
      group.appendChild(toggleBtn);
      quickSlotsContainer.appendChild(group);
    }
  }

  // Dynamic CSV Slot Export Buttons
  const dynExportContainer = document.getElementById('dynamic-slot-export-buttons');
  if (dynExportContainer) {
    dynExportContainer.innerHTML = '';
    for (let s = 1; s <= totalSlots; s++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-sm';
      btn.textContent = `⬇ Slot ${s} CSV`;
      btn.onclick = () => {
        const slotSubs = allSubmissions.filter((sub) => Number(sub.slot || 1) === s);
        if (!slotSubs.length) return showToast(`No Slot ${s} submissions to export yet.`, true);
        const csv = buildDetailedResultsCsv(slotSubs);
        downloadTextFile(csv, `UTS_Placement_Results_Slot${s}_${todayStamp()}.csv`, 'text/csv;charset=utf-8');
      };
      dynExportContainer.appendChild(btn);
    }
  }

  const slotBadge = document.getElementById('active-slot-badge');
  if (slotBadge) {
    const curOpen = statusMap[String(activeSlot)] !== false;
    slotBadge.textContent = `Slot ${activeSlot} Active for Students (${curOpen ? 'OPEN' : 'PAUSED'})`;
  }

  // Clock Unlocks Form
  const clockContainer = document.getElementById('clock-unlocks-container');
  if (clockContainer) {
    clockContainer.innerHTML = '';
    const unlockMap = settings.slotUnlockMap || {
      "1": settings.slot1UnlockAt || '',
      "2": settings.slot2UnlockAt || ''
    };
    for (let s = 1; s <= totalSlots; s++) {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      const curVal = unlockMap[String(s)] ? new Date(unlockMap[String(s)]).toISOString().slice(0, 16) : '';
      wrap.innerHTML = `
        <label style="font-size:12px; font-weight:700; color:var(--navy-primary);" for="cfg-slot${s}-unlock">Slot ${s}:</label>
        <input type="datetime-local" id="cfg-slot${s}-unlock" value="${curVal}" style="padding:5px 8px; font-size:12px; border-radius:8px; border:1px solid var(--navy-primary);" />
      `;
      clockContainer.appendChild(wrap);
    }
    const saveSchedBtn = document.createElement('button');
    saveSchedBtn.type = 'button';
    saveSchedBtn.className = 'btn btn-primary btn-sm';
    saveSchedBtn.style.padding = '5px 12px';
    saveSchedBtn.style.fontSize = '12px';
    saveSchedBtn.textContent = 'Save Schedule';
    saveSchedBtn.onclick = async () => {
      const updatedUnlockMap = {};
      for (let s = 1; s <= totalSlots; s++) {
        const inp = document.getElementById(`cfg-slot${s}-unlock`);
        if (inp && inp.value) {
          updatedUnlockMap[String(s)] = new Date(inp.value).toISOString();
        } else {
          updatedUnlockMap[String(s)] = '';
        }
      }
      settings = await savePortalSettings({
        slotUnlockMap: updatedUnlockMap,
        slot1UnlockAt: updatedUnlockMap["1"] || '',
        slot2UnlockAt: updatedUnlockMap["2"] || ''
      });
      populateSettingsForms();
      showToast('Saved slot scheduled clock unlock settings.');
    };
    clockContainer.appendChild(saveSchedBtn);
  }

  // Update Dynamic Share Links Box
  renderAssessmentShareLinks();

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

  const retakeBadge = document.getElementById('tab-retake-badge');
  const retakeReqs = allSubmissions.filter((s) => s.retakeRequested);
  if (retakeBadge) retakeBadge.textContent = String(retakeReqs.length);

  const subCountBadge = document.getElementById('tab-sub-count');
  if (subCountBadge) subCountBadge.textContent = String(total);

  // Render Retake Requests Table (Tab 2)
  renderRetakeRequestsTable(retakeReqs);

  // Render Slot Responses Bar (Tab 1)
  renderSlotResponsesSelectorBar();

  // Render Assessment Drives Table (Tab 3)
  renderAssessmentDrivesTable();
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

function renderSlotResponsesSelectorBar() {
  const container = document.getElementById('slot-responses-selector-bar');
  if (!container) return;
  container.innerHTML = '';

  const totalSlots = Math.max(1, Number(settings?.totalSlots || 2));
  const activeSlot = Number(settings?.activeSlot || 1);

  // 1. "Current Open Slot" Option (Default Google Form style)
  const activeBtn = document.createElement('button');
  activeBtn.type = 'button';
  const isActiveSelected = viewingResponseSlot === 'active';
  activeBtn.className = isActiveSelected ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  activeBtn.style.padding = '4px 10px';
  activeBtn.style.fontSize = '12px';
  activeBtn.style.fontWeight = '700';
  
  let activeSlotOpen = true;
  if (settings?.slotStatusMap && settings.slotStatusMap[String(activeSlot)] !== undefined) {
    activeSlotOpen = Boolean(settings.slotStatusMap[String(activeSlot)]);
  } else if (activeSlot === 2) {
    activeSlotOpen = settings?.slot2Open !== false;
  } else if (activeSlot === 1) {
    activeSlotOpen = settings?.slot1Open !== false;
  }

  activeBtn.innerHTML = `★ Slot ${activeSlot} (${activeSlotOpen ? '<span style="color:#10b981;">OPEN</span>' : '<span style="color:#ef4444;">CLOSED</span>'})`;
  activeBtn.title = `Show responses for the currently selected assessment slot (Slot ${activeSlot} - currently ${activeSlotOpen ? 'OPEN' : 'CLOSED'})`;
  activeBtn.onclick = () => {
    viewingResponseSlot = 'active';
    renderSlotResponsesSelectorBar();
    renderSubmissionsTable();
  };
  container.appendChild(activeBtn);

  // 2. Individual Slot Buttons (Slot 1, Slot 2, ...)
  for (let s = 1; s <= totalSlots; s++) {
    const isThisSelected = viewingResponseSlot === s;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isThisSelected ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    btn.style.padding = '4px 9px';
    btn.style.fontSize = '12px';
    const slotCount = allSubmissions.filter((sub) => Number(sub.slot || 1) === s).length;
    btn.textContent = `Slot ${s} (${slotCount})`;
    btn.onclick = () => {
      viewingResponseSlot = s;
      renderSlotResponsesSelectorBar();
      renderSubmissionsTable();
    };
    container.appendChild(btn);
  }

  // 3. "All Slots Combined" Option
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  const isAllSelected = viewingResponseSlot === 'all';
  allBtn.className = isAllSelected ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
  allBtn.style.padding = '4px 10px';
  allBtn.style.fontSize = '12px';
  allBtn.textContent = `All Slots (${allSubmissions.length})`;
  allBtn.onclick = () => {
    viewingResponseSlot = 'all';
    renderSlotResponsesSelectorBar();
    renderSubmissionsTable();
  };
  container.appendChild(allBtn);

  // Update label
  const labelEl = document.getElementById('current-viewing-slot-label');
  if (labelEl) {
    if (viewingResponseSlot === 'active') {
      labelEl.textContent = `Active Assessment Slot (Slot ${activeSlot})`;
    } else if (viewingResponseSlot === 'all') {
      labelEl.textContent = `All Slots Combined`;
    } else {
      labelEl.textContent = `Slot ${viewingResponseSlot}`;
    }
  }
}

function renderSubmissionsTable() {
  const tbody = document.getElementById('submissions-tbody');
  const q = document.getElementById('sub-search-input').value.trim().toLowerCase();
  const filter = document.getElementById('sub-filter-select').value;
  const sortMode = document.getElementById('sub-sort-select') ? document.getElementById('sub-sort-select').value : 'time_desc';

  // Determine which slot is being viewed (Google Forms style)
  const activeSlot = Number(settings?.activeSlot || 1);
  const targetSlot = viewingResponseSlot === 'active' ? activeSlot : viewingResponseSlot;

  let filtered = allSubmissions.filter((s) => {
    // 1. Filter by viewed slot
    if (targetSlot !== 'all') {
      if (Number(s.slot || 1) !== Number(targetSlot)) return false;
    }

    // 2. Filter by dropdown
    if (filter === 'retake_requested' && !s.retakeRequested) return false;
    if (filter === 'premature' && !s.prematureExit) return false;
    if (filter === 'slot1' && Number(s.slot || 1) !== 1) return false;
    if (filter === 'slot2' && Number(s.slot || 1) !== 2) return false;
    if (filter === 'autosubmit' && !s.isAutoSubmitted) return false;
    if (filter === 'warned' && !(Number(s.warningsUsed || 0) > 0)) return false;

    if (!q) return true;
    const hay = `${s.fullName} ${s.registerNumber} ${s.email} ${s.year || ''}`.toLowerCase();
    return hay.includes(q);
  });

  const countPill = document.getElementById('slot-response-count-pill');
  if (countPill) countPill.textContent = String(filtered.length);

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

    let secTag = s.isAutoSubmitted
      ? `<span class="status-tag bad" title="${escapeHtml(s.submitReason)}">Auto-Submit (${s.warningsUsed || 0}W)</span>`
      : Number(s.warningsUsed || 0) > 0
      ? `<span class="status-tag warn">${s.warningsUsed}/${s.maxWarnings ?? 2} Warnings</span>`
      : `<span class="status-tag ok">Clean (0W)</span>`;

    if (s.retakeRequested) {
      secTag += `<br><span style="display:inline-block; margin-top:3px; padding:2px 6px; border-radius:4px; background:#fef2f2; border:1px solid #dc2626; color:#991b1b; font-size:10.5px; font-weight:800;">🚨 Retake Requested</span>`;
    }
    if (s.prematureExit) {
      secTag += `<br><span style="display:inline-block; margin-top:3px; padding:2px 6px; border-radius:4px; background:#fff7ed; border:1px solid #ea580c; color:#c2410c; font-size:10.5px; font-weight:700;">Premature Exit</span>`;
    }

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
/* Retake Requests Management Table (Tab 2)                                   */
/* -------------------------------------------------------------------------- */

function renderRetakeRequestsTable(retakeList) {
  const tbody = document.getElementById('retake-requests-tbody');
  const countEl = document.getElementById('retake-requests-count');
  if (countEl) countEl.textContent = String(retakeList.length);
  if (!tbody) return;

  if (!retakeList.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; color:var(--text-muted); padding:26px;">
          No pending retake requests.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  retakeList.forEach((s) => {
    const tr = document.createElement('tr');
    tr.style.background = '#fffbeb';
    const reqDate = s.retakeRequestedAt ? new Date(s.retakeRequestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

    tr.innerHTML = `
      <td>
        <div style="font-weight:700; color:#92400e;">${escapeHtml(s.fullName)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(s.email)}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(s.phone || '')}</div>
      </td>
      <td>
        <div style="font-family:monospace; font-weight:800; color:#3b0764;">${escapeHtml(s.registerNumber)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">${escapeHtml(s.year || 'Candidate')}</div>
      </td>
      <td>
        <strong style="color:#5b21b6;">Slot ${s.slot || 1}</strong>
        <div style="font-size:12px; font-weight:700;">Score: ${s.score}/${s.totalQuestions} (${s.percentage}%)</div>
      </td>
      <td>
        <div style="font-size:12.5px; font-weight:700; color:#b45309;">
          ${escapeHtml(s.retakeRequestReason || s.submitReason || 'Interrupted session')}
        </div>
        <div style="font-size:11px; color:#78350f;">Auto-Submit: ${s.submitReason || '-'} (${s.warningsUsed || 0} Warnings)</div>
      </td>
      <td style="font-size:12.5px; font-weight:600;">${reqDate}</td>
      <td>
        <button type="button" class="btn btn-primary btn-sm act-approve-retake" style="background:#059669; border-color:#047857; font-weight:700;">
          ✓ Approve Retake
        </button>
      </td>
    `;

    tr.querySelector('.act-approve-retake').addEventListener('click', async () => {
      if (!confirm(`Approve retake for ${s.fullName} (${s.registerNumber})? This clears their current submission attempt and unlocks access immediately.`)) return;
      await allowStudentRetake(s.id);
      showToast(`Approved retake for ${s.fullName}! Student can now re-enter the assessment.`);
    });

    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------------------- */
/* Assessment Drives Table & Dynamic Links (Tab 3)                            */
/* -------------------------------------------------------------------------- */

function renderAssessmentShareLinks() {
  const origin = window.location.origin;
  const currentSlot = Number(settings?.activeSlot || 1);
  const totalSlots = Math.max(2, Number(settings?.totalSlots || 2));

  const mainInput = document.getElementById('share-link-main');
  if (mainInput) mainInput.value = `${origin}/`;

  const slotContainer = document.getElementById('dynamic-slot-links-container');
  if (slotContainer) {
    slotContainer.innerHTML = '';
    for (let s = 1; s <= totalSlots; s++) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.alignItems = 'center';
      row.style.flexWrap = 'wrap';

      const directUrl = `${origin}/?slot=${s}`;
      row.innerHTML = `
        <span style="font-size:12.5px; font-weight:700; width:130px; color:#334155;">Direct Slot ${s} Link:</span>
        <input type="text" id="share-link-slot-${s}" value="${directUrl}" readonly style="flex:1; min-width:240px; padding:7px 10px; font-size:12.5px; background:#fff; border:1px solid #cbd5e1; border-radius:6px;" />
        <button type="button" class="btn btn-secondary btn-sm copy-btn" data-target="share-link-slot-${s}">Copy Link</button>
        <a href="${directUrl}" target="_blank" class="btn btn-secondary btn-sm">Preview ↗</a>
      `;
      slotContainer.appendChild(row);
    }
  }

  // Bind copy buttons
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.onclick = () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        input.select();
        navigator.clipboard.writeText(input.value).then(() => {
          showToast('Assessment link copied to clipboard!');
        }).catch(() => {
          document.execCommand('copy');
          showToast('Assessment link copied to clipboard!');
        });
      }
    };
  });
}

function renderAssessmentDrivesTable() {
  const tbody = document.getElementById('assessment-drives-tbody');
  if (!tbody) return;
  const drives = settings?.assessmentDrives || [];
  const currentDriveId = settings?.assessmentId || 'default';
  const origin = window.location.origin;

  if (!drives.length) {
    // Show active default drive
    tbody.innerHTML = `
      <tr>
        <td>
          <div style="font-weight:700; color:#0f172a;">${escapeHtml(settings?.quizTitle || 'Placement Drive Assessment')}</div>
          <div style="font-size:11.5px; color:var(--text-muted);">ID: ${escapeHtml(currentDriveId)}</div>
        </td>
        <td><b>${settings?.totalSlots || 2} Slots</b></td>
        <td><span class="status-tag ok">ACTIVE NOW</span></td>
        <td>Default Drive</td>
        <td>
          <input type="text" readonly value="${origin}/" style="padding:4px 8px; font-size:11.5px; width:220px; background:#fff; border:1px solid #cbd5e1; border-radius:4px;" />
        </td>
        <td>
          <span style="font-size:12px; color:#047857; font-weight:700;">● Active</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  drives.forEach((d) => {
    const isActive = d.id === currentDriveId;
    const tr = document.createElement('tr');
    if (isActive) tr.style.background = '#f0fdf4';

    tr.innerHTML = `
      <td>
        <div style="font-weight:700; color:#0f172a;">${escapeHtml(d.title)}</div>
        <div style="font-size:11.5px; color:var(--text-muted);">ID: ${escapeHtml(d.id)}</div>
      </td>
      <td><b>${d.slotsCount || 2} Slots</b> (${d.durationMinutes || 45}m each)</td>
      <td>${isActive ? '<span class="status-tag ok">ACTIVE NOW</span>' : '<span class="status-tag warn">INACTIVE</span>'}</td>
      <td style="font-size:12px;">${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : '-'}</td>
      <td>
        <input type="text" readonly value="${origin}/?drive=${d.id}" style="padding:4px 8px; font-size:11.5px; width:220px; background:#fff; border:1px solid #cbd5e1; border-radius:4px;" />
      </td>
      <td>
        ${
          !isActive
            ? `<button type="button" class="btn btn-primary btn-sm act-activate-drive" style="padding:4px 8px; font-size:11.5px;">Switch to this Drive</button>`
            : `<span style="font-size:12px; color:#047857; font-weight:700;">● Current Active</span>`
        }
      </td>
    `;

    const actBtn = tr.querySelector('.act-activate-drive');
    if (actBtn) {
      actBtn.onclick = async () => {
        const statusMap = {};
        for (let i = 1; i <= (d.slotsCount || 2); i++) statusMap[String(i)] = true;
        settings = await savePortalSettings({
          assessmentId: d.id,
          quizTitle: d.title,
          totalSlots: d.slotsCount || 2,
          activeSlot: 1,
          slotStatusMap: statusMap,
          durationMinutes: d.durationMinutes || 45
        });
        populateSettingsForms();
        await refreshQuestionsSlotView();
        showToast(`Switched active assessment drive to: "${d.title}"!`);
      };
    }

    tbody.appendChild(tr);
  });
}

/* -------------------------------------------------------------------------- */
/* Question Bank Editor (Dynamic Slots)                                       */
/* -------------------------------------------------------------------------- */

async function refreshQuestionsSlotView() {
  questions = await loadQuestions(currentManagingSlot);
  const totalSlots = Math.max(2, Number(settings?.totalSlots || 2));

  // Render Question Bank Slot switcher tabs dynamically
  const qbankSlotContainer = document.getElementById('qbank-slot-tabs-container');
  if (qbankSlotContainer) {
    qbankSlotContainer.innerHTML = '';
    for (let s = 1; s <= totalSlots; s++) {
      const tabBtn = document.createElement('button');
      tabBtn.type = 'button';
      tabBtn.className = currentManagingSlot === s ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
      tabBtn.style.fontSize = '13px';
      tabBtn.style.fontWeight = '700';
      tabBtn.innerHTML = `Slot ${s} (<span id="slot${s}-count">...</span>)`;
      tabBtn.onclick = async () => {
        currentManagingSlot = s;
        await refreshQuestionsSlotView();
      };
      qbankSlotContainer.appendChild(tabBtn);

      // Async fetch count
      loadQuestions(s).then((qList) => {
        const countSpan = document.getElementById(`slot${s}-count`);
        if (countSpan) countSpan.textContent = String(qList.length);
      });
    }
  }

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
    'Slot',
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
    `Slot ${s.slot || 1}`,
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
