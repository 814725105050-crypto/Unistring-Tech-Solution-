/**
 * Unified Data & Authentication Service — Connected to Firebase (`unistring-tech-solution`)
 * Unistring Tech Solution Placement Drive Assessment
 */

import {
  ADMIN_ACCESS,
  DEFAULT_PORTAL_SETTINGS,
  OFFICIAL_FIREBASE_VERIFY_URL,
  getEffectiveFirebaseConfig,
  isFirebaseConfigured
} from './firebase-config.js';
import { DEFAULT_QUESTIONS } from './questions-data.js';

const STORAGE_KEYS = {
  SETTINGS: 'uts_portal_settings_v1',
  QUESTIONS: 'uts_questions_bank_v1',
  QUESTIONS_SLOT1: 'uts_questions_slot1_v1',
  QUESTIONS_SLOT2: 'uts_questions_slot2_v1',
  SUBMISSIONS: 'uts_submissions_v1',
  CERTIFICATES: 'uts_certificates_v1',
  ACTIVE_SESSIONS: 'uts_live_sessions_v1',
  ADMIN_SESSION: 'uts_admin_auth_session_v1'
};

let firebaseCtx = null;
let initPromise = null;
let firestoreCloudHealthy = true;
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('uts_live_sync') : null;

function notifyLocalChange(topic) {
  if (broadcast) {
    try {
      broadcast.postMessage({ topic, at: Date.now() });
    } catch (_) {}
  }
}

/* -------------------------------------------------------------------------- */
/* Pure-JS + WebCrypto SHA-256                                                */
/* -------------------------------------------------------------------------- */

export async function sha256Hex(message) {
  const text = String(message || '');
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (_) {}
  }
  return sha256Fallback(text);
}

function sha256Fallback(ascii) {
  const rightRotate = (value, amount) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const bytes = new TextEncoder().encode(ascii);
  const asciiBitLength = bytes.length * 8;

  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(asciiBitLength / maxWord), false);
  view.setUint32(padded.length - 4, asciiBitLength >>> 0, false);

  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array(64);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let j = 0; j < 64; j++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + k[j] + w[j]) | 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash = [
      (hash[0] + a) | 0,
      (hash[1] + b) | 0,
      (hash[2] + c) | 0,
      (hash[3] + d) | 0,
      (hash[4] + e) | 0,
      (hash[5] + f) | 0,
      (hash[6] + g) | 0,
      (hash[7] + h) | 0
    ];
  }
  for (let i = 0; i < 8; i++) {
    result += (hash[i] >>> 0).toString(16).padStart(8, '0');
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Firebase Initialization (App + Analytics + Auth + Firestore)               */
/* -------------------------------------------------------------------------- */

export async function initBackend() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const cfg = getEffectiveFirebaseConfig();
    if (!isFirebaseConfigured(cfg)) {
      firebaseCtx = { mode: 'local' };
      return firebaseCtx;
    }
    try {
      const [appMod, authMod, fsMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js')
      ]);
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(cfg);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);

      // Initialize Firebase Analytics non-blockingly when measurementId is present
      if (cfg.measurementId) {
        import('https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js')
          .then((anMod) => anMod.isSupported().then((ok) => ok && anMod.getAnalytics(app)))
          .catch(() => {});
      }

      firebaseCtx = { mode: 'firebase', app, auth, db, authMod, fsMod, cfg };
      return firebaseCtx;
    } catch (err) {
      console.warn('Firebase SDK load failed, falling back to local store:', err);
      firebaseCtx = { mode: 'local', error: err?.message };
      return firebaseCtx;
    }
  })();
  return initPromise;
}

export async function getBackendStatus() {
  const ctx = await initBackend();
  return {
    mode: ctx.mode,
    projectId: ctx.cfg?.projectId || null,
    firestoreCloudHealthy,
    error: ctx.error || null
  };
}

/* -------------------------------------------------------------------------- */
/* Portal Settings                                                            */
/* -------------------------------------------------------------------------- */

function sanitizeVerifySetting(settingsObj) {
  const out = { ...settingsObj };
  if (
    !out.camsVerificationUrl ||
    /script\.google\.com|googleusercontent\.com/i.test(String(out.camsVerificationUrl))
  ) {
    out.camsVerificationUrl = OFFICIAL_FIREBASE_VERIFY_URL;
  }
  return out;
}

