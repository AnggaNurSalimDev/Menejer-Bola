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
import { blunder } from './skill.js';

const EASY_CATCH_SPEED = 10; // m/s: di bawah ini selalu tertangkap
const CATCH_FALLOFF = 20; // m/s: peluang tangkap turun linear sepanjang rentang ini
const MIN_CATCH_CHANCE = 0.2;

const PARRY_SPEED_MIN = 0.25; // bagian dari laju datang
const PARRY_SPEED_MAX = 0.45;
const PARRY_SPREAD = (70 * Math.PI) / 180; // ±70° dari arah ke lapangan

// Peluang menangkap: turun untuk bola kencang, digeser oleh stat Tangkapan
// (kalau kiper diberikan; tanpa kiper = kiper rata-rata).
export function catchChance(ballSpeed, keeper = null) {
  if (!(ballSpeed >= 0)) throw new RangeError(`catchChance: laju tidak valid ${ballSpeed}`);
  const bonus = keeper ? blunder(keeper, 'catchBonus') : 0;
  const raw = 1 - (ballSpeed - EASY_CATCH_SPEED) / CATCH_FALLOFF + bonus;
  return Math.min(1, Math.max(MIN_CATCH_CHANCE, raw));
}

// Tepisan melebar (29 Okt): dulu tepisan SELALU kembali ke lapangan, sehingga sepak pojok hampir
// tidak pernah terjadi (~0,1 per laga; nyata ~10). Kini sebagian tepisan didorong melebar ke samping
// gawang → keluar lewat garis gawang → sepak pojok.
export const PARRY_WIDE_CHANCE = 0.4;

// ballY (opsional): posisi bola saat ditepis, untuk memilih sisi tepisan melebar.
export function parryVelocity(keeper, ballSpeed, rng, ballY = null) {
  const base = keeper.attacksRight ? 0 : Math.PI; // ke arah lapangan, menjauhi gawang sendiri
  if (rng.chance(PARRY_WIDE_CHANCE)) {
    // Ke samping, sedikit ke belakang (ke arah garis gawang sendiri).
    const mid = 34;
    const side = (ballY ?? keeper.y) >= mid ? 1 : -1;
    const backward = keeper.attacksRight ? -1 : 1;
    const angle = Math.atan2(side, backward * rng.range(0.7, 1.6));
    const speed = ballSpeed * rng.range(PARRY_SPEED_MIN, PARRY_SPEED_MAX);
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }
  const angle = base + rng.range(-PARRY_SPREAD, PARRY_SPREAD);
  const speed = ballSpeed * rng.range(PARRY_SPEED_MIN, PARRY_SPEED_MAX);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

export function isKeeperHandling(player, ballPoint) {
  return player.role === 'GK' && insideOwnPenaltyArea(ballPoint, player.attacksRight);
}
