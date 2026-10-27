// Pembagian tugas "siapa yang menjemput bola" per tim
// (docs/dokumen-arah-game.md, logika gerak prinsip 5: hanya 1–2 pemain
// per tim yang mengejar bola, sisanya menjaga bentuk).
//
// Pemilihan memakai WAKTU, bukan jarak: pemain cepat yang sedikit lebih
// jauh bisa lebih dulu sampai daripada pemain lambat yang lebih dekat.

import { PITCH, clampToPitch, distance, forwardOf } from './pitch.js';
import { ballSpeed, predictBallPosition, STOP_SPEED } from './ball.js';
import { DT, REACTION_TIME, CONTROL_RADIUS } from './constants.js';
import { travelTime } from './movement.js';

const MAX_LOOKAHEAD = 4; // detik
// Komitmen (prinsip 4): pengejar lama hanya diganti kalau ada rekan
// yang jelas lebih cepat, bukan sekadar sedikit lebih cepat.
const ROLE_HYSTERESIS = 0.35; // detik
const PRESS_OFFSET = 1.2; // meter di depan pemegang bola, di sisi gawang sendiri

// Waktu sampai ke dalam jangkauan kaki dari sebuah titik.
// Pemain yang SUDAH berada dalam jangkauan tidak perlu bereaksi: bola yang
// lewat di situ akan mengenai kakinya (sama dengan aturan fisika di touch.js).
export function reachTime(player, point) {
  const gap = Math.max(0, distance(player, point) - CONTROL_RADIUS);
  if (gap === 0) return 0;
  return travelTime(player.profile, gap) + REACTION_TIME;
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

function insideOwnPenaltyArea(point, attacksRight) {
  const depth = forwardOf(point, attacksRight);
  const halfWidth = PITCH.penaltyAreaWidth / 2;
  return depth <= PITCH.penaltyAreaDepth && Math.abs(point.y - PITCH.width / 2) <= halfWidth;
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
