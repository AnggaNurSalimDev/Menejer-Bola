// Bahasa tampilan (10 Nov, permintaan pengguna: game juga dalam bahasa Inggris).
//
//   t('Teks Indonesia {n}', { n: 3 })  → teks sesuai bahasa aktif, {nama} diganti nilainya
//
// Kunci = teks Indonesia asli (bahasa sumber), jadi tampilan Indonesia tidak butuh kamus dan teks
// yang lupa diterjemahkan tetap terbaca. scripts/check-i18n.js memastikan setiap t('…') di kode
// punya terjemahan Inggris (invariant: tidak ada teks Inggris yang hilang diam-diam).
// Mesin (engine) tidak disentuh: hanya teks tampilan.

import { EN } from './i18n.en.js';

export const LANGS = Object.freeze(['id', 'en']);
const KEY = 'menejer-bola:bahasa';

let current = 'id';

export function readLang() {
  try {
    const v = window.localStorage.getItem(KEY);
    if (LANGS.includes(v)) return v;
    const nav = (window.navigator?.language ?? '').toLowerCase();
    return nav.startsWith('id') || nav.startsWith('ms') ? 'id' : 'en';
  } catch {
    return 'id';
  }
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) throw new RangeError(`setLang: bahasa tidak dikenal ${lang}`);
  current = lang;
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    // penyimpanan tidak tersedia: bahasa hanya berlaku selama halaman terbuka
  }
}

export const getLang = () => current;

// Penanda teks yang diterjemahkan belakangan lewat t(variabel): tidak mengubah apa pun, hanya supaya
// pemeriksa kamus (scripts/check-i18n.js) menemukannya.
export const tk = (text) => text;

export function t(text, vars) {
  if (typeof text !== 'string') throw new TypeError('t: teks harus string');
  const s = current === 'en' ? (EN[text] ?? text) : text;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
