// Uji engine tanpa tampilan (prinsip arsitektur no. 5).
// Jalankan: npm run check

import { FORMATIONS, validateFormation } from '../src/engine/formations.js';
import { createDemoTeams } from '../src/engine/teams.js';
import { createMatchState, validateMatchState } from '../src/engine/state.js';
import { createSimulation } from '../src/engine/simulation.js';
import { createRng } from '../src/engine/rng.js';
import { TICK_RATE } from '../src/engine/constants.js';
import { computeAnchor } from '../src/engine/shape.js';
import { PITCH } from '../src/engine/pitch.js';

let failures = 0;

function check(label, errors) {
  if (errors.length === 0) {
    console.log(`  OK    ${label}`);
  } else {
    failures += 1;
    console.log(`  GAGAL ${label}`);
    for (const e of errors.slice(0, 10)) console.log(`        - ${e}`);
    if (errors.length > 10) console.log(`        … dan ${errors.length - 10} lagi`);
  }
}

console.log('Formasi');
for (const name of Object.keys(FORMATIONS)) check(name, validateFormation(name));

console.log('State awal');
const { home, away } = createDemoTeams(2026);
const state = createMatchState(home, away);
check('22 pemain, invariant lengkap', validateMatchState(state, [home, away]));

console.log('Seed');
const a = createRng(42);
const b = createRng(42);
const sameSequence = Array.from({ length: 50 }, () => a.next() === b.next()).every(Boolean);
check('seed sama menghasilkan urutan sama', sameSequence ? [] : ['urutan berbeda']);

const teamsAgain = createDemoTeams(2026);
const sameTeams = JSON.stringify(teamsAgain) === JSON.stringify({ home, away });
check('tim yang sama dari seed yang sama', sameTeams ? [] : ['tim berbeda']);

console.log('Bentuk tim (jangkar formasi)');
{
  // Untuk setiap posisi bola di seluruh lapangan, lini yang berbeda
  // (selisih kedalaman slot ≥ 0.1) harus tetap terpisah minimal 5 meter.
  const MIN_LINE_GAP = 5;
  const errors = [];
  const s0 = createMatchState(home, away);
  for (let bx = 0; bx <= PITCH.length; bx += 5) {
    for (let by = 0; by <= PITCH.width; by += 4) {
      for (const teamId of Object.keys(s0.teams)) {
        const { attacksRight } = s0.teams[teamId];
        const own = s0.players.filter((p) => p.teamId === teamId && p.role !== 'GK');
        const anchors = own.map((p) => {
          const a = computeAnchor(p, { x: bx, y: by }, attacksRight);
          return { p, depthX: attacksRight ? a.x : PITCH.length - a.x };
        });
        for (const A of anchors) {
          for (const B of anchors) {
            if (B.p.slot.depth - A.p.slot.depth >= 0.1 && B.depthX - A.depthX < MIN_LINE_GAP) {
              errors.push(`bola (${bx},${by}) ${A.p.id}/${B.p.id}: jarak lini ${(B.depthX - A.depthX).toFixed(1)} m`);
            }
          }
        }
      }
    }
  }
  check(`lini tidak menumpuk di posisi bola mana pun (min ${MIN_LINE_GAP} m)`, errors);
}

console.log('Simulasi (tahap 2)');
const MATCH_TICKS = 90 * 60 * TICK_RATE; // 90 menit waktu simulasi

function runMatch(seed) {
  const teams = createDemoTeams(2026);
  const sim = createSimulation(teams.home, teams.away, seed);
  const errors = [];
  let ballMoves = 0;
  let maxPlayerSpeed = 0;
  let previousBallMoving = false;

  for (let i = 0; i < MATCH_TICKS; i += 1) {
    const s = sim.step();
    for (const e of validateMatchState(s)) errors.push(`tick ${s.tick}: ${e}`);
    if (errors.length > 50) break;

    const moving = Math.hypot(s.ball.vx, s.ball.vy) > 0;
    if (moving && !previousBallMoving) ballMoves += 1;
    previousBallMoving = moving;

    for (const p of s.players) maxPlayerSpeed = Math.max(maxPlayerSpeed, Math.hypot(p.vx, p.vy));
  }

  return { final: sim.getState(), errors, ballMoves, maxPlayerSpeed };
}

const run1 = runMatch(7);
check(`invariant terjaga selama ${MATCH_TICKS} tick (90 menit)`, run1.errors);
check(
  `bola benar-benar bergerak (${run1.ballMoves} kali ditendang)`,
  run1.ballMoves > 100 ? [] : [`hanya ${run1.ballMoves} kali`],
);
check(
  `pemain benar-benar bergerak (laju tertinggi ${run1.maxPlayerSpeed.toFixed(2)} m/s)`,
  run1.maxPlayerSpeed > 3 ? [] : ['pemain hampir tidak bergerak'],
);

const run2 = runMatch(7);
check(
  'seed sama → pertandingan identik',
  JSON.stringify(run1.final) === JSON.stringify(run2.final) ? [] : ['hasil berbeda'],
);

const run3 = runMatch(8);
check(
  'seed beda → pertandingan beda',
  JSON.stringify(run1.final) !== JSON.stringify(run3.final) ? [] : ['hasil sama padahal seed beda'],
);

if (failures > 0) {
  console.log(`\n${failures} pemeriksaan gagal.`);
  process.exit(1);
}
console.log('\nSemua pemeriksaan lolos.');
