/**
 * Firebase Configuration — Unistring Tech Solution Placement Drive Assessment
 */

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDA7t71gpJu25Bqu5SsPHFoRPRoT2P6Jxw",
  authDomain: "unistring-tech-solution.firebaseapp.com",
  projectId: "unistring-tech-solution",
  storageBucket: "unistring-tech-solution.firebasestorage.app",
  messagingSenderId: "12508598977",
  appId: "1:12508598977:web:ca6748e7f4b6cbc9233a40",
  measurementId: "G-4SDKR132EE"
};

export const OFFICIAL_FIREBASE_VERIFY_URL = 'https://unistring-tech-solution.web.app/verify';

/**
 * Checks whether an admin runtime override exists, otherwise returns live FIREBASE_CONFIG.
 */
export function getEffectiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem('uts_firebase_config_override');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && !String(parsed.apiKey).startsWith('REPLACE_WITH_')) {
        return parsed;
      }
    }
  } catch (_) {
    // ignore storage errors
  }
  return FIREBASE_CONFIG;
}

export function isFirebaseConfigured(cfg = getEffectiveFirebaseConfig()) {
  return Boolean(
    cfg &&
    cfg.apiKey &&
    cfg.projectId &&
    !String(cfg.apiKey).startsWith('REPLACE_WITH_') &&
    !String(cfg.projectId).startsWith('REPLACE_WITH_')
  );
}

/**
 * Admin Credentials Policy
 * Accepts either admin@unistring.com or existing admin credentials.
 */
export const ADMIN_ACCESS = Object.freeze({
  allowedEmails: [
    'admin@unistring.com',
    '814725105014@trp.srmtrichy.edu.in'
  ],
  allowedEmail: 'admin@unistring.com',
  // SHA-256 of "Admin@UTS2026" and fallback "Hari@EEE29"
  allowedPasswordHashes: [
    'e9447e45300f2ae9b276d4df997871b699a7065961d6ecbcfd5069b2d8697193', // Admin@UTS2026
    '02ec78533da916a8a24392b408d3a32aa4a5d766bf5632b40f08a5d230c4f920'  // Hari@EEE29
  ],
  passwordSha256: 'e9447e45300f2ae9b276d4df997871b699a7065961d6ecbcfd5069b2d8697193'
});

/**
 * Default Portal & Placement Drive Assessment Settings
 */
export const DEFAULT_PORTAL_SETTINGS = {
  quizOpen: true,
  quizTitle: 'Placement Drive Assessment',
  workshopName: 'Unistring Placement Assessment',
  courseDuration: 'Placement Drive',
  conductedBy: 'Unistring Tech Solution',
  organizationName: 'Unistring Tech Solution',
  logoUrl: '/assets/uts-logo.png',
  durationMinutes: 30,
  maxWarnings: 2,
  returnGraceSeconds: 20,
  shuffleQuestions: true,
  shuffleOptions: true,
  requireFullscreen: true,
  canvasAntiSearch: true,
  watermarkRegNo: true,
  allowDuplicateEmail: false,
  examAccessCode: '',
  // Student post-submit display: 'score_only' | 'receipt_only' | 'full_answers'
  resultVisibility: 'score_only',
  // Certificate system removed
  camsEnabled: false,
  camsWebhookUrl: '',
  camsVerificationUrl: OFFICIAL_FIREBASE_VERIFY_URL,
  camsApiSecret: ''
};
