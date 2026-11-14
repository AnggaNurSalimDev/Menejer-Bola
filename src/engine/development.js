// Umur, potensi, perkembangan, latihan, kondisi antar-laga (15 Nov, keputusan pengguna: potensi tampil
// sebagai perkiraan bintang; latihan = fokus + intensitas tim; rotasi pemain lelah oleh pengguna +
// tombol sekali klik, klub AI merotasi sendiri).
//
//   pemain += { age, pot (nilai puncak yang bisa dicapai), fit (kondisi 0–100) }
//
//   tiap pergantian bulan (menurut tanggal babak):
//     muda & masih di bawah potensi ─▶ tiap stat berpeluang +1   (umur, menit bermain, latihan)
//     umur ≥ 30                      ─▶ stat fisik berpeluang −1 (makin tua makin sering)
//   tiap babak: yang main kehilangan kondisi; kondisi pulih per hari menurut intensitas latihan
//   tiap musim baru: umur +1, yang tua bisa pensiun, pemain muda masuk
//
// Fungsi murni; rng dari pemanggil.

import { TECHNICAL_STATS, GOALKEEPER_STATS, clampStat } from './stats.js';

export const DEV = Object.freeze({
  ages: Object.freeze([17, 35]),
  growth: 0.06, // peluang dasar +1 per stat per bulan, × faktor umur × main × latihan × (sisa potensi / 2)
  ageGrowth: Object.freeze([
    [20, 1.2],
    [23, 1.0],
    [26, 0.6],
    [29, 0.25],
  ]),
  benchGrowth: 0.6, // cadangan berkembang lebih lambat dari pemain inti
  declineFrom: 30,
  decline: 0.03, // peluang −1 stat fisik per bulan per tahun di atas 29
  retireFrom: 34,
  retireAt: 37,
  youthAge: Object.freeze([16, 18]),
  // Kondisi (fit): turun setelah main, pulih per hari.
  recoverPerDay: Object.freeze({ ringan: 13, normal: 11, berat: 9 }),
  aiMatchCost: Object.freeze([28, 40]),
  tiredBelow: 75, // peringatan & tombol "istirahatkan"
  aiRestBelow: 70, // klub AI merotasi pemain di bawah ini bila ada pengganti segar
  freshFrom: 85,
});

export const TRAINING_FOCUS = Object.freeze(['seimbang', 'serang', 'bertahan', 'fisik', 'teknik', 'taktik']);
export const TRAINING_INTENSITY = Object.freeze(['ringan', 'normal', 'berat']);
export const DEFAULT_TRAINING = Object.freeze({ focus: 'seimbang', intensity: 'normal' });
const INTENSITY_GROWTH = { ringan: 0.8, normal: 1, berat: 1.25 };
export const INTENSITY_INJURY = Object.freeze({ ringan: 0.7, normal: 1, berat: 1.4 });
const FOCUS_STATS = {
  seimbang: [],
  serang: ['finishing', 'dribbling', 'visi', 'keputusan', 'kontrol'],
  bertahan: ['tackling', 'posisi', 'antisipasi', 'duelUdara', 'kekuatan'],
  fisik: ['kecepatan', 'akselerasi', 'kelincahan', 'stamina', 'kekuatan'],
  teknik: ['passing', 'kontrol', 'dribbling', 'finishing', 'visi'],
  taktik: ['keputusan', 'posisi', 'antisipasi', 'visi'], // + mempercepat pemahaman template (league.js)
};
const PHYSICAL = ['kecepatan', 'akselerasi', 'kelincahan', 'stamina'];

export function trainingErrors(t) {
  const e = [];
  if (!t || typeof t !== 'object') return ['latihan tidak valid'];
  if (!TRAINING_FOCUS.includes(t.focus)) e.push(`fokus latihan tidak dikenal: ${t.focus}`);
  if (!TRAINING_INTENSITY.includes(t.intensity)) e.push(`intensitas latihan tidak dikenal: ${t.intensity}`);
  return e;
}

