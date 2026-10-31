// Lapisan KEPUTUSAN untuk pemain yang tidak sedang mengurus bola:
// menentukan posisi jangkar. Jangkar = posisi formasi yang ikut bergeser
// mengikuti bola, sehingga tim bergerak sebagai satu unit
// (docs/dokumen-arah-game.md, logika gerak prinsip 2).
//
// Bentuknya bergantung pada fase:
//   attack  : tim menguasai bola → melebar dan maju
//   defend  : lawan menguasai bola → merapat dan mundur
//   neutral : bola bebas, belum jelas milik siapa
//
// Semua hitungan dilakukan dalam "bingkai tim", yaitu seolah-olah tim
// selalu menyerang ke kanan. Hasilnya lalu dicerminkan untuk tim tamu.

import { PITCH } from './pitch.js';

export const PHASES = Object.freeze({
  neutral: { push: 0, width: 1.0, lateralPull: 0.3 },
  // width 1,35 (29 Okt): pemain sayap melebar hampir ke garis samping saat menguasai bola (dulu ~5–10 m
  // dari garis; bola hampir tidak pernah di pinggir lapangan → lemparan sangat jarang).
  attack: { push: 6, width: 1.35, lateralPull: 0.15 },
  defend: { push: -4, width: 0.8, lateralPull: 0.4 },
});

// Seberapa jauh blok tim maju/mundur mengikuti bola di sumbu panjang.
const BLOCK_SHIFT = 0.55;

// Formasi di formations.js adalah posisi KICK-OFF: semua pemain rapat di
// separuh lapangan sendiri. Saat bermain, tim direntangkan menjadi blok
// yang lebih panjang: garis bek di BACK_LINE_AT_CENTER meter dari gawang
// sendiri (saat bola di tengah), dan jarak antarlini dikali LINE_STRETCH.
const BACK_LINE_AT_CENTER = 28; // meter
const LINE_STRETCH = 1.4;

const FIELD_MARGIN = 2; // meter dari garis samping
const FRONT_MARGIN = 6; // pemain tidak berdiri lebih dekat dari ini ke garis gawang lawan
const MIN_OUTFIELD_DEPTH = 6; // garis bek paling dalam tidak mundur melewati ini

// Saat bertahan dalam, tim merapat tapi lini-lininya tetap terpisah.
// Setiap pemain punya batas mundur sendiri: makin maju posnya di formasi,
// makin maju pula batasnya. LINE_SPACING_KEPT = bagian jarak antarlini
// yang tetap dipertahankan (1 = tidak merapat sama sekali, 0 = menumpuk).
const DEEPEST_LINE_DEPTH = 0.17; // kedalaman slot bek tengah di formasi
const LINE_SPACING_KEPT = 0.6;

// Kiper: maju sedikit saat bola jauh, tetap di depan gawang.
const KEEPER_BASE_DEPTH = 2;
const KEEPER_MAX_ADVANCE = 12;
const KEEPER_LATERAL_PULL = 0.15;
const KEEPER_LATERAL_LIMIT = 5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toTeamFrame(point, attacksRight) {
  if (attacksRight) return { x: point.x, y: point.y };
  return { x: PITCH.length - point.x, y: PITCH.width - point.y };
}

// Pencerminan bersifat simetris, jadi fungsi yang sama dipakai bolak-balik.
const fromTeamFrame = toTeamFrame;

// mentality (opsional, mentality.js): { blockShift (meter, + = maju), compact (pengali lebar saat bertahan) }.
export function computeAnchor(player, ball, attacksRight, phase = 'neutral', mentality = null) {
  if (!player.slot) throw new Error(`computeAnchor: pemain ${player.id} tidak punya slot`);
  const shape = PHASES[phase];
  if (!shape) throw new RangeError(`computeAnchor: fase "${phase}" tidak dikenal`);

  const b = toTeamFrame(ball, attacksRight);
  const depthFromBackLine = Math.max(0, player.slot.depth - DEEPEST_LINE_DEPTH) * PITCH.length;
  const baseX = BACK_LINE_AT_CENTER + depthFromBackLine * LINE_STRETCH;
  const baseY = player.slot.lane * PITCH.width;
  const midY = PITCH.width / 2;

  let x;
  let y;

  if (player.role === 'GK') {
    x = KEEPER_BASE_DEPTH + (b.x / PITCH.length) * KEEPER_MAX_ADVANCE;
    y = clamp(
      midY + (b.y - midY) * KEEPER_LATERAL_PULL,
      midY - KEEPER_LATERAL_LIMIT,
      midY + KEEPER_LATERAL_LIMIT,
    );
  } else {
    const spacingFromDeepestLine = Math.max(0, player.slot.depth - DEEPEST_LINE_DEPTH) * PITCH.length;
    const retreatLimit = MIN_OUTFIELD_DEPTH + spacingFromDeepestLine * LINE_SPACING_KEPT;

    // Blok mundur hanya saat tidak menguasai bola; saat menyerang tim tetap naik.
    const raw = mentality?.blockShift ?? 0;
    // defendOnly (taktik empat kotak): garis bek hanya berlaku saat tanpa bola.
    const shift =
      phase === 'attack' ? (mentality?.defendOnly ? 0 : Math.max(0, raw)) : mentality?.attackOnly ? 0 : raw;
    const attackWidth = mentality?.widthAttack ?? shape.width;
    const width = phase === 'defend' ? shape.width * (mentality?.compact ?? 1) : phase === 'attack' ? attackWidth : shape.width;
    x = baseX + (b.x - PITCH.length / 2) * BLOCK_SHIFT + shape.push + shift;
    y = midY + (baseY - midY) * width;
    y += (b.y - y) * shape.lateralPull;
    x = clamp(x, retreatLimit, PITCH.length - FRONT_MARGIN);
    y = clamp(y, FIELD_MARGIN, PITCH.width - FIELD_MARGIN);
  }

  return fromTeamFrame({ x, y }, attacksRight);
}
