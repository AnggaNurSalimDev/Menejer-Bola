// Bola "tangan dewa" untuk tahap 2. Belum ada pemain yang menendang:
// bola diam sebentar, lalu meluncur sendiri ke titik acak di sekitarnya,
// melambat karena gesekan, berhenti, dan seterusnya.
// Di tahap 4, fungsi kickBall akan dipanggil oleh pemain, bukan oleh dewa.

import { PITCH } from './pitch.js';

const FRICTION = 4; // m/s², perlambatan bola menggelinding
const MAX_KICK_SPEED = 28; // m/s
const STOP_SPEED = 0.3; // m/s, di bawah ini bola dianggap berhenti

const MIN_KICK_DISTANCE = 12;
const MAX_KICK_DISTANCE = 40;
const TARGET_MARGIN_X = 6;
const TARGET_MARGIN_Y = 4;

const MIN_REST_TICKS = 5;
const MAX_REST_TICKS = 20;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Kecepatan awal agar bola berhenti tepat setelah menempuh jarak d: v = √(2·f·d)
export function kickSpeedForDistance(distance) {
  if (!(distance >= 0)) throw new RangeError(`kickSpeedForDistance: jarak tidak valid ${distance}`);
  return Math.min(MAX_KICK_SPEED, Math.sqrt(2 * FRICTION * distance));
}

function pickTarget(ball, rng) {
  const angle = rng.range(0, Math.PI * 2);
  const distance = rng.range(MIN_KICK_DISTANCE, MAX_KICK_DISTANCE);
  return {
    x: clamp(ball.x + Math.cos(angle) * distance, TARGET_MARGIN_X, PITCH.length - TARGET_MARGIN_X),
    y: clamp(ball.y + Math.sin(angle) * distance, TARGET_MARGIN_Y, PITCH.width - TARGET_MARGIN_Y),
  };
}

export function stepBall(ball, rng, dt) {
  const speed = Math.hypot(ball.vx, ball.vy);

  // Bola diam: hitung mundur, lalu tendang ke titik baru.
  if (speed < STOP_SPEED) {
    if (ball.restTicks > 0) {
      return { ...ball, vx: 0, vy: 0, restTicks: ball.restTicks - 1 };
    }

    const target = pickTarget(ball, rng);
    const dx = target.x - ball.x;
    const dy = target.y - ball.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) {
      return { ...ball, restTicks: rng.int(MIN_REST_TICKS, MAX_REST_TICKS) };
    }
    const kick = kickSpeedForDistance(distance);
    return {
      ...ball,
      vx: (dx / distance) * kick,
      vy: (dy / distance) * kick,
      restTicks: rng.int(MIN_REST_TICKS, MAX_REST_TICKS),
    };
  }

  // Bola menggelinding: bergerak lalu melambat.
  let x = ball.x + ball.vx * dt;
  let y = ball.y + ball.vy * dt;
  const slowed = Math.max(0, speed - FRICTION * dt);
  let vx = (ball.vx / speed) * slowed;
  let vy = (ball.vy / speed) * slowed;

  // Invariant: bola tidak keluar lapangan (keluar/lemparan masuk belum ada).
  if (x < 0 || x > PITCH.length || y < 0 || y > PITCH.width) {
    x = clamp(x, 0, PITCH.length);
    y = clamp(y, 0, PITCH.width);
    vx = 0;
    vy = 0;
  }

  return { ...ball, x, y, vx, vy };
}
