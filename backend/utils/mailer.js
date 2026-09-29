'use strict';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

function firstFrontendOrigin() {
  return (process.env.FRONTEND_URL || '')
    .split(',')
    .map(value => value.trim())
    .find(Boolean) || '';
}

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return url.origin;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (url.protocol === 'http:'
      && ['development', 'test'].includes(process.env.NODE_ENV)
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function getPasswordResetConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.MAIL_FROM || '').trim();
  const configuredBaseUrl = (process.env.PASSWORD_RESET_BASE_URL || '').trim();
  const resetBaseUrl = normalizeBaseUrl(configuredBaseUrl || firstFrontendOrigin());

  if (!apiKey || !from || !resetBaseUrl) return null;
  return { apiKey, from, resetBaseUrl };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const config = getPasswordResetConfig();
  if (!config) {
    const error = new Error('Email service is not configured');
    error.code = 'MAIL_NOT_CONFIGURED';
    throw error;
  }

  const safeUrl = escapeHtml(resetUrl);
  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.from,
        to: [to],
        subject: 'Reset password Ucup Edu Lib',
        html: `
          <p>Permintaan reset password telah dibuat untuk akun Ucup Edu Lib kamu.</p>
          <p><a href="${safeUrl}">Reset password</a></p>
          <p>Tautan ini berlaku selama 30 menit dan hanya dapat digunakan satu kali.</p>
          <p>Abaikan email ini jika kamu tidak meminta reset password.</p>
        `,
        text: [
          'Permintaan reset password telah dibuat untuk akun Ucup Edu Lib kamu.',
          '',
          resetUrl,
          '',
          'Tautan ini berlaku selama 30 menit dan hanya dapat digunakan satu kali.',
          'Abaikan email ini jika kamu tidak meminta reset password.',
        ].join('\n'),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    const error = new Error('Email provider is unavailable');
    error.code = 'MAIL_PROVIDER_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }

  if (!response.ok) {
    const error = new Error('Email provider rejected the request');
    error.code = 'MAIL_PROVIDER_ERROR';
    error.status = response.status;
    throw error;
  }
}

module.exports = { getPasswordResetConfig, normalizeBaseUrl, sendPasswordResetEmail };
