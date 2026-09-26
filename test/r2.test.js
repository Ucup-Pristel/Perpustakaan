const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Stub before loading uploader: no credentials, dotenv, or network needed.
const originalSend = S3Client.prototype.send;
const originalBase = process.env.R2_PUBLIC_URL;
const originalBucket = process.env.R2_BUCKET_NAME;
let commands;
let send;
S3Client.prototype.send = async function (command) {
  commands.push(command);
  return send(command);
};
const { uploadToR2, deleteFromR2 } = require('../backend/utils/r2Uploader');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-test-'));
const file = path.join(dir, 'sample.pdf');
fs.writeFileSync(file, '%PDF-1.7\n');
beforeEach(() => {
  commands = [];
  send = async () => ({});
  process.env.R2_PUBLIC_URL = 'https://bucket.example';
  process.env.R2_BUCKET_NAME = 'test-bucket';
});
after(() => {
  S3Client.prototype.send = originalSend;
  for (const [key, value] of [['R2_PUBLIC_URL', originalBase], ['R2_BUCKET_NAME', originalBucket]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const stored of ['/pdfs/book.pdf', 'pdfs/book.pdf']) {
  test(`deletes relative stored URL ${stored}`, async () => {
    await deleteFromR2(stored);
    assert.equal(commands.length, 1);
    assert.ok(commands[0] instanceof DeleteObjectCommand);
    assert.deepEqual(commands[0].input, { Bucket: 'test-bucket', Key: 'pdfs/book.pdf' });
  });
}
for (const base of ['https://bucket.example', 'https://bucket.example/']) {
  test(`deletes own absolute URL with base ${base}`, async () => {
    process.env.R2_PUBLIC_URL = base;
    await deleteFromR2('https://bucket.example/pdfs/book.pdf');
    assert.equal(commands.length, 1);
    assert.equal(commands[0].input.Key, 'pdfs/book.pdf');
  });
  test(`upload URL has one joining slash with base ${base}`, async () => {
    process.env.R2_PUBLIC_URL = base;
    send = async command => {
      for await (const chunk of command.input.Body) assert.ok(chunk.length);
      return {};
    };
    const url = await uploadToR2(file, 'sample.pdf', 'pdfs');
    assert.ok(commands[0] instanceof PutObjectCommand);
    assert.equal(commands[0].input.ContentType, 'application/pdf');
    assert.equal(commands[0].input.ContentLength, fs.statSync(file).size);
    assert.equal(url, `https://bucket.example/${commands[0].input.Key}`);
  });
}
test('skips empty URLs and foreign origins', async () => {
  for (const url of [null, undefined, '', '/', 'https://foreign.example/pdfs/a.pdf',
    'https://bucket.example.evil/pdfs/a.pdf', '//foreign.example/a.pdf', 'ftp://foreign.example/a.pdf']) {
    await deleteFromR2(url);
  }
  assert.equal(commands.length, 0);
});
test('ignores missing objects but propagates permission errors', async () => {
  for (const error of [Object.assign(new Error('missing'), { name: 'NoSuchKey' }),
    Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } })]) {
    send = async () => { throw error; };
    await deleteFromR2('https://bucket.example/pdfs/book.pdf');
  }
  const denied = Object.assign(new Error('denied'), { name: 'AccessDenied' });
  send = async () => { throw denied; };
  await assert.rejects(deleteFromR2('https://bucket.example/pdfs/book.pdf'), error => error === denied);
});
test('closes upload stream when S3 rejects before reading body', async () => {
  let body;
  const failure = new Error('S3 rejected');
  send = async command => {
    body = command.input.Body;
    await once(body, 'open');
    throw failure;
  };
  try {
    await assert.rejects(uploadToR2(file, 'sample.pdf'), error => error === failure);
    assert.equal(body.destroyed, true);
    if (!body.closed) await once(body, 'close');
    assert.equal(body.closed, true);
  } finally {
    if (body && !body.closed) {
      body.destroy();
      await once(body, 'close');
    }
  }
});
