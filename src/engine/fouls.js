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
  // Di kotak penalti sendiri bek jauh lebih hati-hati (satu kesalahan = penalti). Uji 29 Okt:
  // tanpa ini 1,4 penalti per laga (sepak bola nyata ~0,3). Pengali dari Keputusan 1 … 20.
  boxAttempt: Object.freeze({ low: 0.6, high: 0.4 }),
  boxFoul: Object.freeze({ low: 0.4, high: 0.15 }),
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

// Pengali peluang mencoba tekel di kotak penalti sendiri (< 1 = lebih menahan diri).
export function boxAttemptScale(tackler) {
  return lerp(FOUL.boxAttempt, normalizeStat(tackler.skills.keputusan));
}

// ctx: { won, fromBehind, trailingLate, inOwnBox }
export function foulChance(tackler, ctx) {
  const s = tackler.skills;
  let chance = ctx.won ? FOUL.wonBase : FOUL.beatenBase;
  chance *= lerp(FOUL.recklessness, normalizeStat(s.kecerobohan));
  chance *= 1 + FOUL.agitationFoul * tackler.discipline.agitation * normalizeStat(s.temperamen);
  if (ctx.fromBehind) chance *= FOUL.fromBehind;
  const tired = Math.max(0, 1 - tackler.condition.energy - 0.3);
  chance *= 1 + FOUL.fatigueFoul * tired;
  if (ctx.trailingLate) chance *= FOUL.trailingLate;
  if (ctx.inOwnBox) chance *= lerp(FOUL.boxFoul, normalizeStat(s.keputusan));
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
  const lenient = tackler.discipline.yellows > 0 ? RED.secondYellowLeniency : 1;
  return clamp01(base * severity * lenient * lerp(CARD.strictness, normalizeStat(referee.skills.ketegasan)));
}

// ---- Kartu merah (tahap 7c) ----------------------------------------------------
// Patokan liga besar Eropa: ~0,1–0,2 kartu merah per laga (sekitar sepertiga dari kuning kedua).
export const RED = Object.freeze({
  // Wasit ragu memberi kuning kedua (pelanggaran yang sama untuk pemain berkartu lebih jarang
  // dikartu) — fenomena nyata, sekaligus menahan angka kuning kedua.
  secondYellowLeniency: 0.35,
  // Menggagalkan peluang gol (DOGSO): pemain terakhir melanggar penyerang yang menuju gawang,
  // di luar kotak penalti (di dalam kotak: penalti + kuning).
  dogsoGoalDistance: 36, // meter dari gawang
  dogso: Object.freeze({ low: 0.5, high: 0.9 }), // menurut Ketegasan wasit
  // Pelanggaran sangat keras (serious foul play): jarang, naik dengan Kecerobohan, emosi, dari belakang.
  seriousBase: 0.0015,
  seriousFromBehind: 2,
  seriousAgitation: 3,
  // Tindakan kekerasan saat pertikaian (pemicu yang sangat panas).
  violentBase: 0.07,
});

