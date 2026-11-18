/**
 * CAMS Client Stub — Unistring Tech Solution Placement Drive Assessment
 * (Certificate automation features removed)
 */

export async function issueCamsCertificate() {
  return {
    ok: false,
    status: 'DISABLED',
    message: 'Certificate issuance is disabled for placement drive assessment.'
  };
}

export async function pingCamsWebhook() {
  return { ok: false, message: 'CAMS integration disabled.' };
}

export async function fetchCertificateJsonFromCams() {
  return null;
}

export function sanitizeAppsScriptEndpoint(rawUrl) {
  return String(rawUrl || '').trim();
}

export function buildCanonicalFirebaseVerifyLink() {
  return '/';
}

export function buildVerificationLink() {
  return '/';
}

export function buildCamsCompatibleCsv() {
  return '';
}
