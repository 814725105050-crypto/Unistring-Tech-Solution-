import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  firestoreGetDoc,
  firestoreSetDoc,
  firestoreListDocs
} from './firestore-service.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'uts-jwt-secret-key-3284923-2026-prod';
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

export const app = express();

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline styles/scripts for assessment canvas & widgets
  crossOriginEmbedderPolicy: false
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { ok: false, error: 'Too many requests from this IP, please try again later.' }
});
app.use('/api/', apiLimiter);

/* -------------------------------------------------------------------------- */
/* In-Memory Assessment Session Cache (Atomic Server-Enforced Timers)          */
/* -------------------------------------------------------------------------- */

const activeExamSessions = new Map();

/* -------------------------------------------------------------------------- */
/* Helper Functions                                                           */
/* -------------------------------------------------------------------------- */

async function getFullQuestionsForSlot(slotNum = 1) {
  const slotDocId = `slot_${slotNum}_questions`;
  let snap = await firestoreGetDoc('portal_config', slotDocId);
  if (!snap || !Array.isArray(snap.items) || snap.items.length === 0) {
    snap = await firestoreGetDoc('portal_config', 'questions');
  }
  return snap && Array.isArray(snap.items) ? snap.items : [];
}

/**
 * Sanitizes questions for candidates by stripping answer keys & explanations
 */
function sanitizeQuestionsForCandidate(rawQuestions = []) {
  return rawQuestions.map((q, idx) => ({
    id: q.id || idx + 1,
    questionNumber: q.questionNumber || idx + 1,
    category: q.category || 'General',
    type: q.type || 'mcq',
    question: q.question || '',
    options: Array.isArray(q.options) ? q.options : [],
    marks: Number(q.marks || 1),
    negativeMarks: Number(q.negativeMarks || 0),
    explanation: undefined, // Stripped!
    correctIndex: undefined // Stripped!
  }));
}

/* -------------------------------------------------------------------------- */
/* API Routes: Student Assessment Flow                                        */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/portal/config
 * Provides public branding and active slot status without exposing sensitive keys
 */
