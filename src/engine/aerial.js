// Bola udara (percobaan 2, 28 Okt): umpan silang, sepak pojok, sundulan.
//
// Bola punya tinggi z (meter) dan laju naik vz. Selama di udara bola tidak
// melambat mendatar (gesekan rumput tidak bekerja) dan ditarik gravitasi.
//
//   z > FOOT_MAX          : kaki tidak bisa menyentuh; hanya kepala (HEAD_MIN–HEAD_MAX)
//                           atau tangan kiper di kotaknya (sampai KEEPER_MAX)
//   z ≤ FOOT_MAX          : bola dianggap rendah, aturan bola tanah berlaku
//   memantul di tanah     : vz berbalik dan mengecil; laju mendatar berkurang
//
// Siapa yang menang duel udara: stat Duel udara (utama), Kekuatan, dan seberapa
// dekat pemain ke bola, ditambah sedikit acak. Kiper punya keunggulan tangan.

import { PITCH, clampToPitch, distance, insideOwnPenaltyArea, isBetweenPosts } from './pitch.js';
import { normalizeStat, blunder } from './skill.js';

export const GRAVITY = 9.81;

export const AERIAL = Object.freeze({
  footMax: 0.7, // m: di bawah ini kaki bisa mengontrol
  headMin: 0.9,
  headMax: 2.6,
  keeperMax: 3.0, // kiper melompat dengan tangan
  crossbar: 2.44,
  contestRadius: 1.4, // m mendatar dari bola
  bounceKeep: 0.35, // bagian vz yang tersisa setelah memantul
  bounceSlow: 0.65, // bagian laju mendatar yang tersisa setelah memantul
  settleVz: 1.5, // di bawah ini pantulan berhenti, bola menggelinding
  // Skor duel udara.
  duelWeight: 1.0,
  strengthWeight: 0.3,
  readWeight: 0.2, // Antisipasi: membaca jatuhnya bola
  distanceWeight: 0.5, // dikurangi per contestRadius jarak
  keeperHandsBonus: 0.6,
  noise: 0.35, // 18 vs 6 (posisi sama) ≈ 90% menang; selisih 2 ≈ 58%
  // Kiper: peluang menangkap bola udara (sisanya ditinju).
  keeperCatchWorst: 0.55,
  keeperCatchBest: 0.9,
});

// Umpan silang.
export const CROSS = Object.freeze({
  arrivalHeight: 1.8, // m: bola tiba setinggi kepala
  baseFlight: 0.8, // detik dasar + per meter
  flightPerMeter: 0.025,
  errorScale: 1.6, // umpan silang lebih sulit dari operan tanah (× blunder Passing)
});

// Sundulan.
export const HEADER = Object.freeze({
  shotSpeedMin: 13,
  shotSpeedMax: 16,
  shotMaxDistance: 14, // m ke tengah gawang: lebih jauh dari ini tidak menyundul ke gawang
  clearSpeedMin: 12,
  clearSpeedMax: 16,
  clearLift: 4, // m/s naik: sundulan sapuan sedikit melambung
  knockSpeed: 6, // sundulan biasa (bukan ke gawang): bola jatuh pelan
  postInset: 0.7,
});

export function isAirborne(ball) {
  return (ball.z ?? 0) > 0 || (ball.vz ?? 0) > 0;
}

// Satu langkah bola udara. Mengembalikan posisi dan laju baru.
export function airStep(ball, dt) {
  if (!(dt > 0)) throw new RangeError(`airStep: dt tidak valid ${dt}`);
  const z0 = ball.z ?? 0;
  const vz0 = ball.vz ?? 0;
  let x = ball.x + ball.vx * dt;
  let y = ball.y + ball.vy * dt;
  let vx = ball.vx;
  let vy = ball.vy;
  let vz = vz0 - GRAVITY * dt;
  let z = z0 + vz0 * dt - 0.5 * GRAVITY * dt * dt;
  if (z <= 0) {
    // Memantul.
    const bounced = -vz * AERIAL.bounceKeep;
    z = 0;
    vx *= AERIAL.bounceSlow;
    vy *= AERIAL.bounceSlow;
    vz = bounced < AERIAL.settleVz ? 0 : bounced;
  }
  return { x, y, z, vx, vy, vz };
}

