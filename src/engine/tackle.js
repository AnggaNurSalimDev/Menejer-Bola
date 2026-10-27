// Tekel: duel antara penekan dan pemegang bola.
//
// Peluang berhasil diturunkan dari stat (docs/dokumen-arah-game.md bagian 5):
//   Tackling penekan  vs  Dribbling pemegang bola   (bobot utama)
//   Kekuatan penekan  vs  Kekuatan pemegang bola    (adu badan)
//
// Berhasil : bola lepas dari kaki pemegang dan menggelinding pelan.
// Gagal    : penekan terhuyung (berhenti sejenak), pemegang bola lolos.
// Pelanggaran belum ada; itu bagian dari stat Temperamen di tahap psikologi.

import { distance } from './pitch.js';
import { STAT_MIN, STAT_MAX } from './stats.js';

export const TACKLE_RANGE = 1.6; // meter
export const TACKLE_ATTEMPT_CHANCE = 0.1; // peluang mencoba per tick saat dalam jangkauan
export const BEATEN_COOLDOWN_TICKS = 15; // terhuyung 1,5 detik setelah gagal
export const SUCCESS_COOLDOWN_TICKS = 5;

const BASE_SUCCESS = 0.45;
const SKILL_WEIGHT = 0.03; // per poin selisih Tackling vs Dribbling
const STRENGTH_WEIGHT = 0.015; // per poin selisih Kekuatan
const MIN_SUCCESS = 0.15;
const MAX_SUCCESS = 0.85;

const LOOSE_BALL_MIN_SPEED = 3; // m/s
const LOOSE_BALL_MAX_SPEED = 6;
const LOOSE_BALL_SPREAD = Math.PI / 3; // ±60° dari arah dorongan

function skill(player, key) {
  const value = player.skills?.[key];
  if (!Number.isFinite(value) || value < STAT_MIN || value > STAT_MAX) {
    throw new RangeError(`tackle: stat "${key}" pemain ${player.id} tidak valid (${value})`);
  }
  return value;
}

export function tackleSuccessChance(defender, holder) {
  const raw =
    BASE_SUCCESS +
    (skill(defender, 'tackling') - skill(holder, 'dribbling')) * SKILL_WEIGHT +
    (skill(defender, 'kekuatan') - skill(holder, 'kekuatan')) * STRENGTH_WEIGHT;
  return Math.min(MAX_SUCCESS, Math.max(MIN_SUCCESS, raw));
}

// Pilih penekan yang mencoba tekel di tick ini (paling dekat duluan), atau null.
export function pickTackler(holder, opponents, rng) {
  const inRange = opponents
    .filter((p) => p.tackleCooldown === 0 && distance(p, holder) <= TACKLE_RANGE)
    .sort((a, b) => distance(a, holder) - distance(b, holder) || a.id.localeCompare(b.id));
  if (inRange.length === 0) return null;
  return rng.chance(TACKLE_ATTEMPT_CHANCE) ? inRange[0] : null;
}

// Kecepatan bola yang terlepas akibat tekel berhasil:
// terdorong menjauhi penekan, dengan arah dan laju acak.
export function looseBallVelocity(defender, holder, rng) {
  const d = distance(defender, holder);
  const base = d > 0 ? Math.atan2(holder.y - defender.y, holder.x - defender.x) : rng.range(0, Math.PI * 2);
  const angle = base + rng.range(-LOOSE_BALL_SPREAD, LOOSE_BALL_SPREAD);
  const speed = rng.range(LOOSE_BALL_MIN_SPEED, LOOSE_BALL_MAX_SPEED);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}
