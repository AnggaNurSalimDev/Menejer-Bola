// Otak pemegang bola: menilai setiap rekan sebagai pilihan operan.
//
// Untuk tiap rekan dihitung tiga hal, lalu dijumlahkan dengan bobot:
//   aman    : apakah ada lawan yang bisa sampai ke jalur bola lebih dulu
//   bebas   : seberapa jauh lawan terdekat dari si penerima
//   maju    : seberapa jauh operan ini membawa bola ke depan
//
// Blunder (tahap 5):
//   Visi      : operan yang lebih jauh dari jangkauan penglihatan tidak terpikirkan
//   Keputusan : rasa aman tiap opsi dinilai dengan salah kira (noise), jadi pemain
//               dengan Keputusan rendah kadang mengoper ke jalur yang sebenarnya berbahaya

import { PITCH, clampToPitch, distance, forwardOf } from './pitch.js';
import { passSpeedForDistance, timeToTravel } from './ball.js';
import { reachTime } from './roles.js';
import { blunder } from './skill.js';
import { BLUNDER_SCALE_MIN, BLUNDER_SCALE_MAX } from './condition.js';
import { offsideLine, isOffside, throughBallPoint } from './attack.js';

// Keputusan rendah juga berarti salah membaca garis offside (meter per detik salah kira).
const OFFSIDE_MISJUDGE_METERS_PER_SECOND = 10;
// Umpan terobosan ke pelari di belakang garis bek sedikit lebih dihargai.
const THROUGH_BALL_BONUS = 0.6;
// Umpan terobosan layak dicoba walau sedikit berisiko: hadiahnya peluang satu lawan satu.
const THROUGH_SAFE_MARGIN = -0.25; // detik

const MIN_PASS_DISTANCE = 4;
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

