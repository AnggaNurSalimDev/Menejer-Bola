// Pemeriksa kamus bahasa (10 Nov): setiap teks t('…') / tk('…') di tampilan, plus label dari engine
// yang ditampilkan lewat t(variabel) (gaya klub, filosofi), harus punya terjemahan Inggris di
// src/i18n.en.js — dan kamus tidak boleh berisi kunci yang sudah tidak dipakai.
// Jalankan: node scripts/check-i18n.js  (keluar dengan kode 1 bila ada yang kurang)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../src/i18n.en.js';
import { CLUB_STYLES } from '../src/engine/clubStyles.js';
import { PHILOSOPHIES } from '../src/engine/philosophy.js';
import { TEMPLATES } from '../src/engine/tacticTemplates.js';
import { PRESETS, presetNeeds } from '../src/engine/scriptPresets.js';

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'engine') walk(p);
    } else if (/\.(jsx?|mjs)$/.test(f) && !f.startsWith('i18n')) files.push(p);
  }
})('src');

const keys = new Set();
const re = /\bt[k]?\(\s*'((?:[^'\\]|\\.)*)'/g;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) keys.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}
for (const s of Object.values(CLUB_STYLES)) keys.add(s.label);
for (const p of Object.values(PHILOSOPHIES)) keys.add(p.label);
for (const tp of Object.values(TEMPLATES)) {
  keys.add(tp.label);
  keys.add(tp.idea);
}
for (const pr of Object.values(PRESETS)) {
  keys.add(pr.label);
  keys.add(pr.idea);
}
for (const n of presetNeeds()) keys.add(n);

// Kunci ganda di kamus (objek JS diam-diam memakai yang terakhir) — dicari dari teks berkas.
const enSrc = readFileSync('src/i18n.en.js', 'utf8');
const seenKeys = new Map();
for (const m of enSrc.matchAll(/^\s{2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*)):/gm)) {
  const k = m[1] ?? m[2] ?? m[3];
  seenKeys.set(k, (seenKeys.get(k) ?? 0) + 1);
}
const dupes = [...seenKeys].filter(([, n]) => n > 1).map(([k]) => k);
if (dupes.length) console.log(`KUNCI GANDA (${dupes.length}):\n` + dupes.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
const missing = [...keys].filter((k) => !(k in EN));
const unused = Object.keys(EN).filter((k) => !keys.has(k));
const badVars = [...keys].filter((k) => k in EN && [...k.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join() !== [...EN[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join());
console.log(`teks: ${keys.size} · terjemahan: ${Object.keys(EN).length}`);
if (missing.length) console.log(`BELUM DITERJEMAHKAN (${missing.length}):\n` + missing.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
if (unused.length) console.log(`TIDAK DIPAKAI (${unused.length}):\n` + unused.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
if (badVars.length) console.log(`VARIABEL {…} BEDA (${badVars.length}):\n` + badVars.map((k) => `  ${JSON.stringify(k)}`).join('\n'));
if (missing.length || unused.length || badVars.length || dupes.length) process.exit(1);
console.log('Kamus lengkap.');
