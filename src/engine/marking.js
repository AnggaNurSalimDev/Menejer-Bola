// Penjagaan lawan saat bertahan (docs/dokumen-arah-game.md, logika gerak
// prinsip 2: "tarikan ke lawan yang harus dijaga").
//
// Penjagaan zona: setiap pemain bertahan hanya menjaga lawan yang masuk
// ke sekitar posnya. Setiap lawan dijaga paling banyak satu pemain, dan
// pasangan terdekat dipasangkan lebih dulu.
//
// Titik jaga ada di sisi gawang sendiri dari lawan, supaya penjaga
// berdiri di antara lawan dan gawang.

import { PITCH, clampToPitch, distance, forwardOf } from './pitch.js';
import { blunder } from './skill.js';

const MAX_ALLOWED_PULL = 0.95;

const MARK_RADIUS = 12; // meter dari posisi penjaga
const GOAL_SIDE_OFFSET = 1.5; // meter

// Kekuatan tarikan ke lawan: makin dekat lawan ke gawang kita, makin ketat.
const MIN_PULL = 0.35;
const MAX_PULL = 0.85;
const TIGHT_ZONE = 60; // meter dari gawang sendiri; lebih jauh dari ini = tarikan minimum

// Tempel lawan (1 Nov, layer tanpa bola): pemain berinstruksi "tempel" menjaga SATU lawan ke mana pun ia
// pergi (lengket: tetap lawan yang sama selama masih ada), dari jarak lebih jauh dan lebih ketat.
// Harga nyatanya: lawan bisa menariknya keluar posisi, meninggalkan ruang di zonanya.
export const MAN_MARK = Object.freeze({ radius: 45, pull: 0.9 });

function markFor(defender, attacker, attacksRight, basePull) {
  const ownGoal = { x: attacksRight ? 0 : PITCH.length, y: PITCH.width / 2 };
  const toGoal = distance(attacker, ownGoal);
  const point = clampToPitch(
    toGoal > 0
      ? {
          x: attacker.x + ((ownGoal.x - attacker.x) / toGoal) * GOAL_SIDE_OFFSET,
          y: attacker.y + ((ownGoal.y - attacker.y) / toGoal) * GOAL_SIDE_OFFSET,
        }
      : attacker,
  );
  // Stat Posisi: bek yang buruk menjaga lebih longgar (blunder tahap 5).
  const tightness = defender.skills ? blunder(defender, 'markingTightness') : 1;
  return { point, pull: Math.min(MAX_ALLOWED_PULL, basePull * tightness), attackerId: attacker.id };
}

// options.manMarkers: Set id pemain bertahan berinstruksi "tempel"; options.sticky: { defenderId: attackerId }
// dari tick sebelumnya; options.ownerId: pemegang bola (tidak ada di `attackers`); options.stickyOut: objek
// yang diisi pasangan tempel tick ini (disimpan engine di team.manMarks).
export function assignMarks(defenders, attackers, attacksRight, options = {}) {
  const { manMarkers = null, sticky = {}, ownerId = null, stickyOut = null } = options;
  const marks = new Map();
  const taken = new Set();

  if (manMarkers && manMarkers.size > 0) {
    const markers = defenders.filter((d) => manMarkers.has(d.id) && d.role !== 'GK').sort((a, b) => a.id.localeCompare(b.id));
    for (const defender of markers) {
      const previous = sticky[defender.id];
      // Lawan yang dijaga sedang memegang bola: urusan penekan; pasangan tetap disimpan.
      if (previous && previous === ownerId) {
        if (stickyOut) stickyOut[defender.id] = previous;
        continue;
      }
      let target = previous ? attackers.find((a) => a.id === previous && !taken.has(a.id)) : null;
      if (!target) {
        let best = null;
        for (const a of attackers) {
          if (taken.has(a.id)) continue;
          const d = distance(defender, a);
          if (d <= MAN_MARK.radius && (!best || d < best.d || (d === best.d && a.id < best.a.id))) best = { a, d };
        }
        target = best?.a ?? null;
      }
      if (!target) continue;
      taken.add(target.id);
      if (stickyOut) stickyOut[defender.id] = target.id;
      marks.set(defender.id, { ...markFor(defender, target, attacksRight, MAN_MARK.pull), man: true });
    }
  }

  const pairs = [];
  for (const defender of defenders) {
    if (defender.role === 'GK') continue;
    for (const attacker of attackers) {
      const d = distance(defender, attacker);
      if (d <= MARK_RADIUS) pairs.push({ defender, attacker, d });
    }
  }
  // Urutan tetap supaya deterministik.
  pairs.sort((a, b) => a.d - b.d || a.defender.id.localeCompare(b.defender.id) || a.attacker.id.localeCompare(b.attacker.id));

  for (const { defender, attacker } of pairs) {
    if (marks.has(defender.id) || taken.has(attacker.id)) continue;
    if (manMarkers?.has(defender.id)) continue; // penjaga orang tidak ikut penjagaan zona
    taken.add(attacker.id);
    // Jarak lawan dari garis gawang kita (0 = di garis gawang kita).
    const fromOurGoal = forwardOf(attacker, attacksRight);
    const closeness = 1 - Math.min(1, fromOurGoal / TIGHT_ZONE);
    marks.set(defender.id, markFor(defender, attacker, attacksRight, MIN_PULL + (MAX_PULL - MIN_PULL) * closeness));
  }
  return marks;
}

// Bek di garis belakang (CB/LB/RB) menjaga garis bersama: mereka hanya menggeser
// ke samping mengikuti lawan, tidak ikut maju-mundur, supaya garis tetap lurus
// dan ada ruang di belakangnya. Kalau lawan sudah di kotak penalti, kembali
// menempel penuh.
export const BACK_LINE_ROLES = Object.freeze(['CB', 'LB', 'RB']);

export function blendTowardMark(anchor, mark, { lateralOnly = false } = {}) {
  if (!mark) return anchor;
  if (!(mark.pull >= 0 && mark.pull <= 1)) throw new RangeError(`blendTowardMark: pull tidak valid ${mark.pull}`);
  return clampToPitch({
    x: lateralOnly ? anchor.x : anchor.x + (mark.point.x - anchor.x) * mark.pull,
    y: anchor.y + (mark.point.y - anchor.y) * mark.pull,
  });
}