export function getLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) return sanitizeVerifySetting({ ...DEFAULT_PORTAL_SETTINGS, ...JSON.parse(raw) });
  } catch (_) {}
  return sanitizeVerifySetting({ ...DEFAULT_PORTAL_SETTINGS });
}

export async function loadPortalSettings() {
  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, getDoc } = ctx.fsMod;
      const ref = doc(ctx.db, 'portal_config', 'main');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const merged = sanitizeVerifySetting({ ...DEFAULT_PORTAL_SETTINGS, ...snap.data() });
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
        return merged;
      }
      return getLocalSettings();
    } catch (err) {
      firestoreCloudHealthy = false;
      console.warn('Firestore not enabled yet in Firebase Console; using resilient fallback:', err?.message);
      return getLocalSettings();
    }
  }
  return getLocalSettings();
}

export async function savePortalSettings(partialSettings) {
  const current = await loadPortalSettings();
  const updated = {
    ...current,
    ...partialSettings,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  notifyLocalChange('settings');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'portal_config', 'main'), updated, { merge: true });
      firestoreCloudHealthy = true;
    } catch (err) {
      firestoreCloudHealthy = false;
      console.warn('Saved locally (enable Cloud Firestore in Firebase Console for cloud sync):', err?.message);
    }
  }
  return updated;
}

export async function subscribeToPortalSettings(onSettings) {
  const ctx = await initBackend();
  let unsub = () => {};

  if (ctx.mode === 'firebase') {
    try {
      const { doc, onSnapshot } = ctx.fsMod;
      unsub = onSnapshot(doc(ctx.db, 'portal_config', 'main'), (snap) => {
        if (snap.exists()) {
          const merged = sanitizeVerifySetting({ ...DEFAULT_PORTAL_SETTINGS, ...snap.data() });
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(merged));
          onSettings(merged);
        }
      });
    } catch (_) {}
  }

  const onStorage = (e) => {
    if (e.key === STORAGE_KEYS.SETTINGS) {
      onSettings(getLocalSettings());
    }
  };
  window.addEventListener('storage', onStorage);

  let onMsg = null;
  if (broadcast) {
    onMsg = (e) => {
      if (e.data?.topic === 'settings') {
        onSettings(getLocalSettings());
      }
    };
    broadcast.addEventListener('message', onMsg);
  }

  return () => {
    unsub();
    window.removeEventListener('storage', onStorage);
    if (broadcast && onMsg) broadcast.removeEventListener('message', onMsg);
  };
}

/* -------------------------------------------------------------------------- */
/* Question Bank                                                              */
/* -------------------------------------------------------------------------- */

export function getLocalQuestions(slot = 1) {
  try {
    const key = `uts_questions_slot${slot}_v1`;
    const raw = localStorage.getItem(key) || (Number(slot) === 1 ? localStorage.getItem(STORAGE_KEYS.QUESTIONS) : null);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [];
}

export async function loadQuestions(slot = null) {
  if (slot === null) {
    const s = await loadPortalSettings();
    slot = Number(s.activeSlot || 1);
  }
  const slotDocId = `questions_slot${slot}`;
  const localKey = `uts_questions_slot${slot}_v1`;

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, getDoc } = ctx.fsMod;
      let snap = await getDoc(doc(ctx.db, 'portal_config', slotDocId));
      if (!snap.exists() && Number(slot) === 1) {
        // Fallback to legacy single questions doc
        snap = await getDoc(doc(ctx.db, 'portal_config', 'questions'));
      }
      if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length > 0) {
        localStorage.setItem(localKey, JSON.stringify(snap.data().items));
        return snap.data().items;
      }
    } catch (err) {
      firestoreCloudHealthy = false;
    }
  }
  return getLocalQuestions(slot);
}

export async function saveQuestions(questionsArray, slot = 1) {
  const slotNum = Number(slot || 1);
  const slotDocId = `questions_slot${slotNum}`;
  const localKey = `uts_questions_slot${slotNum}_v1`;

  localStorage.setItem(localKey, JSON.stringify(questionsArray));
  if (slotNum === 1) {
    localStorage.setItem(STORAGE_KEYS.QUESTIONS, JSON.stringify(questionsArray));
  }
  notifyLocalChange('questions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'portal_config', slotDocId), {
        slot: slotNum,
        items: questionsArray,
        updatedAt: new Date().toISOString()
      });
      if (slotNum === 1) {
        await setDoc(doc(ctx.db, 'portal_config', 'questions'), {
          items: questionsArray,
          updatedAt: new Date().toISOString()
        }).catch(() => {});
      }
      firestoreCloudHealthy = true;
    } catch (err) {
      firestoreCloudHealthy = false;
    }
  }
  return questionsArray;
}

