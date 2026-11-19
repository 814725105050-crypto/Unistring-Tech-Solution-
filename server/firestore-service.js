import fs from 'fs';
import path from 'path';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'unistring-tech-solution';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

/**
 * Get OAuth token from Firebase CLI configstore if present
 */
function getCliOAuthToken() {
  try {
    const configPath = path.join(process.env.USERPROFILE || '', '.config', 'configstore', 'firebase-tools.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.tokens && cfg.tokens.access_token) {
        return cfg.tokens.access_token;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Convert plain JS object to Firestore document fields structure
 */
export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      fields[k] = { nullValue: null };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    } else if (typeof v === 'number') {
      if (Number.isInteger(v)) {
        fields[k] = { integerValue: String(v) };
      } else {
        fields[k] = { doubleValue: v };
      }
    } else if (typeof v === 'string') {
      fields[k] = { stringValue: v };
    } else if (Array.isArray(v)) {
      fields[k] = {
        arrayValue: {
          values: v.map((item) => {
            if (typeof item === 'object' && item !== null) {
              return { mapValue: { fields: toFirestoreFields(item) } };
            }
            if (typeof item === 'number') {
              return Number.isInteger(item) ? { integerValue: String(item) } : { doubleValue: item };
            }
            if (typeof item === 'boolean') return { booleanValue: item };
            return { stringValue: String(item) };
          })
        }
      };
    } else if (typeof v === 'object') {
      fields[k] = { mapValue: { fields: toFirestoreFields(v) } };
    }
  }
  return fields;
}

/**
 * Convert Firestore fields back into plain JS object
 */
export function fromFirestoreFields(fields) {
  if (!fields) return {};
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) obj[k] = v.stringValue;
    else if ('integerValue' in v) obj[k] = Number(v.integerValue);
    else if ('doubleValue' in v) obj[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) obj[k] = v.booleanValue;
    else if ('nullValue' in v) obj[k] = null;
    else if ('timestampValue' in v) obj[k] = v.timestampValue;
    else if ('arrayValue' in v) {
      const arr = v.arrayValue?.values || [];
      obj[k] = arr.map((item) => {
        if ('mapValue' in item) return fromFirestoreFields(item.mapValue.fields);
        if ('stringValue' in item) return item.stringValue;
        if ('integerValue' in item) return Number(item.integerValue);
        if ('doubleValue' in item) return Number(item.doubleValue);
        if ('booleanValue' in item) return item.booleanValue;
        return null;
      });
    } else if ('mapValue' in v) {
      obj[k] = fromFirestoreFields(v.mapValue.fields);
    }
  }
  return obj;
}

export async function firestoreGetDoc(collectionPath, docId, authToken) {
  const token = authToken || getCliOAuthToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${FIRESTORE_BASE}/${collectionPath}/${docId}`, { headers });
  if (!res.ok) {
    if (res.status === 404) return null;
    const txt = await res.text();
    throw new Error(`Firestore GET ${collectionPath}/${docId} failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  return { id: docId, ...fromFirestoreFields(data.fields) };
}

export async function firestoreSetDoc(collectionPath, docId, dataObj, authToken) {
  const token = authToken || getCliOAuthToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const body = JSON.stringify({ fields: toFirestoreFields(dataObj) });
  const res = await fetch(`${FIRESTORE_BASE}/${collectionPath}/${docId}`, {
    method: 'PATCH',
    headers,
    body
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore PATCH ${collectionPath}/${docId} failed [${res.status}]: ${txt}`);
  }
  const saved = await res.json();
  return { id: docId, ...fromFirestoreFields(saved.fields) };
}

export async function firestoreListDocs(collectionPath, authToken) {
  const token = authToken || getCliOAuthToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${FIRESTORE_BASE}/${collectionPath}?pageSize=1000`, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore LIST ${collectionPath} failed [${res.status}]: ${txt}`);
  }
  const data = await res.json();
  const documents = data.documents || [];
  return documents.map((doc) => {
    const parts = doc.name.split('/');
    const docId = parts[parts.length - 1];
    return { id: docId, ...fromFirestoreFields(doc.fields) };
  });
}
