# Phase 0 Security & Control Audit Report

## 1. Project Architecture & Audit Summary
- **Repository**: `Unistring Tech Solution / embedx-assessment`
- **Active Branch**: `feature/enterprise-assessment-platform`
- **Backend Infrastructure**: Hybrid Node.js Express server + Firebase Hosting + Google Cloud Firestore (`unistring-tech-solution`) + Firebase Authentication.

---

## 2. Security Vulnerability Analysis

| Vulnerability ID | Category | Severity | Description | Exploitation Impact | Status & Remediation |
|---|---|---|---|---|---|
| **SEC-001** | Information Disclosure | **CRITICAL** | Client questions data endpoint (`portal_config/questions`) exposes `correctIndex` and `explanation` directly in client memory (`quiz-app.js`, `test-preview-app.js`). | Any candidate can open Chrome DevTools, inspect `window.__activeQuestions` or network response, and obtain 100% accurate answer keys prior to answering. | **FIXING IN PHASE 1**: Strip answer keys on server. Deliver sanitized questions without `correctIndex` or `explanation` to candidate clients. |
| **SEC-002** | Client-Side Grading | **CRITICAL** | Submission score calculation (`score`, `percentage`, `correctAnswersCount`) performed entirely in browser (`quiz-app.js:1088-1120`). | Candidates can modify the submission payload or intercept the network call to forge a 100% score. | **FIXING IN PHASE 1**: Move entire evaluation and grading engine to server Express API endpoint (`/api/assessment/submit`). |
| **SEC-003** | Insecure Timer & Clock Manipulation | **HIGH** | Exam timer countdown relies on client timestamp checks and local countdown timers (`quiz-app.js:630`). | Candidates can modify system clock, freeze execution in DevTools debugger, or clear session storage to bypass time limits. | **FIXING IN PHASE 1**: Server enforces monotonic server start timestamp, heartbeat checks (`/api/assessment/heartbeat`), and auto-terminates expired tests. |
| **SEC-004** | Missing Server Role-Based Access Control (RBAC) | **HIGH** | Admin dashboard (`/admin.html`) accesses Firestore directly via client SDK with client-side credential checks. | Direct API manipulation allows non-admins to read candidate details or modify portal configurations if security rules are permissive. | **FIXING IN PHASE 1**: Enforce JWT-based authenticated server routes (`/api/admin/*`) with server verification. |
| **SEC-005** | IDOR on Submissions & Reg Locks | **HIGH** | `firestore.rules` allows arbitrary document retrieval by document ID without verifying ownership. | Anyone guessing or generating submission UUIDs or candidate register numbers can fetch candidate performance. | **FIXING IN PHASE 1**: Enforce strict session token checks and restrict Firestore read rules to authenticated coordinators. |
| **SEC-006** | Multiple Submissions / Tab Clones | **MEDIUM** | Student opening multiple tabs or refreshing can cause race conditions in `reg_locks`. | Double submissions or stale overwrites. | **FIXING IN PHASE 1**: Atomic server-side lock with idempotency key. |

---

## 3. UI Buttons & Controls Status Matrix

| Module | Control / Button / Form | Type | Current Status | Remediation Plan |
|---|---|---|---|---|
| **Student Registration** | `btn-start-test` (Start Assessment) | Button | **WORKING** | Connect to server session issuance (`/api/assessment/start`) |
| **Student Registration** | Email, RegNo, Mobile, College Fields | Inputs | **WORKING** | Add strict server-side regex validation & rate limiting |
| **Student Quiz** | `btn-prev`, `btn-next` (Navigation) | Buttons | **WORKING** | Preserve client responsiveness with 3s reading lock |
| **Student Quiz** | Question Palette Pills (`.palette-btn`) | Buttons | **WORKING** | Keep 4-state legend (Answered, Unanswered, Current, Marked) |
| **Student Quiz** | `btn-finish-quiz` (Submit Assessment) | Button | **WORKING** | Switch to `/api/assessment/submit` with server grading |
| **Student Quiz** | Retake Request Form (`retake-request-form`) | Form | **WORKING** | Wire to `/api/assessment/retake-request` |
| **Student Verification** | `verify.html` Certificate Stub | Page | **BROKEN / STUB** | Build QR Certificate Verification with HMAC signature |
| **Admin Login** | `admin-login-form` (Sign In) | Form | **WORKING** | Enhanced with Express JWT server endpoint |
| **Admin Login** | `btn-toggle-pw` (Show/Hide) | Button | **WORKING** | Maintained with high accessibility |
| **Admin Quick Bar** | `btn-quick-toggle-quiz` (Open/Pause) | Button | **WORKING** | Real-time sync with server state |
| **Admin Quick Bar** | Dynamic Slot Selector & Toggle Group | Buttons | **WORKING** | Fully synced with server slot states |
| **Admin Quick Bar** | `btn-add-new-slot` / `btn-remove-last-slot` | Buttons | **WORKING** | Server dynamic slots management |
| **Admin Submissions** | Search input, filter dropdown, sort dropdown | Controls | **WORKING** | Real-time responsive filtering |
| **Admin Submissions** | Slot Responses Bar (`#slot-responses-selector-bar`) | Buttons | **WORKING** | Google Forms-style response segregation |
| **Admin Submissions** | Results CSV Export (`Export All / Slot CSV`) | Buttons | **WORKING** | Enhanced with server-backed Excel / CSV generation |
| **Admin Retakes** | `act-grant-retake` / `act-deny-retake` | Buttons | **WORKING** | Wired to server clearance endpoint |
| **Admin Drives** | `btn-create-drive-modal` (New Drive) | Button/Modal | **WORKING** | Expands to full Google Forms builder in Phase 2 |
| **Admin Drives** | `act-activate-drive` (Switch Drive) | Buttons | **WORKING** | Sets active assessment ID on server |
| **Admin Question Bank**| `btn-add-question` / `btn-upload-json` | Buttons | **WORKING** | Expanded to support all Phase 2 question types |
| **Admin Question Bank**| `btn-reset-questions` | Button | **WORKING** | Empties question bank with confirmation |
| **CAMS Certificate Sync** | `cams-client.js` functions | Scripts | **FAKE / DISABLED** | Remove or replace with real PDF & QR certificate engine in Phase 3 |