app.get('/api/portal/config', async (req, res) => {
  try {
    const settings = (await firestoreGetDoc('portal_config', 'main')) || {};
    res.json({
      ok: true,
      quizTitle: settings.quizTitle || 'Placement Drive Assessment',
      conductedBy: settings.conductedBy || 'Unistring Tech Solution',
      logoUrl: settings.logoUrl || '/assets/uts-logo.png',
      quizOpen: settings.quizOpen !== false,
      activeSlot: Number(settings.activeSlot || 1),
      totalSlots: Number(settings.totalSlots || 2),
      durationMinutes: Number(settings.durationMinutes || 45),
      minSubmissionMinutes: Number(settings.minSubmissionMinutes || 0),
      maxWarnings: Number(settings.maxWarnings ?? 2),
      returnGraceSeconds: Number(settings.returnGraceSeconds ?? 20),
      examAccessCodeRequired: Boolean(settings.examAccessCode),
      shuffleQuestions: settings.shuffleQuestions !== false,
      shuffleOptions: settings.shuffleOptions !== false,
      requireFullscreen: settings.requireFullscreen !== false,
      canvasAntiSearch: settings.canvasAntiSearch !== false,
      watermarkRegNo: settings.watermarkRegNo !== false,
      resultVisibility: settings.resultVisibility || 'score_only',
      slotStatusMap: settings.slotStatusMap || { "1": true, "2": false }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/assessment/start
 * Server verifies eligibility, generates server session token, starts server timer,
 * and delivers SANITIZED questions with NO ANSWER KEYS.
 */
app.post('/api/assessment/start', async (req, res) => {
  try {
    const {
      fullName,
      registerNumber,
      email,
      phone,
      department,
      year,
      college,
      accessPin,
      requestedSlot
    } = req.body;

    if (!fullName || !registerNumber || !email) {
      return res.status(400).json({ ok: false, error: 'Full name, Register ID, and email are required.' });
    }

    const regNoNormalized = String(registerNumber).trim().toUpperCase();
    const settings = (await firestoreGetDoc('portal_config', 'main')) || {};

    // 1. Overall assessment status
    if (settings.quizOpen === false) {
      return res.status(403).json({ ok: false, error: 'The assessment portal is currently paused by the administrator.' });
    }

    // 2. Access Code verification
    if (settings.examAccessCode && String(settings.examAccessCode).trim()) {
      if (String(accessPin || '').trim() !== String(settings.examAccessCode).trim()) {
        return res.status(401).json({ ok: false, error: 'Invalid assessment entry code (Hall PIN).' });
      }
    }

    // 3. Slot determination & open check
    const currentSlot = Number(requestedSlot || settings.activeSlot || 1);
    const statusMap = settings.slotStatusMap || {
      "1": settings.slot1Open !== false,
      "2": settings.slot2Open !== false
    };

    if (statusMap[String(currentSlot)] === false) {
      return res.status(403).json({
        ok: false,
        error: `Slot ${currentSlot} is currently closed. Please contact the administrator.`
      });
    }

    // 4. Duplicate Attempt Lock Check
    const lockDoc = await firestoreGetDoc('reg_locks', regNoNormalized);
    if (lockDoc && lockDoc.locked && !lockDoc.retakeAllowed) {
      return res.status(409).json({
        ok: false,
        error: `Register Number ${regNoNormalized} has already submitted this assessment. Retake permission has not been granted.`
      });
    }

    // 5. Load questions and strip answer keys
    const rawQuestions = await getFullQuestionsForSlot(currentSlot);
    if (!rawQuestions.length) {
      return res.status(404).json({
        ok: false,
        error: `No questions have been configured for Slot ${currentSlot}. Please inform your test coordinator.`
      });
    }

    const sanitizedQuestions = sanitizeQuestionsForCandidate(rawQuestions);

    // 6. Issue Server-Enforced Session & Token
    const sessionId = crypto.randomUUID();
    const durationSeconds = Math.max(300, (Number(settings.durationMinutes) || 45) * 60);
    const expiresAt = Date.now() + durationSeconds * 1000;

    const sessionPayload = {
      sessionId,
      candidate: {
        fullName: String(fullName).trim(),
        registerNumber: regNoNormalized,
        email: String(email).trim().toLowerCase(),
        phone: String(phone || '').trim(),
        department: String(department || '').trim(),
        year: String(year || 'IV Year').trim(),
        college: String(college || 'SRM TRP Engineering College').trim(),
        slot: currentSlot
      },
      slot: currentSlot,
      startedAt: Date.now(),
      expiresAt,
      durationSeconds,
      minSubmissionMinutes: Number(settings.minSubmissionMinutes || 0),
      warningsLogged: 0,
      totalQuestions: sanitizedQuestions.length
    };

    activeExamSessions.set(sessionId, sessionPayload);

    // Mark lock in Firestore to prevent simultaneous registrations
    await firestoreSetDoc('reg_locks', regNoNormalized, {
      registerNumber: regNoNormalized,
      sessionId,
      slot: currentSlot,
      locked: true,
      retakeAllowed: false,
      lastStartedAt: new Date().toISOString()
    });

    const token = jwt.sign(sessionPayload, JWT_SECRET, { expiresIn: `${Math.ceil(durationSeconds / 60) + 15}m` });

    res.json({
      ok: true,
      token,
      sessionId,
      questions: sanitizedQuestions,
      durationSeconds,
      expiresAt,
      minSubmissionSeconds: Number(settings.minSubmissionMinutes || 0) * 60,
      slot: currentSlot
    });
  } catch (err) {
    console.error('Error starting assessment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/assessment/heartbeat
 * Logs proctoring violations and telemetry securely
 */
app.post('/api/assessment/heartbeat', async (req, res) => {
  try {
    const { token, violation, answeredCount } = req.body;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing session token.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ ok: false, error: 'Session expired or invalid.' });
    }

    const session = activeExamSessions.get(decoded.sessionId);
    if (session) {
      if (violation) session.warningsLogged = (session.warningsLogged || 0) + 1;
      session.lastHeartbeat = Date.now();
      session.answeredCount = answeredCount || 0;
    }

    // Server-enforced time remaining
    const remainingSeconds = Math.max(0, Math.floor((decoded.expiresAt - Date.now()) / 1000));
    res.json({
      ok: true,
      remainingSeconds,
      isExpired: remainingSeconds <= 0
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/assessment/submit
 * Performs SERVER-SIDE GRADING by matching candidate responses against real Firestore answer keys.
 * Client score cannot be spoofed!
 */
app.post('/api/assessment/submit', async (req, res) => {
  try {
    const { token, responses, isAutoSubmitted, submitReason, prematureExit, warningsUsed } = req.body;
    if (!token) return res.status(401).json({ ok: false, error: 'Missing assessment session token.' });

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ ok: false, error: 'Session expired or invalid signature.' });
    }

    const { candidate, slot, startedAt, durationSeconds, minSubmissionMinutes } = decoded;
    const now = Date.now();
    const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));

    // Verify minimum submission timer (unless auto-submitted by security/time-up)
    if (!isAutoSubmitted && minSubmissionMinutes > 0) {
      const minRequiredSeconds = minSubmissionMinutes * 60;
      if (elapsedSeconds < minRequiredSeconds) {
        return res.status(400).json({
          ok: false,
          error: `Minimum assessment timer has not elapsed. You may only submit after ${minSubmissionMinutes} minutes.`
        });
      }
    }

    // Fetch REAL answer keys from Firestore on server
    const rawQuestions = await getFullQuestionsForSlot(slot);
    let totalMarks = 0;
    let earnedMarks = 0;
    let correctCount = 0;

    const gradedItems = rawQuestions.map((q, idx) => {
      const qId = q.id || idx + 1;
      const candidateAnswer = responses ? responses[String(qId)] : undefined;
      const marksVal = Number(q.marks || 1);
      const negMarks = Number(q.negativeMarks || 0);
      totalMarks += marksVal;

      let isCorrect = false;
      if (candidateAnswer !== undefined && candidateAnswer !== null) {
        if (Number(candidateAnswer) === Number(q.correctIndex)) {
          isCorrect = true;
          earnedMarks += marksVal;
          correctCount++;
        } else if (negMarks > 0) {
          earnedMarks = Math.max(0, earnedMarks - negMarks);
        }
      }

      return {
        id: qId,
        question: q.question,
        candidateAnswer,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation || ''
      };
    });

    const percentage = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const submissionId = `SUB_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    const submissionRecord = {
      submissionId,
      fullName: candidate.fullName,
      registerNumber: candidate.registerNumber,
      email: candidate.email,
      phone: candidate.phone,
      department: candidate.department,
      year: candidate.year,
      college: candidate.college,
      slot: Number(slot || 1),
      score: earnedMarks,
      totalQuestions: rawQuestions.length,
      totalMarks,
      percentage,
      elapsedSeconds,
      warningsUsed: Number(warningsUsed || 0),
      isAutoSubmitted: Boolean(isAutoSubmitted),
      submitReason: submitReason || (isAutoSubmitted ? 'Time expired or proctoring limit' : 'Manual submission by candidate'),
      prematureExit: Boolean(prematureExit),
      submittedAt: new Date().toISOString()
    };

    // Save graded submission securely to Firestore
    await firestoreSetDoc('submissions', submissionId, submissionRecord);

    // Remove active session
    activeExamSessions.delete(decoded.sessionId);

    // Send back verified score receipt
    res.json({
      ok: true,
      submissionId,
      score: earnedMarks,
      totalQuestions: rawQuestions.length,
      totalMarks,
      percentage,
      elapsedSeconds,
      isAutoSubmitted: Boolean(isAutoSubmitted),
      submittedAt: submissionRecord.submittedAt
    });
  } catch (err) {
    console.error('Error submitting assessment:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/assessment/retake-request
 */
app.post('/api/assessment/retake-request', async (req, res) => {
  try {
    const { submissionId, registerNumber, reason } = req.body;
    if (!registerNumber) return res.status(400).json({ ok: false, error: 'Register ID is required.' });

    const regNoNormalized = String(registerNumber).trim().toUpperCase();
    if (submissionId) {
      await firestoreSetDoc('submissions', submissionId, {
        retakeRequested: true,
        retakeRequestReason: reason || 'Candidate requested retake',
        retakeRequestedAt: new Date().toISOString()
      });
    }

    res.json({ ok: true, message: 'Retake request logged successfully for administrator review.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/verify/:submissionId
 * Public verification endpoint for QR code result checking
 */
app.get('/api/verify/:submissionId', async (req, res) => {
  try {
    const { submissionId } = req.params;
    if (!submissionId) return res.status(400).json({ ok: false, error: 'Submission ID is required.' });

    const record = await firestoreGetDoc('submissions', submissionId);
    if (!record || !record.registerNumber) {
      return res.status(404).json({ ok: false, error: 'Submission record not found in verified registry.' });
    }

    res.json({
      ok: true,
      submission: {
        submissionId: record.submissionId || submissionId,
        fullName: record.fullName,
        registerNumber: record.registerNumber,
        slot: record.slot || 1,
        score: record.score ?? 0,
        totalQuestions: record.totalQuestions ?? 50,
        percentage: record.percentage ?? 0,
        submittedAt: record.submittedAt,
        assessmentTitle: 'Unistring Tech Solution Placement Drive'
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* Static File Serving & Fallback                                             */
/* -------------------------------------------------------------------------- */

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  index: 'index.html'
}));

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

/* -------------------------------------------------------------------------- */
/* Server Initialization                                                      */
/* -------------------------------------------------------------------------- */

export function startServer() {
  return app.listen(PORT, HOST, () => {
    console.log(`[UTS Assessment Platform] Express Server active at http://${HOST}:${PORT}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