export async function resetQuestionsToDefault(slot = 1) {
  return saveQuestions([], slot);
}

/* -------------------------------------------------------------------------- */
/* Duplicate Attempt Check                                                    */
/* -------------------------------------------------------------------------- */

export function normalizeStudentKey(email, registerNumber, slot = null) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanReg = String(registerNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  const slotSuffix = slot ? `_s${slot}` : '';
  const baseDocId = cleanEmail.replace(/[^a-z0-9@._-]/g, '_');
  return {
    cleanEmail,
    cleanReg,
    docId: `${baseDocId}${slotSuffix}`,
    regLockKey: slot ? `${cleanReg}_s${slot}` : cleanReg
  };
}

export async function checkExistingSubmission(email, registerNumber, slot = null) {
  const { cleanEmail, cleanReg, docId, regLockKey } = normalizeStudentKey(email, registerNumber, slot);
  const ctx = await initBackend();

  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, getDoc } = ctx.fsMod;
      const byEmail = await getDoc(doc(ctx.db, 'submissions', docId));
      if (byEmail.exists() && !byEmail.data().allowRetake) {
        return byEmail.data();
      }
      if (cleanReg) {
        const regSnap = await getDoc(doc(ctx.db, 'reg_locks', regLockKey));
        if (regSnap.exists() && regSnap.data().submissionId) {
          const linkedSub = await getDoc(doc(ctx.db, 'submissions', regSnap.data().submissionId));
          if (linkedSub.exists() && !linkedSub.data().allowRetake) {
            return linkedSub.data();
          }
        }
      }
      return null;
    } catch (_) {
      firestoreCloudHealthy = false;
    }
  }

  const list = getLocalSubmissions();
  return (
    list.find(
      (s) =>
        !s.allowRetake &&
        (slot ? Number(s.slot || 1) === Number(slot) : true) &&
        (String(s.email || '').toLowerCase() === cleanEmail ||
          (cleanReg && String(s.registerNumberNormalized || '') === cleanReg))
    ) || null
  );
}

/* -------------------------------------------------------------------------- */
/* Active Live Exam Heartbeat / Proctoring Telemetry                          */
/* -------------------------------------------------------------------------- */

function getLocalActiveSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_SESSIONS) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export async function upsertActiveSession(sessionData) {
  const { docId } = normalizeStudentKey(sessionData.email, sessionData.registerNumber);
  const payload = {
    ...sessionData,
    sessionId: docId,
    lastUpdatedAt: new Date().toISOString()
  };

  const map = getLocalActiveSessions();
  map[docId] = payload;
  localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSIONS, JSON.stringify(map));
  notifyLocalChange('sessions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'active_sessions', docId), payload, { merge: true });
    } catch (_) {
      firestoreCloudHealthy = false;
    }
  }
}

export async function removeActiveSession(email, registerNumber) {
  const { docId } = normalizeStudentKey(email, registerNumber);
  const map = getLocalActiveSessions();
  delete map[docId];
  localStorage.setItem(STORAGE_KEYS.ACTIVE_SESSIONS, JSON.stringify(map));
  notifyLocalChange('sessions');

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, deleteDoc } = ctx.fsMod;
      await deleteDoc(doc(ctx.db, 'active_sessions', docId));
    } catch (_) {}
  }
}

/* -------------------------------------------------------------------------- */
/* Quiz Submissions                                                           */
/* -------------------------------------------------------------------------- */

function getLocalSubmissions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUBMISSIONS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (_) {}
  return [];
}

function saveLocalSubmissions(list) {
  localStorage.setItem(STORAGE_KEYS.SUBMISSIONS, JSON.stringify(list));
  notifyLocalChange('submissions');
}

