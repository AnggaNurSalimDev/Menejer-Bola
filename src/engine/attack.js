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

export function runTarget(runner, line, attacksRight, laneY = null) {
  const depth = Math.min(line + RUN_DEPTH, PITCH.length - RUN_GOAL_MARGIN);
  const x = attacksRight ? depth : PITCH.length - depth;
  const y = laneY ?? runner.y + (PITCH.width / 2 - runner.y) * RUN_CENTER_PULL;
  return clampToPitch({ x, y }, 2);
}

// Celah di garis belakang lawan: ruang di antara dua bek yang berdekatan
// dengan garis offside (dan di antara bek terluar dan garis samping).
// Mengembalikan daftar { y, width } — y = tengah celah.
const LINE_BAND = 8; // meter: bek dalam jarak ini dari garis dianggap bagian garis
const TOUCHLINE_MARGIN = 3;
const MIN_CHANNEL_WIDTH = 7; // meter
const MAX_CHANNEL_SHIFT = 18; // meter: seberapa jauh pelari mau bergeser ke samping
const CHANNEL_SHIFT_COST = 0.3; // nilai berkurang per meter geser ke samping

export function backLineChannels(defenders, line, attacksRight) {
  const ys = defenders
    .filter((d) => d.role !== 'GK' && Math.abs(forwardOf(d, attacksRight) - line) <= LINE_BAND)
    .map((d) => d.y)
    .sort((a, b) => a - b);
  const edges = [TOUCHLINE_MARGIN, ...ys, PITCH.width - TOUCHLINE_MARGIN];
  const channels = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const width = edges[i + 1] - edges[i];
    if (width >= MIN_CHANNEL_WIDTH) channels.push({ y: (edges[i] + edges[i + 1]) / 2, width });
  }
  return channels;
}

function bestChannelFor(runner, channels) {
  let best = null;
  for (const c of channels) {
    const shift = Math.abs(c.y - runner.y);
    if (shift > MAX_CHANNEL_SHIFT) continue;
    const score = c.width - shift * CHANNEL_SHIFT_COST;
    if (!best || score > best.score) best = { ...c, score };
  }
  return best;
}

// Pilih pelari terbaik (atau null): penyerang onside, dekat garis, belum lelah
// berlari, dengan ruang paling lapang di titik tujunya.
export function pickRunner({ teammates, holder, defenders, ballPoint, attacksRight }) {
  if (!holder || holder.role === 'GK') return null;
  if (forwardOf(holder, attacksRight) < HOLDER_MIN_DEPTH) return null;

  const line = offsideLine(defenders, attacksRight);
  const channels = backLineChannels(defenders, line, attacksRight);
  let best = null;
  for (const p of teammates) {
    if (p.id === holder.id || !RUNNER_ROLES.includes(p.role) || p.runCooldown > 0) continue;
    if (isOffside(p, ballPoint, line, attacksRight)) continue;
    const behind = line - forwardOf(p, attacksRight);
    if (behind > MAX_DISTANCE_BEHIND_LINE) continue;

    // Lari diarahkan ke celah antar-bek, bukan lurus ke zona bek.
    const channel = bestChannelFor(p, channels);
    if (!channel) continue;
    const target = runTarget(p, line, attacksRight, channel.y);
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

// ---------------------------------------------------- satu lawan satu

// Pemegang bola sudah lolos: tidak ada bek lapangan yang lebih dekat ke
// gawang lawan dalam koridor di depannya. Saatnya lari ke gawang, bukan mengoper.
const BREAKAWAY_CORRIDOR = 12; // meter ke kiri/kanan arah ke gawang
const BREAKAWAY_RANGE = 40; // meter ke gawang: lebih jauh dari ini belum dianggap lolos

export function isBreakaway(holder, opponents, attacksRight) {
  if (holder.role === 'GK') return false;
  const goal = { x: attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  const toGoal = distance(holder, goal);
  if (toGoal > BREAKAWAY_RANGE || toGoal === 0) return false;
  const ux = (goal.x - holder.x) / toGoal;
  const uy = (goal.y - holder.y) / toGoal;
  for (const o of opponents) {
    if (o.role === 'GK') continue;
    const along = (o.x - holder.x) * ux + (o.y - holder.y) * uy;
    if (along <= 0) continue; // di belakang pemegang bola
    const across = Math.abs(-(o.x - holder.x) * uy + (o.y - holder.y) * ux);
    if (across <= BREAKAWAY_CORRIDOR) return false;
  }
  return true;
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
// Umpan terobosan harus benar-benar menembus garis: titik temu minimal
// sejauh ini di belakang garis offside (diukur saat bola dimainkan).
export const THROUGH_MIN_BEHIND_LINE = 4; // meter

// line & attacksRight opsional: tanpa itu, syarat "menembus garis" tidak dicek.
export function throughBallPoint(origin, runner, line = null, attacksRight = true) {
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
    if (line !== null && forwardOf(point, attacksRight) < line + THROUGH_MIN_BEHIND_LINE) continue;
    const runnerTime = travelTime(runner.profile, along);
    if (runnerTime < THROUGH_MIN_T || runnerTime > THROUGH_MAX_T) continue;
    const d = distance(origin, point);
    const ballTime = timeToTravel(d, passSpeedForDistance(d));
    if (ballTime <= runnerTime + THROUGH_WAIT) return point;
  }
  return null;
}
