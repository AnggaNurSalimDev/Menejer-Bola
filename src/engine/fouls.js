// Pelanggaran & kartu kuning (tahap 7b-1, 29 Okt).
//
//   peluang pelanggaran (per tekel) = dasar × Kecerobohan × emosi × dari belakang × lelah × situasi
//                                     × kehati-hatian setelah kartu kuning
//   Kecerobohan : selalu berlaku (salah timing, tekel asal-asalan)
//   Temperamen  : lewat "emosi" (agitation 0–1) yang naik saat dilanggar, dikartu, kebobolan,
//                 tertinggal — dan perlahan reda
//   setelah kuning: menahan diri sesuai kendali diri (Ketenangan + Keputusan), tetapi
//                 Kecerobohan tinggi & emosi panas mengikis kehati-hatian itu
//
// Wasit memutuskan: terlihat? (jarak + Ketegasan) → keuntungan atau peluit → kartu?
// SEMUA angka pelanggaran ada di file ini.

import { normalizeStat } from './skill.js';
import { PITCH, distance, forwardOf } from './pitch.js';

export const FOUL = Object.freeze({
  // Dasar: tekel yang KALAH duel jauh lebih sering jadi pelanggaran daripada yang menang.
  beatenBase: 0.55,
  wonBase: 0.08,
  // Kecerobohan 1 … 20 → pengali.
  recklessness: Object.freeze({ low: 0.5, high: 1.7 }),
  // Emosi panas: tambahan pengali × agitation × (Temperamen ternormalkan).
  agitationFoul: 0.8,
  fromBehind: 1.6,
  fatigueFoul: 0.6, // × kelelahan (1 − tenaga) di atas 0,3
  trailingLate: 1.25, // tim tertinggal setelah menit 70
  maxChance: 0.9,
  // Setelah kuning: pengali GABUNGAN (lebih jarang mencoba tekel × lebih jarang melanggar) dari
  // kendali diri (Ketenangan+Keputusan). Akar kuadratnya dipakai di masing-masing tahap.
  bookedCaution: Object.freeze({ low: 0.85, high: 0.4 }),
  // Kecerobohan & emosi mengikis kehati-hatian (0 = tetap hati-hati, 1 = lupa sudah dikartu).
  cautionErosion: 0.7,
});

export const CARD = Object.freeze({
  recklessYellow: 0.12, // pelanggaran biasa yang keras
  fromBehindYellow: 0.28,
  tacticalYellow: 0.45, // menghentikan serangan berbahaya / pemain terakhir
  // Ketegasan wasit 1 … 20 → pengali peluang kartu.
  strictness: Object.freeze({ low: 0.6, high: 1.4 }),
});

export const REFEREE_VIEW = Object.freeze({
  clearDistance: 12, // meter: dalam jarak ini wasit hampir pasti melihat
  fadePerMeter: 0.012, // peluang terlihat turun per meter setelah itu
  minSee: 0.45,
  // Pelanggaran ringan (tanpa kartu) baru ditiup bila wasit cukup tegas.
  softCall: Object.freeze({ low: 0.6, high: 0.95 }),
});

export const ADVANTAGE = Object.freeze({
  minDepth: PITCH.length / 2, // hanya di separuh lawan
  freeRadius: 4, // meter: tidak ada lawan lain sedekat ini
  // Dekat gawang lawan, tendangan bebas lebih berharga daripada keuntungan: wasit meniup.
  dangerousFreeKickDistance: 30,
});

export const AGITATION = Object.freeze({
  fouled: 0.25, // dilanggar (× Temperamen)
  booked: 0.2,
  conceded: 0.12, // tim kebobolan (× Temperamen)
  decayPerSecond: 0.008,
});

const lerp = (row, t) => row.low + (row.high - row.low) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function initialDiscipline() {
  return { yellows: 0, fouls: 0, agitation: 0 };
}

export function validateDiscipline(d) {
  if (!d) return ['disiplin tidak ada'];
  const errors = [];
  if (!Number.isInteger(d.yellows) || d.yellows < 0 || d.yellows > 1) errors.push(`kartu kuning tidak valid (${d.yellows})`);
  if (!Number.isInteger(d.fouls) || d.fouls < 0) errors.push('jumlah pelanggaran tidak valid');
  if (!(d.agitation >= 0 && d.agitation <= 1)) errors.push(`emosi di luar 0–1 (${d.agitation})`);
  return errors;
}

function selfControl(player) {
  return 0.5 * normalizeStat(player.skills.ketenangan) + 0.5 * normalizeStat(player.skills.keputusan);
}

