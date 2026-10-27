// Otak pemegang bola: menilai setiap rekan sebagai pilihan operan.
//
// Untuk tiap rekan dihitung tiga hal, lalu dijumlahkan dengan bobot:
//   aman    : apakah ada lawan yang bisa sampai ke jalur bola lebih dulu
//   bebas   : seberapa jauh lawan terdekat dari si penerima
//   maju    : seberapa jauh operan ini membawa bola ke depan
//
// Untuk sementara pilihan terbaik selalu yang diambil (tanpa noise).
// Di tahap blunder, stat Keputusan dan Visi akan mengacaukan pilihan ini.

import { PITCH, clampToPitch, distance, forwardOf } from './pitch.js';
import { passSpeedForDistance, timeToTravel } from './ball.js';
import { reachTime } from './roles.js';

const MIN_PASS_DISTANCE = 4;
const MAX_PASS_DISTANCE = 42;
const LANE_SAMPLE_STEP = 1.5; // meter
const LANE_FIRST_SAMPLE = 0.5; // meter dari titik tendangan
const LEAD_FACTOR = 0.6; // seberapa jauh operan diarahkan ke depan lari penerima
export const SAFE_MARGIN = 0.15; // detik keunggulan minimum atas lawan

const WEIGHTS = {
  progress: 0.14, // tempo padat: operan ke depan lebih diutamakan
  openness: 0.12,
  safety: 1.0,
  distance: 0.01,
  keeper: 1.5, // jarang mengoper balik ke kiper
  returnPass: 0.6, // hindari operan bolak-balik dengan pemberi operan
};
const MAX_SAFETY_CREDIT = 1.5; // detik; lebih aman dari ini tidak menambah nilai
const MAX_OPENNESS = 12; // meter

// Selisih waktu terkecil antara bola dan lawan di sepanjang jalur operan.
// Positif = bola selalu sampai duluan.
export function laneMargin(from, to, speed, opponents) {
  const length = distance(from, to);
  let margin = Infinity;

  // Mulai dari titik dekat kaki pengoper: lawan yang berdiri tepat di depan
  // bola akan memblok operan seketika.
  for (let s = LANE_FIRST_SAMPLE; s <= length + 1e-9; s += LANE_SAMPLE_STEP) {
    const ratio = s / length;
    const point = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    const ballTime = timeToTravel(s, speed);
    if (!Number.isFinite(ballTime)) return -Infinity;

    for (const opponent of opponents) {
      margin = Math.min(margin, reachTime(opponent, point) - ballTime);
    }
  }
  return margin;
}

// Apakah ada lawan yang SUDAH berdiri dalam jangkauan jalur bola
// (bola pasti mengenainya, tanpa perlu bereaksi)?
export function laneOccupied(from, to, opponents) {
  const length = distance(from, to);
  for (let s = LANE_FIRST_SAMPLE; s <= length + 1e-9; s += LANE_SAMPLE_STEP) {
    const ratio = s / length;
    const point = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    if (opponents.some((opponent) => reachTime(opponent, point) === 0)) return true;
  }
  return false;
}

function nearestDistance(point, others) {
  let best = Infinity;
  for (const other of others) best = Math.min(best, distance(point, other));
  return best;
}

