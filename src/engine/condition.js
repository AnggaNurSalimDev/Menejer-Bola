// Kondisi pemain sepanjang pertandingan (tahap 6: psikologi dan kelelahan).
// docs/dokumen-arah-game.md bagian 5B dan 5C.
//
// Prinsip: stat teknis adalah plafon; kondisi menentukan berapa banyak dari
// plafon itu yang keluar saat ini. Semua efek di sini adalah NERF (keputusan
// 28 Okt 2026: kepercayaan diri tidak memberi bonus), dan total nerf dibatasi.
//
// SEMUA angka kondisi ada di file ini.

import { normalizeStat } from './skill.js';

export const CONDITION = Object.freeze({
  // --- Tenaga (stat Stamina) ---
  // Terkuras per detik: dasar + tambahan saat berlari kencang (pangkat 3: sprint mahal).
  // Dikalibrasi supaya pemain rata-rata berakhir di sekitar 40–55% tenaga.
  baseDrainPerSecond: 0.0005,
  sprintDrainPerSecond: 0.0055,
  // Pengali kuras: stamina terburuk … terbaik.
  drainFactor: { worst: 1.5, best: 0.6 },
  // Pulih sedikit saat berjalan pelan.
  recoveryPerSecond: 0.0005,
  slowSpeedFraction: 0.3,
  halftimeRecovery: 0.15,
  // Kelelahan baru terasa setelah tenaga turun melewati ambang ini.
  fatigueFreeZone: 0.2,
  fatigueBlunder: 0.5, // tambahan besar blunder per satuan kelelahan di atas ambang
  fatiguePhysical: 0.25, // pengurangan laju & percepatan per satuan kelelahan di atas ambang

  // --- Determinasi: menahan efek lelah saat tertinggal atau di menit akhir ---
  determinationShield: 0.6, // bagian efek lelah yang ditahan oleh determinasi 20
  lateGameMinute: 70,

  // --- Kepercayaan diri (stat Stabilitas mental) ---
  startConfidence: 0.75,
  confidenceDriftPerSecond: 0.0015, // perlahan kembali ke awal
  // Kepekaan terhadap kegagalan: stabilitas terburuk … terbaik.
  lossSensitivity: { worst: 1.6, best: 0.5 },
  confidenceBlunder: 0.25, // tambahan besar blunder saat percaya diri 0
  // Ragu: bobot operan ke depan berkurang saat percaya diri rendah.
  hesitantProgressFloor: 0.5,

  // --- Form hari ini (stat Konsistensi): nerf kecil yang diacak saat kick-off ---
  formSpread: { worst: 0.18, best: 0.03 },
  formMax: 0.25,

  // --- Tekanan (stat Ketenangan) ---
  pressureBlunder: 0.2, // ditekan lawan dari dekat, ketenangan 1
  bigChanceBlunder: 0.25, // peluang besar (tembakan dekat), ketenangan 1

  // --- Batas (dokumen arah 5C) ---
  maxBlunderPenalty: 0.3, // besar blunder paling banyak +30%
  maxPhysicalPenalty: 0.3, // laju & percepatan paling banyak −30%

  // --- Egoisme: kecenderungan menembak (bukan nerf) ---
  egoShotThreshold: { worst: 1.2, best: 0.8 }, // pengali ambang tembak: egois rendah … tinggi
});

// Perubahan kepercayaan diri per peristiwa (sebelum dikali kepekaan untuk kegagalan).
export const CONFIDENCE_EVENTS = Object.freeze({
  passCompleted: 0.012,
  goal: 0.25,
  tackleWon: 0.05,
  save: 0.06,
  heavyTouch: -0.09,
  passIntercepted: -0.075,
  dispossessed: -0.075,
  beaten: -0.05,
  conceded: -0.12,
  offside: -0.04,
});

// Peristiwa yang dihitung sebagai "catatan blunder" pemain.
export const BLUNDER_EVENTS = Object.freeze(['heavyTouch', 'passIntercepted', 'dispossessed', 'beaten', 'conceded']);