export async function recordQuizSubmission(submission) {
  const slot = submission.slot || 1;
  const { cleanEmail, cleanReg, docId, regLockKey } = normalizeStudentKey(
    submission.email,
    submission.registerNumber,
    slot
  );

  const record = {
    ...submission,
    id: docId,
    slot,
    email: cleanEmail,
    registerNumberNormalized: cleanReg,
    allowRetake: false,
    submittedAt: submission.submittedAt || new Date().toISOString()
  };

  const local = getLocalSubmissions();
  const idx = local.findIndex((item) => item.id === docId);
  if (idx >= 0) local[idx] = record;
  else local.unshift(record);
  saveLocalSubmissions(local);

  await removeActiveSession(cleanEmail, cleanReg);

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'submissions', docId), record);
      firestoreCloudHealthy = true;
      if (cleanReg) {
        await setDoc(doc(ctx.db, 'reg_locks', regLockKey), {
          submissionId: docId,
          slot,
          email: cleanEmail,
          createdAt: record.submittedAt
        }).catch(() => {});
      }
    } catch (err) {
      firestoreCloudHealthy = false;
      console.warn('Submission saved locally (Firestore pending enablement):', err?.message);
    }
  }
  return record;
}

export async function updateSubmissionCertificateStatus(submissionId, certUpdate) {
  const local = getLocalSubmissions();
  const idx = local.findIndex((item) => item.id === submissionId);
  if (idx >= 0) {
    local[idx] = { ...local[idx], ...certUpdate };
    saveLocalSubmissions(local);
  }

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'submissions', submissionId), certUpdate, { merge: true });
    } catch (_) {}
  }
}

/* -------------------------------------------------------------------------- */
/* Direct Firebase Certificate Verification Registry (`certificates/{key}`)   */
/* -------------------------------------------------------------------------- */

export function certIdToDocKey(certificateId) {
  return String(certificateId || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9_-]/g, '_');
}

function getCandidateCertDocKeys(certificateId) {
  const primary = certIdToDocKey(certificateId);
  if (!primary) return [];
  const keys = new Set([primary]);
  // Also tolerate legacy trailing-slash prefixes (EEE/EMBX/-2026-0002 <-> EEE/EMBX-2026-0002)
  keys.add(primary.replace(/_-/g, '-'));
  keys.add(primary.replace(/EMBX-(\d{4})-/g, 'EMBX_-$1-'));
  return Array.from(keys).filter(Boolean);
}

function getLocalCertificatesMap() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CERTIFICATES) || '{}') || {};
  } catch (_) {
    return {};
  }
}

function saveLocalCertificatesMap(map) {
  try {
    localStorage.setItem(STORAGE_KEYS.CERTIFICATES, JSON.stringify(map));
    notifyLocalChange('certificates');
  } catch (_) {}
}

/**
 * Registers an issued certificate in BOTH LocalStorage AND Cloud Firestore (`certificates/{key}`)
 * with public-safe fields only (never stores private email/mobile/PDF URL in public registry).
 */
export async function upsertVerifiedCertificate(record) {
  const certId = String(record?.certificateId || '').trim();
  if (!certId) return null;

  const docKey = certIdToDocKey(certId);
  const publicDoc = {
    certificateId: certId,
    status: 'VALID',
    name: String(record.name || record.fullName || '').trim(),
    registerNumber: String(record.registerNumber || '').trim(),
    department: String(record.department || 'EEE').trim(),
    year: String(record.year || '').trim(),
    workshop: String(
      record.workshop || 'Basics of Embedded Systems and Embedded Programming Language'
    ).trim(),
    courseName: String(record.courseName || 'EMBEDX Workshop Quiz').trim(),
    conductedBy: String(
      record.conductedBy || 'EMBEDX | Embedded Systems & Automation Club'
    ).trim(),
    duration: String(record.duration || '1 Day').trim(),
    issueDate:
      String(record.issueDate || '').trim() ||
      new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      }),
    organization: String(
      record.organization || 'SRM TRP Engineering College · Dept. of EEE'
    ).trim(),
    verificationUrl: buildCanonicalFirebaseVerifyLink(certId),
    syncedAt: new Date().toISOString()
  };

  const localMap = getLocalCertificatesMap();
  localMap[docKey] = publicDoc;
  saveLocalCertificatesMap(localMap);

  const ctx = await initBackend();
  if (ctx.mode === 'firebase') {
    try {
      const { doc, setDoc } = ctx.fsMod;
      await setDoc(doc(ctx.db, 'certificates', docKey), publicDoc, { merge: true });
      firestoreCloudHealthy = true;
    } catch (err) {
      console.warn('Certificate cached locally (Firestore pending enablement):', err?.message);
    }
  }
  return publicDoc;
}