// Pelanggaran ini menggagalkan peluang gol yang jelas?
//   breakaway: penyerang sudah lolos sendirian (attack.js isBreakaway).
export function isDogso(tackler, holder, players, inBox, breakaway = false) {
  if (inBox) return false;
  const goal = { x: holder.attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  if (distance(holder, goal) > RED.dogsoGoalDistance) return false;
  return breakaway || isLastMan(tackler, holder, players);
}

// Peluang kartu merah langsung untuk satu pelanggaran yang dilihat wasit.
//   ctx: { dogso, fromBehind }
export function straightRedChance(referee, tackler, ctx) {
  const strict = normalizeStat(referee.skills.ketegasan);
  if (ctx.dogso) return clamp01(lerp(RED.dogso, strict));
  const s = tackler.skills;
  let chance = RED.seriousBase * lerp(FOUL.recklessness, normalizeStat(s.kecerobohan));
  chance *= 1 + RED.seriousAgitation * tackler.discipline.agitation * normalizeStat(s.temperamen);
  if (ctx.fromBehind) chance *= RED.seriousFromBehind;
  return clamp01(chance * lerp(CARD.strictness, strict));
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

// ---- Jeda setelah peluit: protes & pertikaian (tahap 7b-2, 29 Okt) ---------
//
// Setelah pelanggaran (atau offside) permainan berhenti sejenak. Di jeda itu:
//   PROTES     : pemain tim yang dihukum, dekat wasit, Temperamen tinggi & Ketenangan
//                rendah & sedang panas → mendatangi wasit; wasit tegas bisa memberi kuning.
//   PERTIKAIAN : setelah pelanggaran keras, korban yang emosional mendorong pelaku;
//                beberapa rekan dari kedua tim berkumpul; pemicu bisa dikartu kuning;
//                semua yang terlibat jadi lebih panas (efek beberapa menit).
export const INCIDENT = Object.freeze({
  // Lama drama (tick) SETELAH semua yang terlibat sampai di tempatnya (masukan 29 Okt:
  // drama terlalu singkat untuk dinikmati). Menunggu kedatangan paling lama arrivalCap.
  baseTicks: 15, // wasit meniup & menunjuk
  cardTicks: 20, // wasit menunjukkan kartu
  protestTicks: 35,
  scuffleTicks: 55,
  redTicks: 40, // tambahan saat ada kartu merah (wasit, protes, pemain keluar)
  maxHoldTicks: 170,
  arrivalCap: 50,
  // Protes: rekan pelaku di dekat wasit/kejadian mengerubungi wasit; lawan ikut berdebat.
  protestRadius: 20,
  protestBase: 0.2,
  bookedProtest: 0.45, // pengali protes bagi pemain yang sudah dikartu kuning
  protestCardBoost: 1.8, // protes lebih sering bila dikartu / penalti
  maxProtesters: 3,
  arguerChance: 0.35, // per pemain tim lawan (× urge × 3), bila ada yang protes
  maxArguers: 2,
  // Wasit paling banyak mengartu SATU pemrotes (yang paling keras).
  dissentYellow: Object.freeze({ low: 0.04, high: 0.18 }), // menurut Ketegasan wasit
  // Pertikaian: setelah pelanggaran keras (kartu atau dari belakang).
  scuffleBase: 0.1,
  scuffleJoinRadius: 18,
  scuffleMaxJoin: 3, // per tim, selain korban & pelaku
  scuffleInstigatorYellow: Object.freeze({ low: 0.2, high: 0.55 }),
  scuffleOffenderYellow: Object.freeze({ low: 0.05, high: 0.25 }),
  scuffleAgitation: 0.35,
  protestAgitation: 0.08,
});

const t01 = (v) => normalizeStat(v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Kecenderungan protes satu pemain (0–1), sebelum dikali peluang dasar.
export function protestUrge(player) {
  const s = player.skills;
  return t01(s.temperamen) * (1 - 0.7 * t01(s.ketenangan)) * (0.6 + player.discipline.agitation);
}

// Kecenderungan korban memulai pertikaian (0–1), sebelum dikali peluang dasar.
export function scuffleUrge(fouled) {
  return t01(fouled.skills.temperamen) * (0.5 + fouled.discipline.agitation);
}

// Putuskan insiden setelah peluit. Murni: hanya memakai rng & data masuk.
//   ctx: { kind: 'foul' | 'offside', offender, fouled, card, hard, penalty, spot, referee, players }
// Mengembalikan { protesters, arguers, dissent, scuffle: { ids, instigatorId, booked } | null, ticks }.
export function resolveIncident(rng, ctx) {
  const { kind, offender, fouled, card, hard, penalty, spot, referee, players } = ctx;
  const strict = t01(referee.skills.ketegasan);
  const lerpRow = (row) => row.low + (row.high - row.low) * strict;
  let ticks = INCIDENT.baseTicks + (card ? INCIDENT.cardTicks : 0);
  const close = (p) => p.role !== 'GK' && (dist(p, spot) <= INCIDENT.protestRadius || dist(p, referee) <= INCIDENT.protestRadius);

  // Protes oleh tim yang dihukum (pelaku termasuk). Offside: tim yang terkena offside.
  const protesters = [];
  // Pelaku yang baru saja dikartu juga dihitung "sudah berkartu".
  const isBooked = (p) => p.discipline.yellows > 0 || (card && p.id === offender.id);
  const boost = card || penalty ? INCIDENT.protestCardBoost : 1;
  const nearby = players
    .filter((p) => p.teamId === offender.teamId && close(p))
    .sort((a, b) => protestUrge(b) - protestUrge(a) || a.id.localeCompare(b.id));
  for (const p of nearby) {
    if (protesters.length >= INCIDENT.maxProtesters) break;
    // Pemain berkartu kuning lebih menahan diri (takut kuning kedua).
    const wary = isBooked(p) ? INCIDENT.bookedProtest : 1;
    if (rng.chance(Math.min(0.9, INCIDENT.protestBase * boost * wary * protestUrge(p) * 3))) protesters.push(p.id);
  }
  // Lawan ikut berdebat membela keputusan (hanya bila ada yang protes).
  const arguers = [];
  if (protesters.length > 0) {
    const others = players
      .filter((p) => p.teamId !== offender.teamId && close(p))
      .sort((a, b) => protestUrge(b) - protestUrge(a) || a.id.localeCompare(b.id));
    for (const p of others) {
      if (arguers.length >= INCIDENT.maxArguers) break;
      if (rng.chance(Math.min(0.9, INCIDENT.arguerChance * protestUrge(p) * 3))) arguers.push(p.id);
    }
  }
  // Kartu protes: paling banyak satu, untuk pemrotes paling keras.
  const dissent = [];
  if (protesters.length > 0) {
    const loudest = players.find((p) => p.id === protesters[0]);
    const lenient = isBooked(loudest) ? RED.secondYellowLeniency : 1;
    if (rng.chance(lerpRow(INCIDENT.dissentYellow) * lenient * (0.5 + protestUrge(loudest)))) dissent.push(loudest.id);
    ticks += INCIDENT.protestTicks;
  }

  // Pertikaian: hanya setelah pelanggaran keras.
  let scuffle = null;
  if (kind === 'foul' && hard && fouled && rng.chance(Math.min(0.8, INCIDENT.scuffleBase * scuffleUrge(fouled) * 2.5))) {
    const joiners = (teamId, exclude) =>
      players
        .filter((p) => p.teamId === teamId && p.role !== 'GK' && !exclude.includes(p.id) && dist(p, spot) <= INCIDENT.scuffleJoinRadius)
        .sort((a, b) => dist(a, spot) - dist(b, spot) || a.id.localeCompare(b.id))
        .slice(0, INCIDENT.scuffleMaxJoin)
        .map((p) => p.id);
    const core = [fouled.id, offender.id];
    const ids = [...core, ...joiners(fouled.teamId, core), ...joiners(offender.teamId, core)];
    const booked = [];
    const lenient = (p) => (p.discipline.yellows > 0 ? RED.secondYellowLeniency : 1);
    // Tindakan kekerasan: pemicu yang sangat panas bisa langsung dikartu merah.
    const violent = rng.chance(
      clamp01(RED.violentBase * strict * scuffleUrge(fouled) * fouled.discipline.agitation * 2),
    );
    const sentOff = violent ? [fouled.id] : [];
    if (!violent && rng.chance(lerpRow(INCIDENT.scuffleInstigatorYellow) * lenient(fouled))) booked.push(fouled.id);
    if (rng.chance(lerpRow(INCIDENT.scuffleOffenderYellow) * lenient(offender))) booked.push(offender.id);
    scuffle = { ids, instigatorId: fouled.id, booked, sentOff };
    ticks += INCIDENT.scuffleTicks;
  }
  // Pemain pertikaian tidak sekaligus jadi pemrotes/pendebat.
  const inScuffle = new Set(scuffle?.ids ?? []);
  const keep = (ids) => ids.filter((id) => !inScuffle.has(id));
  const finalProtesters = keep(protesters);
  return {
    protesters: finalProtesters,
    arguers: keep(arguers),
    dissent: dissent.filter((id) => finalProtesters.includes(id)),
    scuffle,
    ticks: Math.min(INCIDENT.maxHoldTicks, ticks),
  };
}
