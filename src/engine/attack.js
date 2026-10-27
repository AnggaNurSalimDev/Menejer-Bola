// Pola serangan: garis offside, lari ke belakang garis bek, dan titik
// umpan terobosan. (Umpan silang menyusul: butuh bola melambung.)
//
// Semua hitungan "maju" memakai forwardOf dari sudut pandang tim penyerang:
// 0 = garis gawang sendiri, PITCH.length = garis gawang lawan.

import { PITCH, clampToPitch, distance, forwardOf } from './pitch.js';
import { passSpeedForDistance, timeToTravel } from './ball.js';
import { travelTime } from './movement.js';

// ---------------------------------------------------------------- offside

// Garis offside = posisi lawan terakhir kedua (biasanya bek terakhir, karena
// kiper ada di belakangnya), diukur dari sisi tim penyerang.
export function offsideLine(defenders, attacksRight) {
  if (defenders.length < 2) throw new RangeError('offsideLine: butuh minimal 2 pemain bertahan');
  const depths = defenders.map((d) => forwardOf(d, attacksRight)).sort((a, b) => b - a);
  return depths[1];
}

// Posisi offside saat bola dimainkan: di separuh lapangan lawan, dan lebih
// dekat ke gawang lawan daripada bola DAN garis offside.
export function isOffside(player, ballPoint, line, attacksRight) {
  const depth = forwardOf(player, attacksRight);
  if (depth <= PITCH.length / 2) return false;
  return depth > line && depth > forwardOf(ballPoint, attacksRight);
}

// Batas maju untuk posisi jangkar penyerang: sedikit di belakang garis offside
// (atau sejajar bola kalau bola sudah lebih jauh).
const ONSIDE_MARGIN = 1; // meter

export function clampOnside(target, ballPoint, line, attacksRight) {
  const limit = Math.max(line - ONSIDE_MARGIN, forwardOf(ballPoint, attacksRight), PITCH.length / 2);
  const depth = forwardOf(target, attacksRight);
  if (depth <= limit) return target;
  const x = attacksRight ? limit : PITCH.length - limit;
  return { x, y: target.y };
}

// ------------------------------------------------------- lari ke belakang

export const RUNNER_ROLES = Object.freeze(['ST', 'RW', 'LW', 'RM', 'LM']);
const RUN_DEPTH = 10; // meter di belakang garis offside
const RUN_CENTER_PULL = 0.3; // condong ke tengah saat berlari
const RUN_GOAL_MARGIN = 7; // jangan lari lebih dekat dari ini ke garis gawang
const MAX_DISTANCE_BEHIND_LINE = 4; // lari dimulai dari "bahu" bek terakhir, bukan jauh di belakangnya
const MIN_SPACE = 5; // meter: ruang minimal di titik tuju (jarak ke bek terdekat)
const HOLDER_MIN_DEPTH = PITCH.length * 0.35; // pemegang bola sudah melewati area sendiri

export const RUN_MAX_TICKS = 30; // 3 detik: lari yang tidak dilayani berakhir
export const RUN_COOLDOWN_TICKS = 60; // jeda sebelum pemain yang sama berlari lagi
export const RUN_START_CHANCE = 0.05; // per tick, supaya lari tidak terjadi seperti robot

export function runTarget(runner, line, attacksRight) {
  const depth = Math.min(line + RUN_DEPTH, PITCH.length - RUN_GOAL_MARGIN);
  const x = attacksRight ? depth : PITCH.length - depth;
  const y = runner.y + (PITCH.width / 2 - runner.y) * RUN_CENTER_PULL;
  return clampToPitch({ x, y }, 2);
}

// Pilih pelari terbaik (atau null): penyerang onside, dekat garis, belum lelah
// berlari, dengan ruang paling lapang di titik tujunya.
export function pickRunner({ teammates, holder, defenders, ballPoint, attacksRight }) {
  if (!holder || holder.role === 'GK') return null;
  if (forwardOf(holder, attacksRight) < HOLDER_MIN_DEPTH) return null;

  const line = offsideLine(defenders, attacksRight);
  let best = null;
  for (const p of teammates) {
    if (p.id === holder.id || !RUNNER_ROLES.includes(p.role) || p.runCooldown > 0) continue;
    if (isOffside(p, ballPoint, line, attacksRight)) continue;
    const behind = line - forwardOf(p, attacksRight);
    if (behind > MAX_DISTANCE_BEHIND_LINE) continue;

    const target = runTarget(p, line, attacksRight);
    let space = Infinity;
    for (const d of defenders) space = Math.min(space, distance(d, target));
    if (space < MIN_SPACE) continue;

    const score = space - distance(p, target) * 0.1;
    if (!best || score > best.score || (score === best.score && p.id < best.player.id)) {
      best = { player: p, target, score };
    }
  }
  return best;
}

// ------------------------------------------------------ umpan terobosan

const THROUGH_MIN_T = 0.4; // detik
const THROUGH_MAX_T = 3;

// Titik temu bola dan pelari. Pelari tidak berhenti di ujung larinya: titik
// temu boleh berada di perpanjangan arah lari, dan pelari boleh sedikit
// menunggu bola. null kalau tidak ada titik temu yang masuk akal.
const THROUGH_EXTRA_RUN = 12; // meter di depan ujung lari
const THROUGH_WAIT = 0.3; // detik pelari boleh menunggu bola
const THROUGH_GOAL_MARGIN = 3; // titik temu tidak lebih dekat dari ini ke garis gawang

export function throughBallPoint(origin, runner) {
  const dx = runner.target.x - runner.x;
  const dy = runner.target.y - runner.y;
  const runLength = Math.hypot(dx, dy);
  if (runLength < 1) return null;
  const ux = dx / runLength;
  const uy = dy / runLength;

  const STEP = 1; // meter
  for (let along = STEP; along <= runLength + THROUGH_EXTRA_RUN + 1e-9; along += STEP) {
    const point = { x: runner.x + ux * along, y: runner.y + uy * along };
    if (point.x < THROUGH_GOAL_MARGIN || point.x > PITCH.length - THROUGH_GOAL_MARGIN) break;
    if (point.y < 0.5 || point.y > PITCH.width - 0.5) break;
    const runnerTime = travelTime(runner.profile, along);
    if (runnerTime < THROUGH_MIN_T || runnerTime > THROUGH_MAX_T) continue;
    const d = distance(origin, point);
    const ballTime = timeToTravel(d, passSpeedForDistance(d));
    if (ballTime <= runnerTime + THROUGH_WAIT) return point;
  }
  return null;
}