// Nilai keseluruhan pemain: kiper dari stat kiper + posisi, lainnya dari stat teknik (tanpa kecerobohan).
export const overallKeys = (role) => (role === 'GK' ? [...GOALKEEPER_STATS, 'posisi', 'antisipasi'] : TECHNICAL_STATS.filter((k) => k !== 'kecerobohan'));
export function overall(player) {
  const s = player.stats;
  const vals = overallKeys(player.role).map((k) => s[k]).filter(Number.isFinite);
  if (vals.length === 0) throw new Error(`overall: stat kosong untuk ${player.uid ?? player.id}`);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Umur & potensi awal. Sisa potensi makin besar untuk yang muda.
export function rollAgePot(player, rng, { age = null } = {}) {
  const a = age ?? 18 + Math.round((rng.next() + rng.next()) * 8); // segitiga 18–34, rata-rata 26
  const ageClamped = Math.min(DEV.ages[1], Math.max(DEV.ages[0], a));
  const ovr = overall(player);
  const head = ageClamped <= 20 ? rng.range(2, 5) : ageClamped <= 23 ? rng.range(1, 3.5) : ageClamped <= 26 ? rng.range(0, 1.5) : 0;
  return { age: ageClamped, pot: round1(Math.min(19.5, ovr + head)) };
}

// Perkiraan potensi (bintang, kelipatan ½) — rentang yang selalu memuat potensi sebenarnya. Lebar
// rentang tetap per pemain (dari uid), jadi tidak berubah-ubah tiap kali dibuka.
// Skala bintang dunia permainan: nilai 7 ≈ ½★, 18 ≈ 5★.
export const toStars = (v) => Math.min(5, Math.max(0.5, Math.round(((v - 7) / 2.2) * 2) / 2));
export function potentialRange(player) {
  if (!Number.isFinite(player.pot)) return null;
  let h = 0;
  for (const ch of String(player.uid ?? '')) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  const below = ((h % 7) / 6) * 1.2; // 0–1,2 poin
  // Ketidakpastian ke atas hanya besar untuk yang masih bisa berkembang.
  const above = (((h >> 3) % 7) / 6) * (player.pot > overall(player) + 0.3 ? 1.2 : 0.3);
  const lo = toStars(Math.max(overall(player), player.pot - below));
  const hi = toStars(player.pot + above);
  return [lo, Math.max(lo, hi)];
}

const ageFactor = (age) => (DEV.ageGrowth.find(([upTo]) => age <= upTo)?.[1] ?? 0);

// Satu langkah perkembangan bulanan untuk satu pemain.
//   starter: masuk susunan efektif · training: { focus, intensity } (klub AI: bawaan)
export function developMonth(player, rng, { starter = true, training = DEFAULT_TRAINING } = {}) {
  if (!Number.isInteger(player.age)) throw new TypeError(`developMonth: umur tidak valid ${player.uid}`);
  const stats = { ...player.stats };
  const keys = overallKeys(player.role);
  const head = Math.max(0, player.pot - overall(player));
  const grow = DEV.growth * ageFactor(player.age) * (starter ? 1 : DEV.benchGrowth) * INTENSITY_GROWTH[training.intensity] * Math.min(2, head / 2);
  const focus = FOCUS_STATS[training.focus] ?? [];
  let changed = false;
  if (grow > 0) {
    for (const k of keys) {
      if (!Number.isFinite(stats[k])) continue;
      const w = focus.length === 0 ? 1 : focus.includes(k) ? 1.8 : 0.7;
      if (rng.chance(Math.min(0.5, grow * w))) {
        stats[k] = clampStat(stats[k] + 1);
        changed = true;
      }
    }
  }
  if (player.age >= DEV.declineFrom) {
    const q = DEV.decline * (player.age - (DEV.declineFrom - 1));
    for (const k of player.role === 'GK' ? ['refleks', ...PHYSICAL] : [...PHYSICAL, 'kontrol', 'passing']) {
      if (!Number.isFinite(stats[k])) continue;
      const p = PHYSICAL.includes(k) ? q : q / 3;
      if (rng.chance(Math.min(0.5, p))) {
        stats[k] = clampStat(stats[k] - 1);
        changed = true;
      }
    }
  }
  if (!changed) return player;
  const next = { ...player, stats };
  // Potensi tidak pernah di bawah nilai sekarang (pemain yang menurun: potensinya ikut turun).
  const ovr = overall(next);
  return { ...next, pot: round1(player.age >= DEV.declineFrom ? Math.min(player.pot, ovr) : Math.max(player.pot, ovr)) };
}

// Peluang pensiun di akhir musim (umur SETELAH ditambah satu).
export function retireChance(age) {
  if (age >= DEV.retireAt) return 1;
  if (age < DEV.retireFrom) return 0;
  return 0.3 + 0.2 * (age - DEV.retireFrom);
}

// Kondisi setelah babak: pulih `days` hari.
export function recover(fit, days, intensity = 'normal') {
  if (!(days >= 0)) throw new RangeError(`recover: hari tidak valid ${days}`);
  return Math.min(100, Math.round(fit + days * DEV.recoverPerDay[intensity]));
}
