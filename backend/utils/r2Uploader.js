const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const MIME_MAP = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
};

function getPublicBase() {
  const configured = typeof process.env.R2_PUBLIC_URL === 'string'
    ? process.env.R2_PUBLIC_URL.trim()
    : '';
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const pathPrefix = url.pathname.replace(/^\/+|\/+$/g, '');
    return {
      origin: url.origin,
      pathPrefix,
      value: `${url.origin}${pathPrefix ? `/${pathPrefix}` : ''}`,
    };
  } catch {
    return null;
  }
}

function normalizeRelativeKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('//')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return null;

  const key = trimmed.replace(/^\/+/, '');
  return key || null;
}

/**
 * Upload file dari disk ke R2 dengan nama unik (timestamp + random).
 * Stream dari path, tidak load seluruh file ke memori.
 * @param {string} filePath  — path file sementara di disk
 * @param {string} originalName
 * @param {string} folder  — subfolder di bucket, misal 'pdfs' atau 'covers'
 * @returns {Promise<string>} public URL
 */
async function uploadToR2(filePath, originalName, folder = 'uploads') {
  const ext    = path.extname(originalName).toLowerCase();
  const uid    = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const base   = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9_\-. ]/g, '')
    .trim()
    .slice(0, 60)
    .replace(/\s+/g, '_') || 'file';
  const key    = `${folder}/${base}-${uid}${ext}`;
  const mime   = MIME_MAP[ext] || 'application/octet-stream';
  const contentLength = fs.statSync(filePath).size;
  const body = fs.createReadStream(filePath);

  try {
    await client.send(new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME,
      Key:         key,
      Body:        body,
      ContentType: mime,
      ContentLength: contentLength,
    }));
  } catch (err) {
    if (!body.destroyed) body.destroy();
    throw err;
  }

  const publicBase = getPublicBase();
  return `${publicBase?.value || ''}/${key}`;
}

/**
 * Ekstrak key R2 dari public URL, misal
 * 'https://pub-xxx.r2.dev/pdfs/buku-123.pdf' -> 'pdfs/buku-123.pdf'.
 * @param {string} fileUrl
 * @returns {string|null}
 */
function extractR2Key(fileUrl) {
  if (typeof fileUrl !== 'string') return null;
  const value = fileUrl.trim();
  if (!value || value === '/' || value.startsWith('//')) return null;

  if (/^https?:\/\//i.test(value)) {
    const publicBase = getPublicBase();
    if (!publicBase) return null;

    try {
      const url = new URL(value);
      if (url.origin !== publicBase.origin) return null;

      let key = url.pathname.replace(/^\/+/, '');
      if (publicBase.pathPrefix) {
        const prefix = `${publicBase.pathPrefix}/`;
        if (!key.startsWith(prefix)) return null;
        key = key.slice(prefix.length);
      }
      return normalizeRelativeKey(key);
    } catch {
      return null;
    }
  }

  return normalizeRelativeKey(value);
}

/**
 * Hapus satu object dari R2. Dianggap sukses jika object memang tidak ada.
 * Melempar error jika kegagalan lain (network, permission, dll) agar
 * caller tidak melanjutkan hapus baris DB.
 * @param {string} fileUrl — public URL, boleh null/undefined (di-skip)
 */
async function deleteFromR2(fileUrl) {
  const key = extractR2Key(fileUrl);
  if (!key) return;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return;
    throw err;
  }
}

module.exports = { uploadToR2, deleteFromR2 };