export function evaluatePassOptions({ holder, origin, teammates, opponents, attacksRight, previousOwnerId }) {
  if (!holder || !origin) throw new TypeError('evaluatePassOptions: holder dan origin wajib ada');

  const options = [];
  for (const receiver of teammates) {
    if (receiver.id === holder.id) continue;

    const plainDistance = distance(origin, receiver);
    if (plainDistance < MIN_PASS_DISTANCE || plainDistance > MAX_PASS_DISTANCE) continue;

    // Arahkan sedikit ke depan lari penerima.
    const roughTime = plainDistance / passSpeedForDistance(plainDistance);
    const target = clampToPitch(
      {
        x: receiver.x + receiver.vx * roughTime * LEAD_FACTOR,
        y: receiver.y + receiver.vy * roughTime * LEAD_FACTOR,
      },
      0.5,
    );
    const passDistance = distance(origin, target);
    if (passDistance < MIN_PASS_DISTANCE) continue;

    const speed = passSpeedForDistance(passDistance);
    const margin = laneMargin(origin, target, speed, opponents);
    const openness = Math.min(MAX_OPENNESS, nearestDistance(target, opponents));
    const progress = forwardOf(target, attacksRight) - forwardOf(origin, attacksRight);

    const score =
      WEIGHTS.progress * progress +
      WEIGHTS.openness * openness +
      WEIGHTS.safety * Math.min(margin, MAX_SAFETY_CREDIT) -
      WEIGHTS.distance * passDistance -
      (receiver.role === 'GK' ? WEIGHTS.keeper : 0) -
      (receiver.id === previousOwnerId ? WEIGHTS.returnPass : 0);

    options.push({ receiver, target, speed, margin, score, safe: margin > SAFE_MARGIN });
  }

  options.sort((a, b) => b.score - a.score || a.receiver.id.localeCompare(b.receiver.id));
  return options;
}

// Ke mana pemegang bola menggiring kalau belum mengoper:
// lurus ke depan, sedikit ke tengah, tanpa masuk terlalu dalam ke pojok.
const DRIBBLE_LOOKAHEAD = 10;
const DRIBBLE_CENTER_PULL = 0.15;
const DRIBBLE_MAX_FORWARD = PITCH.length - 8;
const FINAL_THIRD_START = PITCH.length - 35; // meter dari gawang sendiri
const CUT_INSIDE_DEPTH = 9; // titik tuju: 9 m di depan gawang lawan, di tengah

// Saat ditekan: menggiring menjauh dari penekan, sambil tetap condong ke depan.
const ESCAPE_DISTANCE = 8;
const ESCAPE_WEIGHT = 1.4;

export function dribbleTarget(holder, attacksRight, presser = null) {
  if (holder.role === 'GK') return clampToPitch(holder, 1);

  if (presser) {
    const away = distance(holder, presser);
    const ax = away > 0 ? (holder.x - presser.x) / away : 0;
    const ay = away > 0 ? (holder.y - presser.y) / away : 1;
    const fx = (attacksRight ? 1 : -1) + ax * ESCAPE_WEIGHT;
    const fy = ay * ESCAPE_WEIGHT;
    const length = Math.hypot(fx, fy) || 1;
    return clampToPitch(
      { x: holder.x + (fx / length) * ESCAPE_DISTANCE, y: holder.y + (fy / length) * ESCAPE_DISTANCE },
      1.5,
    );
  }

  const holderForward = forwardOf(holder, attacksRight);

  // Di sepertiga akhir: potong ke arah gawang untuk membuka sudut tembak.
  if (holderForward >= FINAL_THIRD_START) {
    const aimForward = PITCH.length - CUT_INSIDE_DEPTH;
    const aim = { x: attacksRight ? aimForward : PITCH.length - aimForward, y: PITCH.width / 2 };
    const toAim = distance(holder, aim);
    if (toAim < 1) return clampToPitch(aim, 1.5);
    const step = Math.min(DRIBBLE_LOOKAHEAD, toAim);
    return clampToPitch(
      { x: holder.x + ((aim.x - holder.x) / toAim) * step, y: holder.y + ((aim.y - holder.y) / toAim) * step },
      1.5,
    );
  }

  const forward = Math.min(DRIBBLE_MAX_FORWARD, holderForward + DRIBBLE_LOOKAHEAD);
  const x = attacksRight ? forward : PITCH.length - forward;
  const y = holder.y + (PITCH.width / 2 - holder.y) * DRIBBLE_CENTER_PULL;
  return clampToPitch({ x, y }, 1.5);
}