/** Verify only against the public Firestore certificate registry. */
export async function verifyCertificateDirect(certificateId) {
  const searchedId = String(certificateId || '').trim();
  if (!searchedId) {
    return { status: 'EMPTY', certificateId: '' };
  }

  const candidateKeys = getCandidateCertDocKeys(searchedId);
  const nowStamp = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  // 1. Check Firebase Cloud Firestore `certificates/{docKey}`
  const ctx = await initBackend();
  let registryReachable = false;
  if (ctx.mode === 'firebase') {
    try {
      const { doc, getDoc } = ctx.fsMod;
      for (const key of candidateKeys) {
        const snap = await getDoc(doc(ctx.db, 'certificates', key));
        if (snap.exists()) {
          firestoreCloudHealthy = true;
          const data = snap.data();
          return {
            ...data,
            status: data.status === 'SENT' ? 'VALID' : data.status || 'VALID',
            verifiedAt: nowStamp,
            source: 'Firebase Cloud Registry'
          };
        }
      }
      registryReachable = true;
    } catch (_) {
      // Fail closed if the registry cannot be queried.
    }
  }

  return {
    status: registryReachable ? 'NOT_FOUND' : 'UNAVAILABLE',
    certificateId: searchedId,
    verifiedAt: nowStamp
  };
}

export async function requestStudentRetake(submissionId, reason = '') {
  const ctx = await initBackend();
  const updateData = {
    retakeRequested: true,
    retakeRequestReason: String(reason || 'Candidate requested retake due to auto-submission/interruption.').trim(),
    retakeRequestedAt: new Date().toISOString()
  };

  const local = getLocalSubmissions();
  const idx = local.findIndex((item) => item.id === submissionId);
  if (idx >= 0) {
    local[idx] = { ...local[idx], ...updateData };
    saveLocalSubmissions(local);
  }

  if (ctx.mode === 'firebase') {
    try {
      const { doc, updateDoc } = ctx.fsMod;
      await updateDoc(doc(ctx.db, 'submissions', submissionId), updateData);
    } catch (err) {
      console.warn('Firestore retake request sync error:', err);
    }
  }
  return updateData;
}

export async function allowStudentRetake(submissionId) {
  const existing = getLocalSubmissions().find((item) => item.id === submissionId);
  const local = getLocalSubmissions().filter((item) => item.id !== submissionId);
  saveLocalSubmissions(local);

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && firestoreCloudHealthy) {
    try {
      const { doc, getDoc, deleteDoc } = ctx.fsMod;
      const snap = await getDoc(doc(ctx.db, 'submissions', submissionId));
      const regKey =
        (snap.exists() && snap.data().registerNumberNormalized) ||
        existing?.registerNumberNormalized;
      if (regKey) {
        await deleteDoc(doc(ctx.db, 'reg_locks', regKey)).catch(() => {});
      }
      await deleteDoc(doc(ctx.db, 'submissions', submissionId));
    } catch (_) {}
  }
}

export async function subscribeToAdminData(onData) {
  const ctx = await initBackend();
  let cloudSubDocs = [];
  let cloudActiveDocs = [];
  let cloudConnected = false;

  const emitCombined = () => {
    const mergedMap = new Map();
    getLocalSubmissions().forEach((s) => mergedMap.set(s.id, s));
    cloudSubDocs.forEach((s) => mergedMap.set(s.id, s));
    const submissions = Array.from(mergedMap.values()).sort((a, b) =>
      String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))
    );

    const sessMap = new Map();
    Object.values(getLocalActiveSessions()).forEach((s) => sessMap.set(s.sessionId || s.id, s));
    cloudActiveDocs.forEach((s) => sessMap.set(s.id, s));
    const activeSessions = Array.from(sessMap.values());

    onData({
      submissions,
      activeSessions,
      mode: cloudConnected ? 'firebase' : 'local_fallback',
      firestoreCloudHealthy
    });
  };

  let unsub1 = () => {};
  let unsub2 = () => {};

  if (ctx.mode === 'firebase') {
    try {
      const { collection, onSnapshot } = ctx.fsMod;
      unsub1 = onSnapshot(
        collection(ctx.db, 'submissions'),
        (snap) => {
          cloudConnected = true;
          firestoreCloudHealthy = true;
          cloudSubDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emitCombined();
        },
        () => {
          firestoreCloudHealthy = false;
          emitCombined();
        }
      );
      unsub2 = onSnapshot(
        collection(ctx.db, 'active_sessions'),
        (snap) => {
          cloudConnected = true;
          firestoreCloudHealthy = true;
          cloudActiveDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          emitCombined();
        },
        () => {
          firestoreCloudHealthy = false;
          emitCombined();
        }
      );
    } catch (_) {
      firestoreCloudHealthy = false;
    }
  }

  emitCombined();
  const onStorage = () => emitCombined();
  window.addEventListener('storage', onStorage);
  let onMsg = null;
  if (broadcast) {
    onMsg = () => emitCombined();
    broadcast.addEventListener('message', onMsg);
  }
  const poll = setInterval(emitCombined, 3000);

  return () => {
    unsub1();
    unsub2();
    window.removeEventListener('storage', onStorage);
    if (broadcast && onMsg) broadcast.removeEventListener('message', onMsg);
    clearInterval(poll);
  };
}