function lerpByStat(row, statValue) {
  return row.worst + (row.best - row.worst) * normalizeStat(statValue);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// Kondisi awal pemain. rng dipakai untuk form hari ini.
export function initialCondition(skills, rng) {
  if (!skills) throw new TypeError('initialCondition: skills wajib ada');
  const spread = lerpByStat(CONDITION.formSpread, skills.konsistensi);
  const form = Math.min(CONDITION.formMax, Math.abs(rng.normal(0, spread)));
  return { energy: 1, confidence: CONDITION.startConfidence, form, blunders: 0 };
}

export function validateCondition(condition) {
  const errors = [];
  if (!condition) return ['kondisi tidak ada'];
  for (const key of ['energy', 'confidence']) {
    const v = condition[key];
    if (!Number.isFinite(v) || v < 0 || v > 1) errors.push(`${key} di luar 0–1 (${v})`);
  }
  if (!(condition.form >= 0 && condition.form <= CONDITION.formMax)) errors.push(`form tidak valid (${condition.form})`);
  if (!Number.isInteger(condition.blunders) || condition.blunders < 0) errors.push('blunders tidak valid');
  return errors;
}

// Tenaga setelah satu langkah gerak dengan laju `speed`.
export function drainEnergy(player, speed, dt) {
  if (!(dt > 0)) throw new RangeError(`drainEnergy: dt tidak valid ${dt}`);
  const { energy } = player.condition;
  const fraction = Math.min(1, speed / player.profile.maxSpeed);
  const factor = lerpByStat(CONDITION.drainFactor, player.skills.stamina);
  let next = energy - dt * factor * (CONDITION.baseDrainPerSecond + CONDITION.sprintDrainPerSecond * fraction ** 3);
  if (fraction < CONDITION.slowSpeedFraction) next += dt * CONDITION.recoveryPerSecond;
  return clamp01(next);
}

// Konteks pertandingan untuk satu pemain: { trailing, minute, pressured, bigChance }.
function fatigueAmount(player, context) {
  const tired = Math.max(0, 1 - player.condition.energy - CONDITION.fatigueFreeZone);
  const fighting = context.trailing || context.minute >= CONDITION.lateGameMinute;
  if (!fighting) return tired;
  const shield = CONDITION.determinationShield * normalizeStat(player.skills.determinasi);
  return tired * (1 - shield);
}

// Pengali besar blunder (≥ 1): gabungan lelah, percaya diri, form, dan tekanan, dibatasi.
export function blunderScale(player, context = {}) {
  const c = player.condition;
  const composure = normalizeStat(player.skills.ketenangan);
  let penalty =
    fatigueAmount(player, context) * CONDITION.fatigueBlunder +
    (1 - c.confidence) * CONDITION.confidenceBlunder +
    c.form;
  if (context.pressured) penalty += (1 - composure) * CONDITION.pressureBlunder;
  if (context.bigChance) penalty += (1 - composure) * CONDITION.bigChanceBlunder;
  return 1 + Math.min(CONDITION.maxBlunderPenalty, Math.max(0, penalty));
}

// Pengali laju & percepatan (≤ 1) karena lelah.
export function physicalScale(player, context = {}) {
  const penalty = fatigueAmount(player, context) * CONDITION.fatiguePhysical;
  return 1 - Math.min(CONDITION.maxPhysicalPenalty, penalty);
}

// Profil gerak setelah dikurangi kelelahan.
export function effectiveProfile(player, context = {}) {
  const scale = physicalScale(player, context);
  if (scale === 1) return player.profile;
  return { ...player.profile, maxSpeed: player.profile.maxSpeed * scale, maxAccel: player.profile.maxAccel * scale };
}

// Ragu: bobot operan ke depan mengecil saat percaya diri di bawah titik awal.
export function progressWeightScale(player) {
  const ratio = Math.min(1, player.condition.confidence / CONDITION.startConfidence);
  return CONDITION.hesitantProgressFloor + (1 - CONDITION.hesitantProgressFloor) * ratio;
}

// Pengali ambang tembak dari Egoisme (< 1 = lebih cepat menembak).
export function shotThresholdScale(player) {
  return lerpByStat(CONDITION.egoShotThreshold, player.skills.egoisme);
}

// Kondisi setelah sebuah peristiwa (sukses atau blunder).
export function applyConfidenceEvent(condition, skills, event) {
  const delta = CONFIDENCE_EVENTS[event];
  if (delta === undefined) throw new RangeError(`applyConfidenceEvent: peristiwa tidak dikenal "${event}"`);
  const sensitivity = delta < 0 ? lerpByStat(CONDITION.lossSensitivity, skills.stabilitasMental) : 1;
  return {
    ...condition,
    confidence: clamp01(condition.confidence + delta * sensitivity),
    blunders: condition.blunders + (BLUNDER_EVENTS.includes(event) ? 1 : 0),
  };
}

// Kepercayaan diri perlahan kembali ke titik awal.
export function driftConfidence(condition, dt) {
  const target = CONDITION.startConfidence;
  const step = CONDITION.confidenceDriftPerSecond * dt;
  const c = condition.confidence;
  const next = c < target ? Math.min(target, c + step) : Math.max(target, c - step);
  return next === c ? condition : { ...condition, confidence: next };
}

export function recoverAtHalftime(condition) {
  return { ...condition, energy: clamp01(condition.energy + CONDITION.halftimeRecovery) };
}
