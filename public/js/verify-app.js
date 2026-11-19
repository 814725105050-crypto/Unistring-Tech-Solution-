/**
 * Unistring Tech Solution - Public Result & QR Verification Service
 */

async function initVerification() {
  const loadingEl = document.getElementById('verify-loading');
  const errorEl = document.getElementById('verify-error');
  const resultEl = document.getElementById('verify-result');

  const params = new URLSearchParams(window.location.search);
  const subId = params.get('sub') || params.get('id') || params.get('ref');

  if (!subId) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = 'No submission reference provided in the verification URL. Please check your QR code or certificate link.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(subId)}`);
    const data = await res.json();

    loadingEl.classList.add('hidden');
    if (!res.ok || !data.ok) {
      errorEl.textContent = data.error || 'Verification failed. The requested record does not exist or has been invalidated.';
      errorEl.classList.remove('hidden');
      return;
    }

    const sub = data.submission;
    document.getElementById('v-name').textContent = sub.fullName || '-';
    document.getElementById('v-reg').textContent = sub.registerNumber || '-';
    document.getElementById('v-drive').textContent = sub.assessmentTitle || 'UTS Placement Drive';
    document.getElementById('v-slot').textContent = `Slot ${sub.slot || 1}`;
    document.getElementById('v-score').textContent = `${sub.score} / ${sub.totalQuestions || 50} (${sub.percentage}%)`;
    document.getElementById('v-time').textContent = sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : '-';

    resultEl.classList.remove('hidden');
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = 'Network or server error while connecting to verification registry.';
    errorEl.classList.remove('hidden');
  }
}

initVerification();
