// Pembagian tugas "siapa yang menjemput bola" per tim
// (docs/dokumen-arah-game.md, logika gerak prinsip 5: hanya 1–2 pemain
// per tim yang mengejar bola, sisanya menjaga bentuk).
//
// Pemilihan memakai WAKTU, bukan jarak: pemain cepat yang sedikit lebih
// jauh bisa lebih dulu sampai daripada pemain lambat yang lebih dekat.

import { PITCH, clampToPitch, distance, insideOwnPenaltyArea } from './pitch.js';
import { ballSpeed, predictBallPosition, STOP_SPEED } from './ball.js';
import { DT, REACTION_TIME } from './constants.js';
import { travelTime } from './movement.js';
import { controlRadiusAt } from './control.js';

const MAX_LOOKAHEAD = 4; // detik
// Komitmen (prinsip 4): pengejar lama hanya diganti kalau ada rekan
// yang jelas lebih cepat, bukan sekadar sedikit lebih cepat.
const ROLE_HYSTERESIS = 0.35; // detik
const PRESS_OFFSET = 1.2; // meter di depan pemegang bola, di sisi gawang sendiri

// Waktu sampai ke dalam jangkauan sebuah titik (kaki, atau tangan kiper).
// Pemain yang SUDAH berada dalam jangkauan tidak perlu bereaksi: bola yang
// lewat di situ akan mengenainya (sama dengan aturan fisika di touch.js).
//
// Catatan (27 Okt): sempat dicoba memperhitungkan laju awal pemain (travelTime
// mendukung v0). Hasilnya umpan terobosan tidak membaik, tetapi tim yang lebih
// bagus jadi terlalu dominan (kejutan 13 vs 11 turun dari 13% ke 6%). Jadi otak
// pemain tetap memperkirakan dari keadaan diam.
export function reachTime(player, point) {
  const gap = Math.max(0, distance(player, point) - controlRadiusAt(player, point));
  if (gap === 0) return 0;
  return travelTime(player.profile, gap) + (player.profile.reaction ?? REACTION_TIME);
}

// Titik paling awal di lintasan bola yang bisa dicapai pemain tepat waktu.
export function interceptFor(player, ball) {
  if (ballSpeed(ball) < STOP_SPEED) {
    const point = clampToPitch(ball);
    return { point, time: reachTime(player, point) };
  }

  for (let step = 0; step * DT <= MAX_LOOKAHEAD + 1e-9; step += 1) {
    const t = step * DT;
    const point = clampToPitch(predictBallPosition(ball, t));
    if (reachTime(player, point) <= t) return { point, time: t };
  }

  const point = clampToPitch(predictBallPosition(ball, MAX_LOOKAHEAD));
  return { point, time: Math.max(MAX_LOOKAHEAD, reachTime(player, point)) };
}

function pickWithHysteresis(candidates, previousId) {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const c of candidates) if (c.time < best.time) best = c;

  const previous = candidates.find((c) => c.player.id === previousId);
  if (previous && previous.time <= best.time + ROLE_HYSTERESIS) return previous;
  return best;
}

// Bola bebas atau sedang dioper: siapa yang paling cepat sampai.
// Kiper hanya keluar menjemput bola di kotak penaltinya sendiri.
export function pickChaser(teamPlayers, ball, attacksRight, previousId) {
  const candidates = [];
  for (const player of teamPlayers) {
    const intercept = interceptFor(player, ball);
    if (player.role === 'GK' && !insideOwnPenaltyArea(intercept.point, attacksRight)) continue;
    candidates.push({ player, point: intercept.point, time: intercept.time });
  }
  return pickWithHysteresis(candidates, previousId);
}

// Bola dikuasai lawan: siapa yang menekan pemegang bola.
export function pickPresser(teamPlayers, holder, attacksRight, previousId) {
  const ownGoal = { x: attacksRight ? 0 : PITCH.length, y: PITCH.width / 2 };
  const toGoal = distance(holder, ownGoal);
  const point = clampToPitch(
    toGoal > 0
      ? {
          x: holder.x + ((ownGoal.x - holder.x) / toGoal) * PRESS_OFFSET,
          y: holder.y + ((ownGoal.y - holder.y) / toGoal) * PRESS_OFFSET,
        }
      : holder,
  );

  const candidates = teamPlayers
    .filter((player) => player.role !== 'GK')
    .map((player) => ({ player, point, time: reachTime(player, point) }));
  return pickWithHysteresis(candidates, previousId);
}