// Tinggi bola di tengah langkah (u = 0..1), untuk duel di sepanjang lintasan.
export function heightAt(ball, dt, u) {
  const t = dt * u;
  return Math.max(0, (ball.z ?? 0) + (ball.vz ?? 0) * t - 0.5 * GRAVITY * t * t);
}

// Titik jatuh: kapan & di mana bola turun melewati batas kepala (atau menyentuh
// tanah kalau tidak setinggi itu). Dipakai pemain untuk menunggu bola.
export function dropPoint(ball) {
  const z = ball.z ?? 0;
  const vz = ball.vz ?? 0;
  // z + vz t − g t²/2 = level → akar terbesar (saat turun).
  const descentTime = (level) => {
    const disc = vz * vz + 2 * GRAVITY * (z - level);
    return disc >= 0 ? (vz + Math.sqrt(disc)) / GRAVITY : null;
  };
  // Tunggu bola setinggi kepala; kalau bola tidak setinggi itu, tunggu di titik jatuhnya.
  const time = Math.max(0, (z >= CROSS.arrivalHeight || vz > 0 ? descentTime(CROSS.arrivalHeight) : null) ?? descentTime(0) ?? 0);
  return { point: clampToPitch({ x: ball.x + ball.vx * time, y: ball.y + ball.vy * time }), time };
}

// Laju lambungan dari `from` agar tiba di `to` setinggi kepala.
export function loftVelocity(from, to, arrivalHeight = CROSS.arrivalHeight) {
  const d = distance(from, to);
  if (!(d > 0)) throw new Error('loftVelocity: jarak nol');
  const T = CROSS.baseFlight + CROSS.flightPerMeter * d;
  const vh = d / T;
  const vz = (arrivalHeight + 0.5 * GRAVITY * T * T) / T;
  return { vx: ((to.x - from.x) / d) * vh, vy: ((to.y - from.y) / d) * vh, vz, flightTime: T };
}

// Umpan silang yang sebenarnya, dengan meleset dari stat Passing (diperbesar kondisi).
export function crossVelocity(from, to, passer, rng, scale = 1) {
  const ideal = loftVelocity(from, to);
  const angleError = rng.normal(0, blunder(passer, 'passAngle') * CROSS.errorScale * scale);
  const lengthError = Math.max(0.6, 1 + rng.normal(0, blunder(passer, 'passSpeed') * CROSS.errorScale * scale));
  const cos = Math.cos(angleError);
  const sin = Math.sin(angleError);
  return {
    vx: (ideal.vx * cos - ideal.vy * sin) * lengthError,
    vy: (ideal.vx * sin + ideal.vy * cos) * lengthError,
    vz: ideal.vz,
  };
}

function canReachInAir(player, point, z) {
  const keeperHands = player.role === 'GK' && insideOwnPenaltyArea(point, player.attacksRight);
  if (keeperHands) return z <= AERIAL.keeperMax;
  return z >= AERIAL.headMin && z <= AERIAL.headMax;
}

function horizontalReach(player, point) {
  if (player.role === 'GK' && insideOwnPenaltyArea(point, player.attacksRight)) {
    return Math.max(AERIAL.contestRadius, player.profile?.keeperReach ?? AERIAL.contestRadius);
  }
  return AERIAL.contestRadius;
}

// Pemain yang bisa menjangkau bola di udara selama langkah from→to.
// Mengembalikan [{ player, u, d, point, z }] (satu entri per pemain, titik terdekatnya).
export function aerialCandidates(ball, to, dt, players, canTouch) {
  const sx = to.x - ball.x;
  const sy = to.y - ball.y;
  const lengthSq = sx * sx + sy * sy;
  const result = [];
  for (const player of players) {
    if (!canTouch(player)) continue;
    let u = lengthSq > 0 ? ((player.x - ball.x) * sx + (player.y - ball.y) * sy) / lengthSq : 0;
    u = Math.min(1, Math.max(0, u));
    const point = { x: ball.x + sx * u, y: ball.y + sy * u };
    const d = Math.hypot(player.x - point.x, player.y - point.y);
    if (d > horizontalReach(player, point)) continue;
    const z = heightAt(ball, dt, u);
    if (!canReachInAir(player, point, z)) continue;
    result.push({ player, u, d, point, z });
  }
  return result;
}

