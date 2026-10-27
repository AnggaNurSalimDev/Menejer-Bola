// Uji engine tanpa tampilan (prinsip arsitektur no. 5).
// Jalankan: npm run check
//
// Dua jenis pemeriksaan:
//   - invariant  : hal yang TIDAK BOLEH dilanggar (gagal = bug)
//   - kewajaran  : angka hasil 90 menit harus masuk rentang yang masuk akal.
//                  Rentangnya tebakan awal, boleh disesuaikan setelah ditonton.

import { FORMATIONS, validateFormation } from '../src/engine/formations.js';
import { createDemoTeams } from '../src/engine/teams.js';
import { createMatchState, validateMatchState } from '../src/engine/state.js';
import { createSimulation } from '../src/engine/simulation.js';
import { createRng } from '../src/engine/rng.js';
import { TICK_RATE } from '../src/engine/constants.js';
import { computeAnchor, PHASES } from '../src/engine/shape.js';
import { PITCH } from '../src/engine/pitch.js';
import { rollBall, predictBallPosition, timeToTravel, passSpeedForDistance } from '../src/engine/ball.js';
import { findController } from '../src/engine/touch.js';
import { goalLineCrossing } from '../src/engine/simulation.js';
import { isBetweenPosts } from '../src/engine/pitch.js';
import { tackleSuccessChance } from '../src/engine/tackle.js';

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

