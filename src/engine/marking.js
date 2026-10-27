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

export function assignMarks(defenders, attackers, attacksRight) {
  const ownGoal = { x: attacksRight ? 0 : PITCH.length, y: PITCH.width / 2 };

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

  const marks = new Map();
  const taken = new Set();
  for (const { defender, attacker } of pairs) {
    if (marks.has(defender.id) || taken.has(attacker.id)) continue;
    taken.add(attacker.id);

    const toGoal = distance(attacker, ownGoal);
    const point = clampToPitch(
      toGoal > 0
        ? {
            x: attacker.x + ((ownGoal.x - attacker.x) / toGoal) * GOAL_SIDE_OFFSET,
            y: attacker.y + ((ownGoal.y - attacker.y) / toGoal) * GOAL_SIDE_OFFSET,
          }
        : attacker,
    );

    // Jarak lawan dari garis gawang kita (0 = di garis gawang kita).
    const fromOurGoal = forwardOf(attacker, attacksRight);
    const closeness = 1 - Math.min(1, fromOurGoal / TIGHT_ZONE);
    // Stat Posisi: bek yang buruk menjaga lebih longgar (blunder tahap 5).
    const tightness = defender.skills ? blunder(defender, 'markingTightness') : 1;
    const pull = Math.min(MAX_ALLOWED_PULL, (MIN_PULL + (MAX_PULL - MIN_PULL) * closeness) * tightness);

    marks.set(defender.id, { point, pull, attackerId: attacker.id });
  }
  return marks;
}

export function blendTowardMark(anchor, mark) {
  if (!mark) return anchor;
  if (!(mark.pull >= 0 && mark.pull <= 1)) throw new RangeError(`blendTowardMark: pull tidak valid ${mark.pull}`);
  return clampToPitch({
    x: anchor.x + (mark.point.x - anchor.x) * mark.pull,
    y: anchor.y + (mark.point.y - anchor.y) * mark.pull,
  });
}
