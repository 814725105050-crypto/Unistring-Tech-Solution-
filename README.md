# Unistring Tech Solution · Placement Drive Assessment Portal

A modern, mobile-first, proctored online assessment web application built for **Unistring Tech Solution** placement drives. Powered by **Firebase Hosting + Cloud Firestore + Firebase Authentication**.

---

## Key Features

### 1. Placement Assessment Experience
- **Mobile-First Responsive Design**: Optimized for phones, tablets, and desktop browsers.
- **Candidate Registration**: Captures full name, email, candidate ID, mobile number, and qualification/batch.
- **Deterministic Seeded Shuffling**: Shuffles question sequence and MCQ options per candidate while preserving order across page refreshes.
- **Real-Time Timer & Palette**: Sticky progress bar, remaining time countdown, and question navigator.

### 2. Multi-Layer Anti-Cheat Proctoring
- **HiDPI Protected Canvas**: Questions are rendered onto a non-selectable HTML5 `<canvas>` with a diagonal watermark stamp containing the candidate's ID to prevent DOM inspection, screenshot scraping, and Circle-to-Search.
- **Instant Security Lockout Curtain**: The millisecond focus is lost, split-screen is triggered, or tabs are switched, an opaque lockout screen immediately covers the assessment.
- **2-Warning + 20-Second Policy**:
  - Violation 1: Warning 1 of 2 + 20-second return countdown.
  - Violation 2: Final Warning 2 of 2 + 20-second return countdown.
  - Violation 3 (or timeout): Test auto-submits immediately.
- **Blocked Actions**: Context menu, copy/paste, text selection, multi-finger gestures, DevTools shortcuts, and PrintScreen.

### 3. Administrator Console (`/admin`)
- **JSON Question Bank Upload**: Easily upload assessment questions directly via a `.json` file.
- **JSON Template & Export**: One-click download of the sample JSON structure and export of current questions.
- **Dynamic Portal Logo**: Change company logo directly from the admin panel (via file upload or URL) — updates immediately on both candidate and admin interfaces.
- **Live Monitor**: See active candidates taking the test in real time, with their progress and security warning status.
- **Results & Timeline**: View scores, percentage, time taken, proctoring violation logs, and export all responses to CSV.
- **Retake Reset**: 1-click clearance to allow a candidate to re-attempt the assessment if needed.

---

## JSON Question Format

You can upload questions to the assessment bank using a `.json` file. Supported format:

```json
[
  {
    "id": 1,
    "category": "Technical",
    "type": "mcq",
    "question": "What is the primary purpose of an index in a relational database?",
    "options": [
      "Speed up data retrieval operations",
      "Ensure permanent physical backup",
      "Encrypt sensitive columns",
      "Compress binary files"
    ],
    "correctIndex": 0,
    "explanation": "Indexes allow the database engine to find rows much faster without scanning entire tables."
  },
  {
    "id": 2,
    "category": "Logical Reasoning",
    "type": "tf",
    "question": "In Git, committing changes creates a repository snapshot.",
    "options": [
      "True",
      "False"
    ],
    "correctIndex": 0,
    "explanation": "Git stores changes as miniature filesystem snapshots."
  }
]
```

Alternatively, you can wrap them in a `"questions"` property:
```json
{
  "questions": [ ... ]
}
```

---

## Firebase Configuration

This portal is configured for the Firebase project `unistring-tech-solution`:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyDA7t71gpJu25Bqu5SsPHFoRPRoT2P6Jxw",
  authDomain: "unistring-tech-solution.firebaseapp.com",
  projectId: "unistring-tech-solution",
  storageBucket: "unistring-tech-solution.firebasestorage.app",
  messagingSenderId: "12508598977",
  appId: "1:12508598977:web:ca6748e7f4b6cbc9233a40",
  measurementId: "G-4SDKR132EE"
};
```

### Local Preview
Run the local preview server:
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) for the candidate portal, and [http://localhost:3000/admin](http://localhost:3000/admin) for the admin console.

### Deploying to Firebase
```bash
# Login to Firebase CLI
npx firebase-tools login

# Deploy Firestore rules & Hosting
npx firebase-tools deploy --project unistring-tech-solution
```
