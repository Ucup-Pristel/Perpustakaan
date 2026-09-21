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

  await client.send(new PutObjectCommand({
    Bucket:      process.env.R2_BUCKET_NAME,
    Key:         key,
    Body:        fs.createReadStream(filePath),
    ContentType: mime,
    ContentLength: fs.statSync(filePath).size,
  }));

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Ekstrak key R2 dari public URL, misal
 * 'https://pub-xxx.r2.dev/pdfs/buku-123.pdf' -> 'pdfs/buku-123.pdf'.
 * @param {string} fileUrl
 * @returns {string|null}
 */
function extractR2Key(fileUrl) {
  if (!fileUrl) return null;
  const prefix = `${process.env.R2_PUBLIC_URL}/`;
  return fileUrl.startsWith(prefix) ? fileUrl.slice(prefix.length) : null;
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