// Kewajaran = peringatan, bukan kegagalan: rentangnya tebakan, bukan aturan.
let warnings = 0;
function inRange(label, value, min, max, format = (v) => v.toFixed(1)) {
  const text = `${label}: ${format(value)} (wajar ${format(min)}–${format(max)})`;
  if (value >= min && value <= max) {
    console.log(`  OK    ${text}`);
  } else {
    warnings += 1;
    console.log(`  AWAS  ${text}`);
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
check('tim yang sama dari seed yang sama', JSON.stringify(teamsAgain) === JSON.stringify({ home, away }) ? [] : ['tim berbeda']);

console.log('Fisika bola');
{
  // Gelinding per tick harus berakhir di titik yang sama dengan prediksi.
  const errors = [];
  let ball = { x: 10, y: 10, vx: 12, vy: 5 };
  const start = { ...ball };
  for (let i = 1; i <= 30; i += 1) {
    ball = rollBall(ball, 1 / TICK_RATE);
    const predicted = predictBallPosition(start, i / TICK_RATE);
    if (Math.hypot(ball.x - predicted.x, ball.y - predicted.y) > 1e-6) errors.push(`tick ${i}: selisih prediksi`);
  }
  check('gelinding per tick = prediksi', errors);

  // Operan sampai ke tujuan dengan laju yang dihitung.
  const errs2 = [];
  for (const d of [5, 15, 30, 42]) {
    const t = timeToTravel(d, passSpeedForDistance(d));
    if (!Number.isFinite(t)) errs2.push(`operan ${d} m tidak sampai`);
  }
  check('operan 5–42 m selalu sampai', errs2);

  // Bola cepat tidak boleh "menembus" kaki pemain.
  const player = { id: 'p', role: 'CM', attacksRight: true, x: 5, y: 0.5 };
  const hit = findController({ x: 30, y: 30 }, { x: 40, y: 30 }, [{ ...player, x: 35, y: 30.5 }], () => true);
  check('bola cepat yang lewat di dekat kaki tetap tersentuh', hit ? [] : ['tidak terdeteksi']);

  // Kiper menjangkau lebih jauh, tapi hanya di kotak penaltinya sendiri.
  const keeperInBox = { id: 'k', role: 'GK', attacksRight: true, x: 3, y: 34 };
  const keeperOut = { ...keeperInBox, x: 40 };
  const passBox = findController({ x: 3, y: 35.6 }, { x: 3, y: 35.7 }, [keeperInBox], () => true);
  const passOut = findController({ x: 40, y: 35.6 }, { x: 40, y: 35.7 }, [keeperOut], () => true);
  check(
    'kiper menjangkau lebih jauh di kotaknya, tidak di luar kotak',
    passBox && !passOut ? [] : [`di kotak: ${!!passBox}, di luar: ${!!passOut}`],
  );
}

console.log('Gol dan tekel');
{
  const errors = [];
  const mid = PITCH.width / 2;
  const inGoal = goalLineCrossing({ x: 104, y: mid }, { x: 106, y: mid + 1 });
  if (!inGoal || inGoal.lineX !== PITCH.length || !isBetweenPosts(inGoal.y)) errors.push('bola masuk gawang kanan tidak terdeteksi');
  const wide = goalLineCrossing({ x: 104, y: mid + 6 }, { x: 106, y: mid + 6 });
  if (!wide || isBetweenPosts(wide.y)) errors.push('bola melebar dianggap masuk');
  if (goalLineCrossing({ x: 50, y: mid }, { x: 105, y: mid }) !== null) errors.push('bola tepat di garis dianggap melewati');
  check('deteksi gol lewat garis di antara tiang', errors);

  const makeSkills = (tackling, dribbling, kekuatan) => ({ skills: { tackling, dribbling, kekuatan } });
  const strongDefender = { id: 'd', ...makeSkills(18, 10, 15) };
  const weakDefender = { id: 'd2', ...makeSkills(6, 10, 8) };
  const holder = { id: 'h', ...makeSkills(10, 12, 12) };
  const strong = tackleSuccessChance(strongDefender, holder);
  const weak = tackleSuccessChance(weakDefender, holder);
  check(
    `tekel: bek kuat lebih sering berhasil (${(strong * 100).toFixed(0)}% vs ${(weak * 100).toFixed(0)}%)`,
    strong > weak && strong <= 0.85 && weak >= 0.15 ? [] : ['urutan atau batas peluang salah'],
  );
}

console.log('Bentuk tim (jangkar formasi)');
{
  // Untuk setiap posisi bola dan setiap fase, lini yang berbeda
  // (selisih kedalaman slot ≥ 0.1) harus tetap terpisah minimal 5 meter.
  const MIN_LINE_GAP = 5;
  const errors = [];
  for (const phase of Object.keys(PHASES)) {
    for (let bx = 0; bx <= PITCH.length; bx += 5) {
      for (let by = 0; by <= PITCH.width; by += 4) {
        for (const teamId of Object.keys(state.teams)) {
          const { attacksRight } = state.teams[teamId];
          const own = state.players.filter((p) => p.teamId === teamId && p.role !== 'GK');
          const anchors = own.map((p) => {
            const anchor = computeAnchor(p, { x: bx, y: by }, attacksRight, phase);
            return { p, depthX: attacksRight ? anchor.x : PITCH.length - anchor.x };
          });
          for (const A of anchors) {
            for (const B of anchors) {
              if (B.p.slot.depth - A.p.slot.depth >= 0.1 && B.depthX - A.depthX < MIN_LINE_GAP) {
                errors.push(`${phase}, bola (${bx},${by}) ${A.p.id}/${B.p.id}: ${(B.depthX - A.depthX).toFixed(1)} m`);
              }
            }
          }
        }
      }
    }
  }
  check(`lini tidak menumpuk di fase & posisi bola mana pun (min ${MIN_LINE_GAP} m)`, errors);
}

console.log('Simulasi 90 menit');
const MATCH_TICKS = 90 * 60 * TICK_RATE;

function runMatch(seed, { validate = true } = {}) {
  const teams = createDemoTeams(2026);
  const sim = createSimulation(teams.home, teams.away, seed);
  const errors = [];
  let stuckTicks = 0;
  let longestStuck = 0;
  let overlapPairs = 0;

  for (let i = 0; i < MATCH_TICKS; i += 1) {
    const s = sim.step();
    if (validate) for (const e of validateMatchState(s)) errors.push(`tick ${s.tick}: ${e}`);
    if (errors.length > 50) break;

    // Bola macet: bebas, diam, dan bukan bola mati.
    const stuck = s.ball.ownerId === null && s.ball.restartTeamId === null && s.ball.vx === 0 && s.ball.vy === 0;
    stuckTicks = stuck ? stuckTicks + 1 : 0;
    longestStuck = Math.max(longestStuck, stuckTicks);

    for (let p = 0; p < s.players.length; p += 1) {
      for (let q = p + 1; q < s.players.length; q += 1) {
        const A = s.players[p];
        const B = s.players[q];
        if (A.teamId === B.teamId && Math.hypot(A.x - B.x, A.y - B.y) < 1) overlapPairs += 1;
      }
    }
  }

  return { final: sim.getState(), errors, longestStuck, overlapPerTick: overlapPairs / MATCH_TICKS };
}

const run1 = runMatch(7);
check(`invariant terjaga selama ${MATCH_TICKS} tick`, run1.errors);

const { stats } = run1.final;
const [homeId, awayId] = Object.keys(run1.final.teams);
const totalPossession = stats.possessionTicks[homeId] + stats.possessionTicks[awayId];
const homeShare = (stats.possessionTicks[homeId] / totalPossession) * 100;

for (const id of [homeId, awayId]) {
  const { attempted, completed } = stats.passes[id];
  console.log(`  info  ${id}: ${completed}/${attempted} operan sukses`);
}
const attempted = stats.passes[homeId].attempted + stats.passes[awayId].attempted;
const completed = stats.passes[homeId].completed + stats.passes[awayId].completed;
console.log(`  info  pergantian penguasaan: ${stats.turnovers}, bola keluar: ${stats.outOfPlay}`);

// Rentang di bawah memperhitungkan bahwa simulasi berjalan 90 menit penuh
// tanpa jeda, sedangkan pertandingan nyata hanya punya ~55–60 menit bola
// bergulir. Contoh: ~450–550 operan per tim di laga nyata setara ~700–850
// dalam 90 menit tanpa henti.
inRange('operan per tim per pertandingan', attempted / 2, 300, 1000, (v) => v.toFixed(0));
inRange('persentase operan sukses', (completed / attempted) * 100, 55, 95, (v) => `${v.toFixed(0)}%`);
inRange('penguasaan bola kandang', homeShare, 25, 75, (v) => `${v.toFixed(0)}%`);
inRange('pergantian penguasaan', stats.turnovers, 40, 500, (v) => v.toFixed(0));
// Selama operan masih sempurna (belum ada noise eksekusi), bola memang
// jarang/tidak pernah keluar. Naikkan batas bawah setelah tahap blunder.
inRange('bola keluar lapangan', stats.outOfPlay, 0, 150, (v) => v.toFixed(0));
inRange('bola macet terlama (detik)', run1.longestStuck / TICK_RATE, 0, 8);
inRange('rata-rata pasangan rekan bertumpuk (<1 m) per tick', run1.overlapPerTick, 0, 0.3, (v) => v.toFixed(2));

// Gol dan tembakan sangat acak per pertandingan, jadi dinilai dari rata-rata
// beberapa pertandingan. Rentang memakai faktor ~1,5× dari angka laga nyata
// (90 menit tanpa jeda vs ~57 menit bola bergulir).
console.log('Rata-rata 8 pertandingan');
{
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  const totals = { goals: 0, shots: 0, onTarget: 0, tackles: 0, tacklesWon: 0 };
  const scores = [];
  for (const seed of SEEDS) {
    const { final } = runMatch(seed, { validate: false });
    const s = final.stats;
    scores.push(`${s.goals[homeId]}-${s.goals[awayId]}`);
    for (const id of [homeId, awayId]) {
      totals.goals += s.goals[id];
      totals.shots += s.shots[id].total;
      totals.onTarget += s.shots[id].onTarget;
      totals.tackles += s.tackles[id].attempted;
      totals.tacklesWon += s.tackles[id].won;
    }
  }
  const matches = SEEDS.length;
  console.log(`  info  skor: ${scores.join(', ')}`);
  inRange('gol per pertandingan (dua tim)', totals.goals / matches, 1.5, 7);
  inRange('tembakan per tim', totals.shots / matches / 2, 6, 35);
  inRange('tembakan tepat sasaran', (totals.onTarget / Math.max(1, totals.shots)) * 100, 20, 60, (v) => `${v.toFixed(0)}%`);
  inRange('gol per tembakan', (totals.goals / Math.max(1, totals.shots)) * 100, 5, 25, (v) => `${v.toFixed(0)}%`);
  inRange('tekel dicoba per tim', totals.tackles / matches / 2, 10, 150, (v) => v.toFixed(0));
  inRange('tekel berhasil', (totals.tacklesWon / Math.max(1, totals.tackles)) * 100, 35, 75, (v) => `${v.toFixed(0)}%`);
}

const run2 = runMatch(7);
check('seed sama → pertandingan identik', JSON.stringify(run1.final) === JSON.stringify(run2.final) ? [] : ['hasil berbeda']);
const run3 = runMatch(8);
check('seed beda → pertandingan beda', JSON.stringify(run1.final) !== JSON.stringify(run3.final) ? [] : ['hasil sama']);
check('seed lain juga lolos invariant', run3.errors);

if (failures > 0) {
  console.log(`\n${failures} pemeriksaan gagal.`);
  process.exit(1);
}
if (warnings > 0) {
  console.log(`\nSemua invariant lolos. ${warnings} angka kewajaran di luar rentang (AWAS) — tonton dan setel.`);
} else {
  console.log('\nSemua pemeriksaan lolos.');
}
