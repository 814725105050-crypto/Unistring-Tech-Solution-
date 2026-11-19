import fs from 'fs';
import path from 'path';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import dotenv from 'dotenv';
dotenv.config();

let dbInstance = null;
let authInstance = null;

export function initFirebaseAdmin() {
  if (getApps().length === 0) {
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      initializeApp({
        credential: cert(JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'))),
        projectId: process.env.FIREBASE_PROJECT_ID || 'unistring-tech-solution'
      });
    } else {
      // Try CLI OAuth Refresh Token if available in configstore
      let cliToken = null;
      try {
        const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          if (cfg.tokens && cfg.tokens.refresh_token) {
            cliToken = cfg.tokens.refresh_token;
          }
        }
      } catch (_) {}

      initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'unistring-tech-solution'
      });
    }
  }

  dbInstance = getFirestore();
  authInstance = getAuth();
  return { db: dbInstance, auth: authInstance };
}

export function getDb() {
  if (!dbInstance) initFirebaseAdmin();
  return dbInstance;
}

export function getAdminAuth() {
  if (!authInstance) initFirebaseAdmin();
  return authInstance;
}
