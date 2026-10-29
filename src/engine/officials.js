// Perangkat pertandingan (tahap 7a, 28 Okt): wasit dan dua hakim garis.
//
//   wasit       : mengikuti bola dari samping, meniup peluit kick-off.
//                 Stat Ketegasan (1–20) dipakai di tahap 7b (pelanggaran & kartu).
//   hakim garis : satu per separuh lapangan, di garis samping yang berseberangan,
//                 berlari sejajar garis offside. Stat Ketelitian (1–20).
//
// Hakim garis BISA SALAH (tanpa VAR, keputusan 28 Okt), tetapi hanya pada kejadian
// tipis: makin dekat pemain ke garis, dan makin tidak sejajar hakim garis dengan
// garis offside, makin besar peluang salah — ke dua arah (offside lolos, atau
// bendera untuk pemain yang sebenarnya sah).

import { PITCH, clampToPitch, forwardOf } from './pitch.js';
import { stepBody } from './movement.js';
import { normalizeStat } from './skill.js';
import { STAT_MIN, STAT_MAX, clampStat } from './stats.js';

export const OFFICIAL_PROFILE = Object.freeze({ maxSpeed: 7.2, maxAccel: 3.5, turnAccel: 3.0, reaction: 0.3 });

export const REFEREE = Object.freeze({
  lateral: 10, // meter dari bola ke arah tengah lebar lapangan
  lengthwise: 6, // meter dari bola ke arah tengah panjang lapangan
  kickoffSpot: Object.freeze({ x: PITCH.length / 2 - 3, y: PITCH.width / 2 + 12 }),
});

export const ASSISTANT = Object.freeze({
  touchlineOffset: 1.5, // meter di luar garis samping
  maxError: 1.5, // meter: hanya pemain sedekat ini ke garis yang bisa salah dinilai
  missMax: 0.35, // peluang offside lolos tepat di garis (selisih ~0)
  missScale: 0.35, // meter: peluang lolos mengecil cepat makin jauh dari garis
  falseMax: 0.1, // peluang bendera salah untuk pemain sah tepat di garis
  falseScale: 0.3,
  misalignPerMeter: 0.2, // tiap meter tidak sejajar menambah 20% peluang salah
  misalignCap: 3,
  skill: Object.freeze({ worst: 1.5, best: 0.6 }), // pengali peluang salah: Ketelitian 1 … 20
});

// Peluang hakim garis MENGANGKAT BENDERA untuk satu pemain.
// margin: meter di depan titik acuan offside (positif = benar-benar offside).
export function flagChance({ margin, misalignment, ketelitian }) {
  if (!Number.isFinite(margin) || !(misalignment >= 0)) throw new RangeError('flagChance: input tidak valid');
  const skill = ASSISTANT.skill.worst + (ASSISTANT.skill.best - ASSISTANT.skill.worst) * normalizeStat(ketelitian);
  const align = Math.min(ASSISTANT.misalignCap, 1 + ASSISTANT.misalignPerMeter * misalignment);
  const factor = skill * align;
  if (margin > 0) {
    const miss = ASSISTANT.missMax * Math.exp(-margin / ASSISTANT.missScale) * factor;
    return Math.min(1, Math.max(0, 1 - miss));
  }
  if (-margin > ASSISTANT.maxError) return 0;
  const wrong = ASSISTANT.falseMax * Math.exp(margin / ASSISTANT.falseScale) * factor;
  return Math.min(1, Math.max(0, wrong));
}

function officialStat(rng) {
  return clampStat(rng.normal(12, 3));
}

export function createOfficials(rng) {
  const body = (id, x, y, extra) => ({ id, x, y, vx: 0, vy: 0, profile: OFFICIAL_PROFILE, ...extra });
  return {
    referee: body('wasit', REFEREE.kickoffSpot.x, REFEREE.kickoffSpot.y, { skills: { ketegasan: officialStat(rng) } }),
    // Hakim garis 1: separuh kanan, garis samping atas. Hakim garis 2: separuh kiri, bawah.
    assistants: [
      body('hakim-1', PITCH.length * 0.75, -ASSISTANT.touchlineOffset, {
        half: 'right',
        skills: { ketelitian: officialStat(rng) },
      }),
      body('hakim-2', PITCH.length * 0.25, PITCH.width + ASSISTANT.touchlineOffset, {
        half: 'left',
        skills: { ketelitian: officialStat(rng) },
      }),
    ],
  };
}

