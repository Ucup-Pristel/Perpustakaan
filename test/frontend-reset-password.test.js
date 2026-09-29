'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/pages/ResetPassword.jsx'), 'utf8');

test('ResetPassword keeps the token in memory and replaces the URL without the query token', () => {
  assert.match(source, /const \[searchParams, setSearchParams\] = useSearchParams\(\)/);
  assert.match(source, /const \[token\] = useState\(\(\) => searchParams\.get\('token'\) \|\| ''\)/);
  assert.match(source, /setSearchParams\(cleanedParams, \{ replace: true \}\)/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)\(['"]token/);
  assert.doesNotMatch(source, /sessionStorage\.(?:getItem|setItem|removeItem)\(['"]token/);
});
