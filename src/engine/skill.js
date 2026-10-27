// Stat teknis → besar ketidaksempurnaan (tahap 5: blunder).
// docs/dokumen-arah-game.md, logika gerak prinsip 6.
//
// SEMUA angka blunder ada di file ini. Setiap baris berisi nilai untuk
// pemain terburuk (stat 1) dan terbaik (stat 20); di antaranya linear.
// Pemain berstat 12 (rata-rata tim contoh) kira-kira sama dengan perilaku
// sebelum tahap 5, sehingga titik nol permainan tidak bergeser jauh.

import { STAT_MIN, STAT_MAX } from './stats.js';

// Rentang disempitkan setelah uji ablasi (tahap 5): rentang lebar membuat
// tim kuat menang 16 dari 16 laga dan tim lemah hampir tidak pernah mencetak gol.
export const BLUNDER = Object.freeze({
  // Passing: simpangan arah operan (radian) dan simpangan kekuatan (bagian dari laju).
  passAngle: { worst: 0.1, best: 0.02, stat: 'passing' }, // ~5,7° … ~1,1°
  passSpeed: { worst: 0.12, best: 0.03, stat: 'passing' },

  // Kontrol: peluang sentuhan pertama terlalu jauh, per 10 m/s laju bola datang.
  heavyTouchPer10ms: { worst: 0.32, best: 0.03, stat: 'kontrol' },

  // Finishing: simpangan arah tembakan (radian).
  shotSpread: { worst: 0.11, best: 0.05, stat: 'finishing' }, // ~6,3° … ~2,9°

  // Keputusan: salah menilai keamanan operan (detik, simpangan baku).
  riskMisjudge: { worst: 0.35, best: 0.06, stat: 'keputusan' },

  // Visi: operan terjauh yang masih terpikirkan (meter).
  passVision: { worst: 26, best: 42, stat: 'visi' },

  // Antisipasi: waktu reaksi setelah bola berpindah (detik).
  reaction: { worst: 0.45, best: 0.18, stat: 'antisipasi' },

  // Posisi: pengali ketatnya menjaga lawan.
  markingTightness: { worst: 0.7, best: 1.08, stat: 'posisi' },

  // Kiper — Refleks: jangkauan di kotak sendiri (meter); Tangkapan: geseran peluang tangkap.
  keeperReach: { worst: 1.6, best: 2.0, stat: 'refleks' },
  catchBonus: { worst: -0.15, best: 0.12, stat: 'tangkapan' },
});

// Stat 1–20 → 0–1.
export function normalizeStat(value) {
  if (!Number.isFinite(value) || value < STAT_MIN || value > STAT_MAX) {
    throw new RangeError(`normalizeStat: stat di luar ${STAT_MIN}–${STAT_MAX}: ${value}`);
  }
  return (value - STAT_MIN) / (STAT_MAX - STAT_MIN);
}

// Nilai sebuah baris BLUNDER untuk satu set stat (objek stat 1–20).
export function blunderFromStats(stats, key) {
  const row = BLUNDER[key];
  if (!row) throw new RangeError(`blunderFromStats: baris "${key}" tidak ada`);
  if (!stats) throw new TypeError(`blunderFromStats: stats wajib ada untuk "${key}"`);
  const s = normalizeStat(stats[row.stat]);
  return row.worst + (row.best - row.worst) * s;
}

// Sama, untuk pemain di state pertandingan (stat ada di player.skills).
export function blunder(player, key) {
  if (!player?.skills) throw new TypeError(`blunder: pemain ${player?.id} tidak punya skills`);
  return blunderFromStats(player.skills, key);
}
