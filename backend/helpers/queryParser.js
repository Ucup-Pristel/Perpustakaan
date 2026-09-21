/**
 * Sinonim/istilah unofficial <-> resmi, dipetakan dua arah otomatis.
 * Kunci & value bisa multi-kata (dicek sebagai token berurutan).
 */
const SYNONYM_PAIRS = [
  ['s1 tk', 's1 teknik komputer'],
  ['it', 'teknologi informasi'],
  ['computer', 'komputer'],
  ['programming', 'pemrograman'],
  ['algorithm', 'algoritma'],
  ['network', 'jaringan'],
  ['database', 'basis data'],
  ['machine learning', 'pembelajaran mesin'],
];

// Map kata/frasa -> Set frasa alternatif, dibangun dua arah dari SYNONYM_PAIRS.
const SYNONYM_MAP = new Map();
for (const [a, b] of SYNONYM_PAIRS) {
  if (!SYNONYM_MAP.has(a)) SYNONYM_MAP.set(a, new Set());
  if (!SYNONYM_MAP.has(b)) SYNONYM_MAP.set(b, new Set());
  SYNONYM_MAP.get(a).add(b);
  SYNONYM_MAP.get(b).add(a);
}

const normalize = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Ganti setiap kemunculan frasa `from` dalam `text` (token-boundary) dengan `to`.
 */
function replacePhrase(text, from, to) {
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return text.replace(re, to);
}

/**
 * Terima query mentah, kembalikan array varian query (query asli + hasil
 * substitusi sinonim dua arah) untuk dicoba satu-satu di Fuse.js.
 * Contoh: "komputer" -> ["komputer", "computer"]
 *         "belajar computer" -> ["belajar computer", "belajar komputer"]
 * @param {string} query
 * @returns {string[]}
 */
function queryParser(query) {
  const base = normalize(query);
  if (!base) return [];

  const variants = new Set([base]);
  for (const [phrase, alts] of SYNONYM_MAP) {
    if (!new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(base)) continue;
    for (const alt of alts) variants.add(replacePhrase(base, phrase, alt));
  }
  return [...variants];
}

module.exports = queryParser;