// rng opsional: tanpa rng, penilaian dilakukan sempurna (dipakai uji dan alat ukur).
// misjudgeScale : pengali salah kira dari kondisi (lelah, tekanan, percaya diri) — 0,85–1,3 (< 1 hanya saat on fire)
// progressScale  : pengali bobot operan ke depan (ragu saat percaya diri rendah) — ≤ 1
export function evaluatePassOptions({
  holder,
  origin,
  teammates,
  opponents,
  attacksRight,
  previousOwnerId,
  rng = null,
  misjudgeScale = 1,
  progressScale = 1,
}) {
  if (!holder || !origin) throw new TypeError('evaluatePassOptions: holder dan origin wajib ada');

  const vision = blunder(holder, 'passVision');
  if (
    !(misjudgeScale >= BLUNDER_SCALE_MIN - 1e-9 && misjudgeScale <= BLUNDER_SCALE_MAX + 1e-9) ||
    !(progressScale > 0 && progressScale <= 1)
  ) {
    throw new RangeError(`evaluatePassOptions: skala kondisi tidak valid (${misjudgeScale}, ${progressScale})`);
  }
  const misjudge = rng ? blunder(holder, 'riskMisjudge') * misjudgeScale : 0;
  const arrival = blunder(holder, 'passArrival'); // ketajaman operan dari stat Passing
  const trueLine = offsideLine(opponents, attacksRight);

  const options = [];
  for (const receiver of teammates) {
    if (receiver.id === holder.id) continue;

    const plainDistance = distance(origin, receiver);
    if (plainDistance < MIN_PASS_DISTANCE || plainDistance > vision) continue;

    // Offside dinilai saat bola dimainkan. Pemain bisa salah membaca garisnya.
    const perceivedLine = misjudge > 0 ? trueLine + rng.normal(0, misjudge * OFFSIDE_MISJUDGE_METERS_PER_SECOND) : trueLine;
    if (isOffside(receiver, origin, perceivedLine, attacksRight)) continue;
    const offside = isOffside(receiver, origin, trueLine, attacksRight);

    // Pelari ke belakang garis bek: umpan ke RUANG di depan larinya.
    // Penerima lain: operan diarahkan sedikit ke depan larinya.
    const isRun = receiver.task === 'run' && receiver.target;
    let target;
    if (isRun) {
      // Syarat "titik temu jauh di belakang garis" (throughBallPoint mendukungnya)
      // sempat dicoba: umpan terobosan jadi lebih jarang tanpa hasil lebih baik.
      target = throughBallPoint(origin, receiver);
      if (!target) continue;
    } else {
      const roughTime = plainDistance / passSpeedForDistance(plainDistance, arrival);
      target = clampToPitch(
        {
          x: receiver.x + receiver.vx * roughTime * LEAD_FACTOR,
          y: receiver.y + receiver.vy * roughTime * LEAD_FACTOR,
        },
        0.5,
      );
    }
    const passDistance = distance(origin, target);
    if (passDistance < MIN_PASS_DISTANCE) continue;

    const speed = passSpeedForDistance(passDistance, arrival);
    const trueMargin = laneMargin(origin, target, speed, opponents);
    // Yang dipakai untuk memutuskan adalah rasa aman MENURUT si pemain.
    const margin = misjudge > 0 ? trueMargin + rng.normal(0, misjudge) : trueMargin;
    const openness = Math.min(MAX_OPENNESS, nearestDistance(target, opponents));
    const progress = forwardOf(target, attacksRight) - forwardOf(origin, attacksRight);

    const score =
      WEIGHTS.progress * progressScale * progress +
      WEIGHTS.openness * openness +
      WEIGHTS.safety * Math.min(margin, MAX_SAFETY_CREDIT) -
      WEIGHTS.distance * passDistance -
      (receiver.role === 'GK' ? WEIGHTS.keeper : 0) -
      (receiver.id === previousOwnerId ? WEIGHTS.returnPass : 0) +
      (isRun ? THROUGH_BALL_BONUS : 0);

    const safe = margin > (isRun ? THROUGH_SAFE_MARGIN : SAFE_MARGIN);
    options.push({ receiver, target, speed, margin, trueMargin, score, safe, offside, through: !!isRun });
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

// Mencari ruang tembak: kalau bek menutup jalur ke gawang, geser bola ke samping.
export const SHOT_LANE_RANGE = 32; // meter ke tengah gawang
const LANE_BLOCK_WIDTH = 1.8; // meter dari garis tembak
const SIDESTEP_DISTANCE = 5;
const SIDESTEP_FORWARD = 1.5;

// Bek lapangan yang berdiri di jalur dari bola ke tengah gawang (di depan bola), atau null.
export function shotLaneBlocker(origin, opponents, attacksRight) {
  const goal = { x: attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  const length = distance(origin, goal);
  if (length > SHOT_LANE_RANGE || length === 0) return null;
  const ux = (goal.x - origin.x) / length;
  const uy = (goal.y - origin.y) / length;

  let best = null;
  for (const opponent of opponents) {
    if (opponent.role === 'GK') continue;
    const along = (opponent.x - origin.x) * ux + (opponent.y - origin.y) * uy;
    if (along <= 0 || along >= length) continue;
    const across = Math.abs(-(opponent.x - origin.x) * uy + (opponent.y - origin.y) * ux);
    if (across <= LANE_BLOCK_WIDTH && (!best || along < best.along)) best = { opponent, along };
  }
  return best ? best.opponent : null;
}

function sidestepTarget(holder, blocker, attacksRight) {
  const goal = { x: attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  const length = distance(holder, goal) || 1;
  const ux = (goal.x - holder.x) / length;
  const uy = (goal.y - holder.y) / length;
  // Tegak lurus arah gawang; pilih sisi yang menjauhi bek (kalau tepat di garis: ke arah tengah lapangan).
  const side = -(blocker.x - holder.x) * uy + (blocker.y - holder.y) * ux;
  let px = -uy;
  let py = ux;
  const towardCenter = (PITCH.width / 2 - holder.y) * py >= 0;
  const flip = side > 1e-6 || (Math.abs(side) <= 1e-6 && !towardCenter);
  if (flip) {
    px = -px;
    py = -py;
  }
  return clampToPitch(
    {
      x: holder.x + px * SIDESTEP_DISTANCE + ux * SIDESTEP_FORWARD,
      y: holder.y + py * SIDESTEP_DISTANCE + uy * SIDESTEP_FORWARD,
    },
    1.5,
  );
}

export function dribbleTarget(holder, attacksRight, presser = null, laneBlocker = null) {
  if (holder.role === 'GK') return clampToPitch(holder, 1);

  if (laneBlocker) return sidestepTarget(holder, laneBlocker, attacksRight);

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
