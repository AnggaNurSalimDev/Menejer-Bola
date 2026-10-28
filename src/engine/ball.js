// Fisika bola yang disederhanakan: bola menggelinding lurus dan melambat
// dengan perlambatan tetap (gesekan). Tidak ada lambungan, putaran, atau pantulan.
//
// Karena geraknya sederhana, posisi bola di masa depan bisa dihitung
// persis. Itulah yang dipakai pemain untuk "membaca" ke mana bola akan pergi.

export const FRICTION = 3.5; // m/s²
export const MAX_KICK_SPEED = 26; // m/s
export const STOP_SPEED = 0.2; // m/s, di bawah ini bola dianggap diam

// Operan yang baik masih bergulir saat sampai di kaki penerima.
// Nilai bawaan; laju tiba sebenarnya diturunkan dari stat Passing (skill.js, passArrival).
export const PASS_ARRIVAL_SPEED = 5; // m/s
const MIN_ARRIVAL_SPEED = 2;
const MAX_ARRIVAL_SPEED = 10;

export function ballSpeed(ball) {
  return Math.hypot(ball.vx, ball.vy);
}

// Jarak tempuh bola dengan laju awal `speed` setelah `t` detik.
function travelledAfter(speed, t) {
  const tStop = speed / FRICTION;
  const tt = Math.min(t, tStop);
  return speed * tt - 0.5 * FRICTION * tt * tt;
}

export function predictBallPosition(ball, t) {
  if (!(t >= 0)) throw new RangeError(`predictBallPosition: waktu tidak valid ${t}`);
  const speed = ballSpeed(ball);
  if (speed < STOP_SPEED || t === 0) return { x: ball.x, y: ball.y };
  const s = travelledAfter(speed, t);
  return { x: ball.x + (ball.vx / speed) * s, y: ball.y + (ball.vy / speed) * s };
}

// Satu langkah gelinding. Hasilnya selalu konsisten dengan predictBallPosition.
export function rollBall(ball, dt) {
  if (!(dt > 0)) throw new RangeError(`rollBall: dt tidak valid ${dt}`);
  const speed = ballSpeed(ball);
  if (speed < STOP_SPEED) return { x: ball.x, y: ball.y, vx: 0, vy: 0 };

  const s = travelledAfter(speed, dt);
  const newSpeed = Math.max(0, speed - FRICTION * dt);
  const ux = ball.vx / speed;
  const uy = ball.vy / speed;
  return {
    x: ball.x + ux * s,
    y: ball.y + uy * s,
    vx: newSpeed < STOP_SPEED ? 0 : ux * newSpeed,
    vy: newSpeed < STOP_SPEED ? 0 : uy * newSpeed,
  };
}

// Berapa detik bola dengan laju awal `speed` menempuh `distance` meter.
// Infinity kalau bola berhenti sebelum sampai.
export function timeToTravel(distanceMeters, speed) {
  if (!(distanceMeters >= 0) || !(speed >= 0)) {
    throw new RangeError(`timeToTravel: input tidak valid (${distanceMeters}, ${speed})`);
  }
  const discriminant = speed * speed - 2 * FRICTION * distanceMeters;
  if (discriminant < 0) return Infinity;
  return (speed - Math.sqrt(discriminant)) / FRICTION;
}

// Laju tendangan agar bola sampai sejauh `distance` dengan sisa laju PASS_ARRIVAL_SPEED.
// v_awal² = v_tiba² + 2·gesekan·jarak
export function passSpeedForDistance(distanceMeters, arrivalSpeed = PASS_ARRIVAL_SPEED) {
  if (!(distanceMeters >= 0)) throw new RangeError(`passSpeedForDistance: jarak tidak valid ${distanceMeters}`);
  if (!(arrivalSpeed >= MIN_ARRIVAL_SPEED && arrivalSpeed <= MAX_ARRIVAL_SPEED)) {
    throw new RangeError(`passSpeedForDistance: laju tiba tidak valid ${arrivalSpeed}`);
  }
  return Math.min(MAX_KICK_SPEED, Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * FRICTION * distanceMeters));
}
