// Otak penembak: kapan menembak, dan ke mana.
//
// Pemain menilai tiga hal, lalu mengalikannya menjadi satu nilai kualitas:
//   sudut  : seberapa lebar gawang terlihat dari posisinya (radian)
//   jalur  : risiko bek memblok bola di jalurnya
//   kiper  : seberapa siap kiper menjangkau jalur tembakan
// Tembak kalau kualitas ≥ ambang (ambangnya lebih rendah saat ditekan).
//
// Bidikan diarahkan ke sisi gawang yang jauh dari kiper, sedikit di dalam tiang.
// Eksekusinya diberi meleset acak yang besarnya diturunkan dari stat Finishing
// (lihat skill.js, baris shotSpread). SHOT_SPREAD hanya cadangan.
// Di tahap blunder, besar meleset ini akan diturunkan dari stat Finishing.

import { PITCH, distance, opponentGoalX, isBetweenPosts } from './pitch.js';
import { normalizeStat } from './skill.js';
import { timeToTravel } from './ball.js';
import { laneMargin, laneOccupied } from './passing.js';

export const SHOT_SPEED = 25; // m/s, cadangan bila penembak tidak diketahui

// Tenaga tendangan (28 Okt): laju tembakan dari Finishing (teknik) dan Kekuatan.
// Stat 12 ≈ 25,5 m/s, sama dengan sebelumnya; stat 20 → 28,5 m/s.
export const SHOT_POWER = Object.freeze({ min: 21.5, max: 28.5, finishingWeight: 0.6, strengthWeight: 0.4 });

// Pandangan kiper terhalang (28 Okt): pemain lapangan (siapa pun) di jalur tembakan,
// cukup jauh dari kiper, membuat kiper terlambat melihat bola.
export const SCREEN = Object.freeze({ laneWidth: 1.2, minGapToKeeper: 3, delay: 0.2 });

export function shotSpeedFor(player) {
  if (!player?.skills) return SHOT_SPEED;
  const mix =
    SHOT_POWER.finishingWeight * normalizeStat(player.skills.finishing) +
    SHOT_POWER.strengthWeight * normalizeStat(player.skills.kekuatan);
  return SHOT_POWER.min + (SHOT_POWER.max - SHOT_POWER.min) * mix;
}

// Apakah ada pemain lapangan di jalur origin→aim yang menghalangi pandangan kiper?
export function isScreened(origin, aim, keeper, others) {
  if (!keeper) return false;
  const length = distance(origin, aim);
  if (!(length > 0)) return false;
  const ux = (aim.x - origin.x) / length;
  const uy = (aim.y - origin.y) / length;
  const keeperAlong = (keeper.x - origin.x) * ux + (keeper.y - origin.y) * uy;
  for (const p of others) {
    if (p.role === 'GK') continue;
    const along = (p.x - origin.x) * ux + (p.y - origin.y) * uy;
    if (along <= 1 || along >= keeperAlong - SCREEN.minGapToKeeper) continue;
    const across = Math.abs(-(p.x - origin.x) * uy + (p.y - origin.y) * ux);
    if (across <= SCREEN.laneWidth) return true;
  }
  return false;
}
export const SHOT_SPREAD = 0.08; // radian, simpangan baku meleset (~4,6°)

// Simpangan membesar dengan jarak (31 Okt, kalibrasi tembakan): dulu tembakan dari 16–22 m masuk 16%
// (nyata ~5–7%) dan hanya 20% tembakan melebar (nyata ~40%). Menembak dari jauh lebih sulit
// dikontrol, bukan hanya sudutnya yang membuat meleset lebih jauh.
export const SHOT_RANGE = Object.freeze({ free: 12, perMeter: 0.1 });

export function rangeSpreadScale(distanceToGoal) {
  if (!Number.isFinite(distanceToGoal) || distanceToGoal < 0) throw new RangeError(`rangeSpreadScale: jarak tidak valid ${distanceToGoal}`);
  return 1 + SHOT_RANGE.perMeter * Math.max(0, distanceToGoal - SHOT_RANGE.free);
}

const MAX_SHOT_DISTANCE = 32; // meter ke tengah gawang
const MIN_SHOT_ANGLE = 0.2; // radian (~11°) sudut gawang yang terlihat
const POST_INSET = 0.6; // meter di dalam tiang

