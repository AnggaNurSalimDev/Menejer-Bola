// Lapisan KEPUTUSAN (versi tahap 2): menentukan posisi jangkar pemain.
// Jangkar = posisi formasi yang ikut bergeser mengikuti bola,
// sehingga tim bergerak sebagai satu unit
// (docs/dokumen-arah-game.md, logika gerak prinsip 2).
//
// Semua hitungan dilakukan dalam "bingkai tim", yaitu seolah-olah tim
// selalu menyerang ke kanan. Hasilnya lalu dicerminkan untuk tim tamu.

import { PITCH } from './pitch.js';

// Seberapa jauh blok tim maju/mundur mengikuti bola di sumbu panjang.
const BLOCK_SHIFT = 0.55;
// Seberapa kuat pemain condong ke sisi bola di sumbu lebar.
const LATERAL_PULL = 0.3;

const FIELD_MARGIN = 2; // meter dari garis
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

export function computeAnchor(player, ball, attacksRight) {
  if (!player.slot) throw new Error(`computeAnchor: pemain ${player.id} tidak punya slot`);

  const b = toTeamFrame(ball, attacksRight);
  const baseX = player.slot.depth * PITCH.length;
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

    x = baseX + (b.x - PITCH.length / 2) * BLOCK_SHIFT;
    y = baseY + (b.y - baseY) * LATERAL_PULL;
    x = clamp(x, retreatLimit, PITCH.length - FIELD_MARGIN);
    y = clamp(y, FIELD_MARGIN, PITCH.width - FIELD_MARGIN);
  }

  return fromTeamFrame({ x, y }, attacksRight);
}
