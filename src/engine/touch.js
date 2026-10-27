// Siapa yang menyentuh bola duluan?
//
// Dalam satu tick (0,1 detik) bola cepat bisa berpindah 2–3 meter.
// Kalau hanya posisi akhir bola yang dicek, bola bisa "menembus" kaki
// pemain. Jadi yang dicek adalah seluruh lintasan bola selama tick itu:
// pemain mana yang berada dalam jangkauan dari garis lintasan,
// dan siapa yang dilewati bola lebih dulu.

import { controlRadiusAt } from './control.js';

const EPSILON = 1e-9;

export function findController(from, to, players, canControl) {
  if (typeof canControl !== 'function') throw new TypeError('findController: canControl harus fungsi');

  const sx = to.x - from.x;
  const sy = to.y - from.y;
  const lengthSq = sx * sx + sy * sy;
  let best = null;

  for (const player of players) {
    if (!canControl(player)) continue;

    // Posisi relatif titik terdekat di lintasan: 0 = awal tick, 1 = akhir tick.
    let u = lengthSq > 0 ? ((player.x - from.x) * sx + (player.y - from.y) * sy) / lengthSq : 0;
    u = Math.min(1, Math.max(0, u));

    const closest = { x: from.x + sx * u, y: from.y + sy * u };
    const d = Math.hypot(player.x - closest.x, player.y - closest.y);
    if (d > controlRadiusAt(player, closest)) continue;

    const earlier = !best || u < best.u - EPSILON;
    const sameMomentButCloser = best && Math.abs(u - best.u) <= EPSILON && d < best.d;
    if (earlier || sameMomentButCloser) best = { player, u, d };
  }

  // u ikut dikembalikan supaya pemanggil bisa membandingkan urutan kejadian
  // (misalnya: bola melewati garis gawang dulu, atau tersentuh kiper dulu?).
  return best ? { player: best.player, u: best.u } : null;
}