// Hakim garis yang menjaga gawang tujuan tim penyerang ini.
export function assistantFor(officials, attacksRight) {
  const half = attacksRight ? 'right' : 'left';
  const a = officials.assistants.find((x) => x.half === half);
  if (!a) throw new Error(`assistantFor: tidak ada hakim garis untuk separuh ${half}`);
  return a;
}

// Titik acuan offside (dalam koordinat x) bagi tim yang menyerang ke arah attacksRight:
// garis bek kedua terakhir atau bola, mana yang lebih dekat ke gawang lawan.
export function offsideReferenceX(lineDepth, ball, attacksRight) {
  const depth = Math.max(lineDepth, forwardOf(ball, attacksRight), PITCH.length / 2);
  return attacksRight ? depth : PITCH.length - depth;
}

function refereeTarget(ball, pausing) {
  if (pausing) return REFEREE.kickoffSpot;
  const towardMiddleY = ball.y < PITCH.width / 2 ? 1 : -1;
  const towardMiddleX = ball.x < PITCH.length / 2 ? 1 : -1;
  return clampToPitch(
    { x: ball.x + towardMiddleX * REFEREE.lengthwise, y: ball.y + towardMiddleY * REFEREE.lateral },
    2,
  );
}

function assistantTarget(assistant, referenceXByHalf) {
  const half = assistant.half;
  const minX = half === 'right' ? PITCH.length / 2 : 0;
  const maxX = half === 'right' ? PITCH.length : PITCH.length / 2;
  const x = Math.min(maxX, Math.max(minX, referenceXByHalf[half]));
  return { x, y: assistant.y };
}

// Satu langkah gerak perangkat pertandingan.
// referenceXByHalf: { right, left } = titik acuan offside di tiap separuh.
// refereeOverride: titik tuju wasit (misalnya mendatangi pelaku untuk kartu), atau null.
export function stepOfficials(officials, ball, referenceXByHalf, pausing, dt, refereeOverride = null) {
  const move = (o, target) => ({ ...o, ...stepBody(o, target, dt) });
  return {
    referee: move(officials.referee, refereeOverride ?? refereeTarget(ball, pausing)),
    assistants: officials.assistants.map((a) => {
      const next = move(a, assistantTarget(a, referenceXByHalf));
      // Hakim garis tetap di garis sampingnya.
      return { ...next, y: a.y, vy: 0 };
    }),
  };
}

export function validateOfficials(officials) {
  const errors = [];
  if (!officials?.referee || !Array.isArray(officials.assistants)) return ['perangkat pertandingan tidak ada'];
  const all = [officials.referee, ...officials.assistants];
  for (const o of all) {
    for (const k of ['x', 'y', 'vx', 'vy']) if (!Number.isFinite(o[k])) errors.push(`${o.id}: ${k} bukan angka`);
  }
  const k = officials.referee.skills?.ketegasan;
  if (!Number.isInteger(k) || k < STAT_MIN || k > STAT_MAX) errors.push('wasit: Ketegasan tidak valid');
  if (officials.assistants.length !== 2) errors.push(`harus ada 2 hakim garis, ada ${officials.assistants.length}`);
  const halves = officials.assistants.map((a) => a.half).sort().join(',');
  if (halves !== 'left,right') errors.push(`hakim garis harus menjaga separuh kiri & kanan, dapat ${halves}`);
  for (const a of officials.assistants) {
    const t = a.skills?.ketelitian;
    if (!Number.isInteger(t) || t < STAT_MIN || t > STAT_MAX) errors.push(`${a.id}: Ketelitian tidak valid`);
    if (a.y > -0.5 && a.y < PITCH.width + 0.5) errors.push(`${a.id}: masuk ke lapangan`);
    const inHalf = a.half === 'right' ? a.x >= PITCH.length / 2 - 0.5 : a.x <= PITCH.length / 2 + 0.5;
    if (!inHalf) errors.push(`${a.id}: keluar dari separuhnya`);
  }
  return errors;
}
