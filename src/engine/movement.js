// Lapisan GERAK: tubuh pemain. Otak memberi target, tubuh mengejarnya
// dengan inersia (docs/dokumen-arah-game.md, logika gerak prinsip 1).
//
// Tubuh punya tiga batas yang diturunkan dari stat:
//   maxSpeed  ← Kecepatan   : seberapa kencang bisa berlari
//   maxAccel  ← Akselerasi  : seberapa cepat menambah/mengurangi laju
//   turnAccel ← Kelincahan  : seberapa tajam bisa berbelok

import { PITCH } from './pitch.js';
import { STAT_MIN, STAT_MAX } from './stats.js';

// Nilai stat 1–20 menjadi 0–1.
function normalize(stat) {
  if (!Number.isFinite(stat)) throw new TypeError(`normalize: stat tidak valid ${stat}`);
  return (Math.min(STAT_MAX, Math.max(STAT_MIN, stat)) - STAT_MIN) / (STAT_MAX - STAT_MIN);
}

export function deriveMovementProfile(stats) {
  if (!stats) throw new TypeError('deriveMovementProfile: stats wajib ada');

  const maxSpeed = 6.5 + 2.8 * normalize(stats.kecepatan); // 6.5–9.3 m/s
  const maxAccel = 2.5 + 3.0 * normalize(stats.akselerasi); // 2.5–5.5 m/s²
  const turnAccel = maxAccel * (0.5 + 0.6 * normalize(stats.kelincahan)); // 50–110% dari maxAccel

  return { maxSpeed, maxAccel, turnAccel };
}

// Perkiraan waktu menempuh `distance` meter dari keadaan diam, dengan
// percepatan maxAccel sampai mencapai maxSpeed. Dipakai otak pemain untuk
// memperkirakan siapa yang lebih dulu sampai ke bola.
export function travelTime(profile, distanceMeters) {
  if (!(distanceMeters >= 0)) throw new RangeError(`travelTime: jarak tidak valid ${distanceMeters}`);
  const { maxSpeed, maxAccel } = profile;
  const accelDistance = (maxSpeed * maxSpeed) / (2 * maxAccel);
  if (distanceMeters <= accelDistance) return Math.sqrt((2 * distanceMeters) / maxAccel);
  return maxSpeed / maxAccel + (distanceMeters - accelDistance) / maxSpeed;
}

// Kecepatan jelajah saat sekadar berpindah posisi: pemain tidak sprint
// untuk urusan menjaga bentuk, kecuali tertinggal jauh dari posnya.
const CRUISE_FRACTION = 0.6;
const SPRINT_DISTANCE = 15; // meter
const ARRIVE_RADIUS = 0.4; // meter, dianggap sudah sampai
const BRAKE_FACTOR = 0.8; // sisakan ruang pengereman agar tidak kebablasan

// options.speedScale : batas laju sebagai bagian dari maxSpeed (misal 0,75 saat menggiring)
// options.urgent     : langsung lari penuh (menjemput bola, menekan), bukan jelajah
function desiredSpeed(distance, profile, options) {
  if (distance < ARRIVE_RADIUS) return 0;

  const topSpeed = profile.maxSpeed * options.speedScale;
  const urgency = options.urgent ? 1 : Math.min(1, distance / SPRINT_DISTANCE);
  const cruise = topSpeed * (CRUISE_FRACTION + (1 - CRUISE_FRACTION) * urgency);

  // Laju tertinggi yang masih bisa direm tepat di target: v² = 2·a·d
  const brakeLimit = Math.sqrt(2 * profile.maxAccel * BRAKE_FACTOR * distance);

  return Math.min(cruise, brakeLimit);
}

function clampMagnitude(value, max) {
  return Math.max(-max, Math.min(max, value));
}

// Satu langkah gerak. Mengembalikan posisi & kecepatan baru (tidak mengubah input).
export function stepBody(player, target, dt, { speedScale = 1, urgent = false } = {}) {
  if (!(speedScale > 0 && speedScale <= 1)) throw new RangeError(`stepBody: speedScale tidak valid ${speedScale}`);
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new TypeError(`stepBody: target tidak valid untuk ${player.id}`);
  }

  const { profile } = player;
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  const distance = Math.hypot(dx, dy);

  // Kecepatan yang DIINGINKAN otak.
  const want = desiredSpeed(distance, profile, { speedScale, urgent });
  const wantVx = distance > 0 ? (dx / distance) * want : 0;
  const wantVy = distance > 0 ? (dy / distance) * want : 0;

  // Selisih antara yang diinginkan dan yang sedang terjadi.
  let deltaVx = wantVx - player.vx;
  let deltaVy = wantVy - player.vy;

  const speed = Math.hypot(player.vx, player.vy);

  if (speed > 0.5) {
    // Pecah selisih menjadi komponen searah gerak (gas/rem) dan
    // tegak lurus gerak (belok). Belok dibatasi kelincahan.
    const ux = player.vx / speed;
    const uy = player.vy / speed;
    const along = deltaVx * ux + deltaVy * uy;
    const across = -deltaVx * uy + deltaVy * ux;

    const alongClamped = clampMagnitude(along, profile.maxAccel * dt);
    const acrossClamped = clampMagnitude(across, profile.turnAccel * dt);

    deltaVx = alongClamped * ux - acrossClamped * uy;
    deltaVy = alongClamped * uy + acrossClamped * ux;
  } else {
    // Hampir diam: tidak ada arah "depan", batasi total percepatan saja.
    const magnitude = Math.hypot(deltaVx, deltaVy);
    const limit = profile.maxAccel * dt;
    if (magnitude > limit) {
      deltaVx = (deltaVx / magnitude) * limit;
      deltaVy = (deltaVy / magnitude) * limit;
    }
  }

  let vx = player.vx + deltaVx;
  let vy = player.vy + deltaVy;

  // Invariant: tidak pernah melebihi kecepatan maksimal.
  const newSpeed = Math.hypot(vx, vy);
  if (newSpeed > profile.maxSpeed) {
    vx = (vx / newSpeed) * profile.maxSpeed;
    vy = (vy / newSpeed) * profile.maxSpeed;
  }

  let x = player.x + vx * dt;
  let y = player.y + vy * dt;

  // Invariant: tetap di dalam lapangan. Kalau menabrak garis, laju di sumbu itu hilang.
  if (x < 0 || x > PITCH.length) {
    x = Math.min(PITCH.length, Math.max(0, x));
    vx = 0;
  }
  if (y < 0 || y > PITCH.width) {
    y = Math.min(PITCH.width, Math.max(0, y));
    vy = 0;
  }

  return { x, y, vx, vy };
}
