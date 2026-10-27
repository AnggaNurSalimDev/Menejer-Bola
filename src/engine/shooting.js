// Otak penembak: kapan menembak, dan ke mana.
//
// Pemain menilai tiga hal, lalu mengalikannya menjadi satu nilai kualitas:
//   sudut  : seberapa lebar gawang terlihat dari posisinya (radian)
//   jalur  : risiko bek memblok bola di jalurnya
//   kiper  : seberapa siap kiper menjangkau jalur tembakan
// Tembak kalau kualitas ≥ ambang (ambangnya lebih rendah saat ditekan).
//
// Bidikan diarahkan ke sisi gawang yang jauh dari kiper, sedikit di dalam tiang.
// Eksekusinya diberi meleset acak (SHOT_SPREAD) yang SAMA untuk semua pemain.
// Di tahap blunder, besar meleset ini akan diturunkan dari stat Finishing.

import { PITCH, distance, opponentGoalX, isBetweenPosts } from './pitch.js';
import { timeToTravel } from './ball.js';
import { laneMargin, laneOccupied } from './passing.js';

export const SHOT_SPEED = 25; // m/s
export const SHOT_SPREAD = 0.08; // radian, simpangan baku meleset (~4,6°)

const MAX_SHOT_DISTANCE = 32; // meter ke tengah gawang
const MIN_SHOT_ANGLE = 0.2; // radian (~11°) sudut gawang yang terlihat
const POST_INSET = 0.6; // meter di dalam tiang

// Faktor risiko blok: dari selisih waktu bek terhadap bola di jalur (detik).
const LIKELY_BLOCKED_MARGIN = -0.2; // bek jelas lebih dulu → kemungkinan besar terblok
const BLOCK_FACTOR = { clear: 1, risky: 0.6, likely: 0.25 };
// Faktor kiper: dari selisih waktu kiper terhadap bola di jalur (detik).
const KEEPER_BEATEN_MARGIN = 0;
const KEEPER_STRETCH_MARGIN = -0.3;
const KEEPER_FACTOR = { beaten: 1, stretched: 0.6, set: 0.3 };
const KEEPER_ON_LANE_FACTOR = 0.1; // kiper sudah berdiri di jalur tembakan

// Tempo padat: pemain lebih berani menembak.
export const SHOT_QUALITY_THRESHOLD = 0.13;
export const PRESSURED_SHOT_QUALITY_THRESHOLD = 0.09;

function blockFactor(margin) {
  if (margin > 0) return BLOCK_FACTOR.clear;
  if (margin > LIKELY_BLOCKED_MARGIN) return BLOCK_FACTOR.risky;
  return BLOCK_FACTOR.likely;
}

function keeperFactor(margin) {
  if (margin > KEEPER_BEATEN_MARGIN) return KEEPER_FACTOR.beaten;
  if (margin > KEEPER_STRETCH_MARGIN) return KEEPER_FACTOR.stretched;
  return KEEPER_FACTOR.set;
}

// Sudut gawang yang terlihat dari sebuah titik.
export function goalAngle(origin, attacksRight) {
  const goalX = opponentGoalX(attacksRight);
  const half = PITCH.goalWidth / 2;
  const mid = PITCH.width / 2;
  const ax = goalX - origin.x;
  const a1 = { x: ax, y: mid - half - origin.y };
  const a2 = { x: ax, y: mid + half - origin.y };
  const dot = a1.x * a2.x + a1.y * a2.y;
  const lengths = Math.hypot(a1.x, a1.y) * Math.hypot(a2.x, a2.y);
  if (lengths === 0) return 0;
  return Math.acos(Math.min(1, Math.max(-1, dot / lengths)));
}

export function evaluateShot({ origin, opponents, attacksRight, pressured }) {
  if (!origin) throw new TypeError('evaluateShot: origin wajib ada');

  const goalX = opponentGoalX(attacksRight);
  const mid = PITCH.width / 2;
  const goalCenter = { x: goalX, y: mid };
  const toGoal = distance(origin, goalCenter);
  if (toGoal > MAX_SHOT_DISTANCE) return null;

  const angle = goalAngle(origin, attacksRight);
  if (angle < MIN_SHOT_ANGLE) return null;

  // Bidik sisi gawang yang jauh dari kiper.
  const keeper = opponents.find((p) => p.role === 'GK') ?? null;
  const inner = PITCH.goalWidth / 2 - POST_INSET;
  const keeperY = keeper ? keeper.y : mid;
  const aimY = keeperY <= mid ? mid + inner : mid - inner;
  const aim = { x: goalX, y: aimY };

  const aimDistance = distance(origin, aim);
  const ballTime = timeToTravel(aimDistance, SHOT_SPEED);
  if (!Number.isFinite(ballTime)) return null;

  const outfield = opponents.filter((p) => p.role !== 'GK');
  const blockMargin = laneMargin(origin, aim, SHOT_SPEED, outfield);
  // Kiper dicek di sepanjang jalur, bukan hanya di titik bidikan:
  // kiper bisa memotong bola di mana saja selama masih di kotaknya.
  const keeperMargin = keeper ? laneMargin(origin, aim, SHOT_SPEED, [keeper]) : Infinity;

  // Lawan yang sudah berdiri di jalur = bola pasti mengenainya.
  const outfieldOnLane = laneOccupied(origin, aim, outfield);
  const keeperOnLane = keeper ? laneOccupied(origin, aim, [keeper]) : false;

  const quality =
    angle *
    (outfieldOnLane ? 0 : blockFactor(blockMargin)) *
    (keeperOnLane ? KEEPER_ON_LANE_FACTOR : keeperFactor(keeperMargin));
  const threshold = pressured ? PRESSURED_SHOT_QUALITY_THRESHOLD : SHOT_QUALITY_THRESHOLD;
  const shouldShoot = quality >= threshold;

  return { aim, angle, distance: toGoal, blockMargin, keeperMargin, quality, shouldShoot };
}

// Arah tendangan setelah diberi meleset. Mengembalikan kecepatan bola
// dan apakah arahnya masih mengarah di antara tiang (tepat sasaran).
export function shotVelocity(origin, aim, attacksRight, rng) {
  const dx = aim.x - origin.x;
  const dy = aim.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) throw new Error('shotVelocity: titik tembak sama dengan bidikan');

  const error = rng.normal(0, SHOT_SPREAD);
  const cos = Math.cos(error);
  const sin = Math.sin(error);
  const ux = (dx / length) * cos - (dy / length) * sin;
  const uy = (dx / length) * sin + (dy / length) * cos;

  // Di mana arah ini memotong garis gawang?
  const goalX = opponentGoalX(attacksRight);
  const towardGoal = (goalX - origin.x) * ux > 0;
  const crossingY = towardGoal ? origin.y + uy * ((goalX - origin.x) / ux) : NaN;
  const onTarget = towardGoal && isBetweenPosts(crossingY);

  return { vx: ux * SHOT_SPEED, vy: uy * SHOT_SPEED, onTarget };
}