/* -------------------------------------------------------------------------- */
/* Admin Authentication                                                       */
/* -------------------------------------------------------------------------- */

export async function loginAdmin(emailInput, passwordInput) {
  const normalizedEmail = String(emailInput || '').trim().toLowerCase();
  const allowedList = (ADMIN_ACCESS.allowedEmails || [ADMIN_ACCESS.allowedEmail || ''])
    .filter(Boolean)
    .map((e) => e.toLowerCase());

  const passHash = await sha256Hex(String(passwordInput || ''));
  const validHash =
    (ADMIN_ACCESS.allowedPasswordHashes &&
      ADMIN_ACCESS.allowedPasswordHashes.includes(passHash)) ||
    passHash === ADMIN_ACCESS.passwordSha256;

  const ctx = await initBackend();

  if (ctx.mode === 'firebase') {
    const { signInWithEmailAndPassword } = ctx.authMod;
    try {
      const cred = await signInWithEmailAndPassword(ctx.auth, normalizedEmail, passwordInput);
      sessionStorage.setItem(
        STORAGE_KEYS.ADMIN_SESSION,
        JSON.stringify({ email: normalizedEmail, loggedInAt: Date.now(), mode: 'firebase' })
      );
      return { email: normalizedEmail, mode: 'firebase' };
    } catch (err) {
      // If Firebase Auth fails with invalid credentials, check if master emergency credentials match
      if (validHash && (allowedList.length === 0 || allowedList.includes(normalizedEmail))) {
        sessionStorage.setItem(
          STORAGE_KEYS.ADMIN_SESSION,
          JSON.stringify({ email: normalizedEmail, loggedInAt: Date.now(), mode: 'master' })
        );
        return { email: normalizedEmail, mode: 'master' };
      }
      const code = String(err?.code || '');
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        throw new Error('Invalid email or password. Please verify your administrator credentials.');
      }
      throw new Error(err?.message || 'Firebase Authentication failed.');
    }
  }

  // Local / offline fallback
  if (allowedList.length > 0 && !allowedList.includes(normalizedEmail)) {
    throw new Error('Access Denied: Email is not authorized.');
  }

  if (ADMIN_ACCESS.passwordSha256 && !validHash) {
    throw new Error('Invalid administrator password.');
  }

  sessionStorage.setItem(
    STORAGE_KEYS.ADMIN_SESSION,
    JSON.stringify({ email: normalizedEmail, loggedInAt: Date.now(), mode: 'local' })
  );
  return { email: normalizedEmail, mode: 'local' };
}

export async function getActiveAdminSession() {
  const allowedList = (ADMIN_ACCESS.allowedEmails || [ADMIN_ACCESS.allowedEmail || ''])
    .filter(Boolean)
    .map((e) => e.toLowerCase());

  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && ctx.auth.currentUser) {
    const email = String(ctx.auth.currentUser.email || '').toLowerCase();
    if (ADMIN_ACCESS.allowAnyFirebaseUser || allowedList.length === 0 || allowedList.includes(email)) {
      return { email, mode: 'firebase' };
    }
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.ADMIN_SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const storedEmail = String(parsed.email || '').toLowerCase();
    if (ADMIN_ACCESS.allowAnyFirebaseUser || allowedList.length === 0 || allowedList.includes(storedEmail)) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

export async function logoutAdmin() {
  sessionStorage.removeItem(STORAGE_KEYS.ADMIN_SESSION);
  const ctx = await initBackend();
  if (ctx.mode === 'firebase' && ctx.authMod) {
    try {
      await ctx.authMod.signOut(ctx.auth);
    } catch (_) {}
  }
}