// Faktor risiko blok: dari selisih waktu bek terhadap bola di jalur (detik).
const LIKELY_BLOCKED_MARGIN = -0.2; // bek jelas lebih dulu → kemungkinan besar terblok
const BLOCK_FACTOR = { clear: 1, risky: 0.6, likely: 0.25 };
// Faktor kiper: dari selisih waktu kiper terhadap bola di jalur (detik).
// Dikalibrasi 28 Okt dari hasil nyata (32 laga): selisih 0..0,2 dtk hanya 4% gol,
// di bawah 0 hampir 0%, di atas 0,2 dtk 24%. Batas lama (0 / −0,3) membuat
// pemain terlalu optimis dan menembak dari 25–33 m (0 gol dari 273 tembakan).
const KEEPER_BEATEN_MARGIN = 0.2;
const KEEPER_STRETCH_MARGIN = 0;
const KEEPER_FACTOR = { beaten: 1, stretched: 0.6, set: 0.1 };
const KEEPER_ON_LANE_FACTOR = 0.1; // kiper sudah berdiri di jalur tembakan

// Tempo padat: pemain lebih berani menembak.
export const SHOT_QUALITY_THRESHOLD = 0.1;
export const PRESSURED_SHOT_QUALITY_THRESHOLD = 0.07;

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

// thresholdScale: pengali ambang tembak (< 1 = lebih cepat menembak, dari stat Egoisme).
// shotSpeed: laju tembakan si penembak; screeners: pemain lain (kedua tim) yang bisa
// menghalangi pandangan kiper di jalur tembakan (kiper lalu bereaksi lebih lambat).
export function evaluateShot({
  origin,
  opponents,
  attacksRight,
  pressured,
  thresholdScale = 1,
  shotSpeed = SHOT_SPEED,
  screeners = [],
}) {
  if (!(thresholdScale > 0)) throw new RangeError(`evaluateShot: thresholdScale tidak valid ${thresholdScale}`);
  if (!(shotSpeed > 0)) throw new RangeError(`evaluateShot: shotSpeed tidak valid ${shotSpeed}`);
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
  const ballTime = timeToTravel(aimDistance, shotSpeed);
  if (!Number.isFinite(ballTime)) return null;

  const outfield = opponents.filter((p) => p.role !== 'GK');
  const blockMargin = laneMargin(origin, aim, shotSpeed, outfield);
  // Kiper dicek di sepanjang jalur, bukan hanya di titik bidikan:
  // kiper bisa memotong bola di mana saja selama masih di kotaknya.
  const screened = isScreened(origin, aim, keeper, screeners);
  const seenKeeper =
    keeper && screened
      ? { ...keeper, profile: { ...keeper.profile, reaction: (keeper.profile?.reaction ?? 0.3) + SCREEN.delay } }
      : keeper;
  const keeperMargin = keeper ? laneMargin(origin, aim, shotSpeed, [seenKeeper]) : Infinity;

  // Lawan yang sudah berdiri di jalur = bola pasti mengenainya.
  const outfieldOnLane = laneOccupied(origin, aim, outfield);
  const keeperOnLane = keeper ? laneOccupied(origin, aim, [keeper]) : false;

  const quality =
    angle *
    (outfieldOnLane ? 0 : blockFactor(blockMargin)) *
    (keeperOnLane ? KEEPER_ON_LANE_FACTOR : keeperFactor(keeperMargin));
  const threshold = (pressured ? PRESSURED_SHOT_QUALITY_THRESHOLD : SHOT_QUALITY_THRESHOLD) * thresholdScale;
  const shouldShoot = quality >= threshold;

  return { aim, angle, distance: toGoal, blockMargin, keeperMargin, quality, shouldShoot, screened, speed: shotSpeed };
}

// Arah tendangan setelah diberi meleset. Mengembalikan kecepatan bola
// dan apakah arahnya masih mengarah di antara tiang (tepat sasaran).
export function shotVelocity(origin, aim, attacksRight, rng, spread = SHOT_SPREAD, speed = SHOT_SPEED) {
  if (!(spread >= 0)) throw new RangeError(`shotVelocity: spread tidak valid ${spread}`);
  if (!(speed > 0)) throw new RangeError(`shotVelocity: laju tidak valid ${speed}`);
  const dx = aim.x - origin.x;
  const dy = aim.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) throw new Error('shotVelocity: titik tembak sama dengan bidikan');

  const error = rng.normal(0, spread);
  const cos = Math.cos(error);
  const sin = Math.sin(error);
  const ux = (dx / length) * cos - (dy / length) * sin;
  const uy = (dx / length) * sin + (dy / length) * cos;

  // Di mana arah ini memotong garis gawang?
  const goalX = opponentGoalX(attacksRight);
  const towardGoal = (goalX - origin.x) * ux > 0;
  const crossingY = towardGoal ? origin.y + uy * ((goalX - origin.x) / ux) : NaN;
  const onTarget = towardGoal && isBetweenPosts(crossingY);

  return { vx: ux * speed, vy: uy * speed, onTarget };
}
