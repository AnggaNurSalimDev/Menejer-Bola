// Aturan khusus kiper.
//
// Menangkap atau menepis: makin kencang tembakan, makin kecil peluang kiper
// menangkapnya. Kalau tidak tertangkap, bola ditepis menjauhi gawang dan
// menjadi bola muntah yang bisa diperebutkan.
// (Stat kiper Refleks/Tangkapan akan memengaruhi ini di tahap blunder.)
//
// Bola di tangan: kiper yang memegang bola di kotak penaltinya sendiri tidak
// boleh ditekel dan tidak ditekan; lawan mundur ke posisinya.

import { insideOwnPenaltyArea } from './pitch.js';

const EASY_CATCH_SPEED = 10; // m/s: di bawah ini selalu tertangkap
const CATCH_FALLOFF = 20; // m/s: peluang tangkap turun linear sepanjang rentang ini
const MIN_CATCH_CHANCE = 0.2;

const PARRY_SPEED_MIN = 0.25; // bagian dari laju datang
const PARRY_SPEED_MAX = 0.45;
const PARRY_SPREAD = (70 * Math.PI) / 180; // ±70° dari arah ke lapangan

export function catchChance(ballSpeed) {
  if (!(ballSpeed >= 0)) throw new RangeError(`catchChance: laju tidak valid ${ballSpeed}`);
  const raw = 1 - (ballSpeed - EASY_CATCH_SPEED) / CATCH_FALLOFF;
  return Math.min(1, Math.max(MIN_CATCH_CHANCE, raw));
}

export function parryVelocity(keeper, ballSpeed, rng) {
  const base = keeper.attacksRight ? 0 : Math.PI; // ke arah lapangan, menjauhi gawang sendiri
  const angle = base + rng.range(-PARRY_SPREAD, PARRY_SPREAD);
  const speed = ballSpeed * rng.range(PARRY_SPEED_MIN, PARRY_SPEED_MAX);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

export function isKeeperHandling(player, ballPoint) {
  return player.role === 'GK' && insideOwnPenaltyArea(ballPoint, player.attacksRight);
}