// Skor duel udara satu pemain. physical: pengali kelelahan (≤ 1).
export function aerialScore(candidate, rng, physical = 1) {
  const { player, d, point } = candidate;
  const s = player.skills;
  let score =
    (AERIAL.duelWeight * normalizeStat(s.duelUdara) + AERIAL.strengthWeight * normalizeStat(s.kekuatan)) * physical +
    AERIAL.readWeight * normalizeStat(s.antisipasi) -
    AERIAL.distanceWeight * (d / AERIAL.contestRadius);
  if (player.role === 'GK' && insideOwnPenaltyArea(point, player.attacksRight)) score += AERIAL.keeperHandsBonus;
  return score + rng.normal(0, AERIAL.noise);
}

// Pemenang duel udara (atau null kalau tidak ada kandidat).
export function resolveAerial(candidates, rng, physicalOf = () => 1) {
  if (candidates.length === 0) return null;
  let best = null;
  for (const c of candidates) {
    const score = aerialScore(c, rng, physicalOf(c.player));
    if (!best || score > best.score) best = { ...c, score };
  }
  return best;
}

export function keeperCatchChance(keeper) {
  const t = Number.isFinite(keeper.skills?.tangkapan) ? normalizeStat(keeper.skills.tangkapan) : 0.5;
  return AERIAL.keeperCatchWorst + (AERIAL.keeperCatchBest - AERIAL.keeperCatchWorst) * t;
}

// Sundulan ke gawang: bidik sisi jauh dari kiper, meleset dari stat Duel udara.
export function headerShotVelocity(from, attacksRight, keeper, rng, scale = 1, player) {
  const goalX = attacksRight ? PITCH.length : 0;
  const mid = PITCH.width / 2;
  const inner = PITCH.goalWidth / 2 - HEADER.postInset;
  const keeperY = keeper ? keeper.y : mid;
  const aim = { x: goalX, y: keeperY <= mid ? mid + inner : mid - inner };
  const base = Math.atan2(aim.y - from.y, aim.x - from.x);
  const angle = base + rng.normal(0, blunder(player, 'headerSpread') * scale);
  const speed = rng.range(HEADER.shotSpeedMin, HEADER.shotSpeedMax);
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  const crossingY = (goalX - from.x) * vx > 0 ? from.y + vy * ((goalX - from.x) / vx) : NaN;
  return { vx, vy, onTarget: isBetweenPosts(crossingY) };
}

// Sundulan sapuan: menjauhi gawang sendiri, sedikit melambung.
export function headerClearVelocity(player, rng) {
  const away = player.attacksRight ? 0 : Math.PI;
  const angle = away + rng.range(-1, 1);
  const speed = rng.range(HEADER.clearSpeedMin, HEADER.clearSpeedMax);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, vz: HEADER.clearLift };
}

// Sundulan biasa: bola jatuh pelan ke arah serang.
export function headerKnockVelocity(player, rng) {
  const forward = player.attacksRight ? 0 : Math.PI;
  const angle = forward + rng.range(-1.2, 1.2);
  return { vx: Math.cos(angle) * HEADER.knockSpeed, vy: Math.sin(angle) * HEADER.knockSpeed, vz: 0 };
}

export function inHeaderShotRange(point, attacksRight) {
  const goal = { x: attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  return distance(point, goal) <= HEADER.shotMaxDistance;
}

export function validateAirBall(ball) {
  const errors = [];
  const z = ball.z ?? 0;
  const vz = ball.vz ?? 0;
  if (!Number.isFinite(z) || z < 0) errors.push(`tinggi bola tidak valid (${z})`);
  if (!Number.isFinite(vz)) errors.push(`laju naik bola tidak valid (${vz})`);
  if (isAirborne(ball) && ball.ownerId !== null) errors.push('bola di udara tetapi dikuasai pemain');
  if (isAirborne(ball) && ball.restartTeamId !== null) errors.push('bola di udara tetapi bola mati');
  if (ball.crossTeamId !== null && ball.crossTeamId !== undefined && !isAirborne(ball) && ball.ownerId !== null) {
    errors.push('crossTeamId tersisa setelah bola dikuasai');
  }
  return errors;
}