// Seberapa "lupa" pemain bahwa ia sudah dikartu: Kecerobohan & emosi panas.
// Hanya Kecerobohan di ATAS rata-rata yang mengikis kehati-hatian (uji 29 Okt: memakai nilai
// mentah membuat pemain rata-rata pun hampir tidak berhati-hati setelah dikartu).
function erosion(player) {
  const reckless = clamp01((normalizeStat(player.skills.kecerobohan) - 0.5) / 0.5);
  const hot = player.discipline.agitation * normalizeStat(player.skills.temperamen);
  return clamp01(FOUL.cautionErosion * Math.max(reckless, hot));
}

// Pengali kehati-hatian setelah kartu kuning (1 = tidak dikartu / lupa sama sekali).
export function cautionScale(player) {
  if (player.discipline.yellows === 0) return 1;
  const careful = lerp(FOUL.bookedCaution, selfControl(player));
  return Math.sqrt(careful + (1 - careful) * erosion(player));
}

// Penekan berada di belakang pemegang bola (dilihat dari arah serang pemegang bola).
export function isFromBehind(tackler, holder) {
  const d = distance(tackler, holder);
  if (d === 0) return false;
  const forward = holder.attacksRight ? 1 : -1;
  return ((tackler.x - holder.x) * forward) / d < -0.3;
}

// Pemain terakhir: tidak ada rekan lapangan penekan yang lebih dekat ke gawangnya sendiri
// daripada pemegang bola (menggagalkan peluang).
export function isLastMan(tackler, holder, players) {
  const ownGoalDepth = (p) => forwardOf(p, holder.attacksRight);
  const holderDepth = ownGoalDepth(holder);
  return !players.some(
    (p) => p.teamId === tackler.teamId && p.id !== tackler.id && p.role !== 'GK' && ownGoalDepth(p) > holderDepth,
  );
}

// ctx: { won, fromBehind, trailingLate }
export function foulChance(tackler, ctx) {
  const s = tackler.skills;
  let chance = ctx.won ? FOUL.wonBase : FOUL.beatenBase;
  chance *= lerp(FOUL.recklessness, normalizeStat(s.kecerobohan));
  chance *= 1 + FOUL.agitationFoul * tackler.discipline.agitation * normalizeStat(s.temperamen);
  if (ctx.fromBehind) chance *= FOUL.fromBehind;
  const tired = Math.max(0, 1 - tackler.condition.energy - 0.3);
  chance *= 1 + FOUL.fatigueFoul * tired;
  if (ctx.trailingLate) chance *= FOUL.trailingLate;
  chance *= cautionScale(tackler);
  return Math.min(FOUL.maxChance, Math.max(0, chance));
}

// Peluang wasit meniup pelanggaran ini (melihat × cukup tegas untuk pelanggaran ringan).
export function callChance(referee, spot, cardWorthy) {
  const d = distance(referee, spot);
  const see = Math.max(REFEREE_VIEW.minSee, Math.min(1, 1 - Math.max(0, d - REFEREE_VIEW.clearDistance) * REFEREE_VIEW.fadePerMeter));
  const willing = cardWorthy ? 1 : lerp(REFEREE_VIEW.softCall, normalizeStat(referee.skills.ketegasan));
  return see * willing;
}

// Peluang kartu kuning. kind: 'reckless' | 'fromBehind' | 'tactical'.
export function yellowChance(referee, kind, tackler) {
  const base = kind === 'tactical' ? CARD.tacticalYellow : kind === 'fromBehind' ? CARD.fromBehindYellow : CARD.recklessYellow;
  const severity = 0.7 + 0.6 * normalizeStat(tackler.skills.kecerobohan); // tekel ceroboh lebih keras
  return clamp01(base * severity * lerp(CARD.strictness, normalizeStat(referee.skills.ketegasan)));
}

// Keuntungan: tim yang dilanggar masih menguasai bola di separuh lawan tanpa lawan LAIN
// (selain si pelanggar yang baru saja terhuyung) menempel.
export function advantageApplies(holder, opponents, offenderId) {
  if (forwardOf(holder, holder.attacksRight) < ADVANTAGE.minDepth) return false;
  const goal = { x: holder.attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  if (distance(holder, goal) <= ADVANTAGE.dangerousFreeKickDistance) return false;
  return !opponents.some((o) => o.id !== offenderId && distance(o, holder) < ADVANTAGE.freeRadius);
}

export function raiseAgitation(discipline, skills, amount, scaleByTemper = true) {
  const scale = scaleByTemper ? 0.4 + 0.6 * normalizeStat(skills.temperamen) : 1;
  return { ...discipline, agitation: clamp01(discipline.agitation + amount * scale) };
}

export function calmDown(discipline, dt) {
  if (discipline.agitation === 0) return discipline;
  return { ...discipline, agitation: Math.max(0, discipline.agitation - AGITATION.decayPerSecond * dt) };
}
