// Simulasi pertandingan: memegang state dan angka acak ber-seed,
// lalu memajukan semuanya satu tick setiap kali step() dipanggil.
// Tidak tahu apa-apa soal tampilan — bisa dijalankan di Node.

import { createRng } from './rng.js';
import { createMatchState } from './state.js';
import { DT, DECISION_INTERVAL_TICKS } from './constants.js';
import { stepBall } from './ball.js';
import { computeAnchor } from './shape.js';
import { stepBody } from './movement.js';

export function createSimulation(home, away, seed) {
  if (!Number.isInteger(seed)) throw new TypeError(`createSimulation: seed harus bilangan bulat, dapat ${seed}`);

  const rng = createRng(seed);
  let state = createMatchState(home, away);

  function step() {
    const tick = state.tick + 1;
    const ball = stepBall(state.ball, rng, DT);

    const players = state.players.map((player, index) => {
      const team = state.teams[player.teamId];
      if (!team) throw new Error(`step: tim "${player.teamId}" tidak ditemukan`);

      // Lapisan keputusan: tiap pemain berpikir ulang setiap beberapa tick,
      // dengan giliran yang berbeda-beda supaya tidak bergerak serempak
      // seperti robot.
      const isDecisionTick = (tick + index) % DECISION_INTERVAL_TICKS === 0;
      const target = isDecisionTick ? computeAnchor(player, ball, team.attacksRight) : player.target;

      // Lapisan gerak: setiap tick.
      const body = stepBody(player, target, DT);
      return { ...player, ...body, target };
    });

    state = { ...state, tick, ball, players };
    return state;
  }

  return {
    getState: () => state,
    step,
  };
}
