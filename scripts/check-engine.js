// Uji engine tanpa tampilan (prinsip arsitektur no. 5).
// Jalankan: npm run check
//
// Dua jenis pemeriksaan:
//   - invariant  : hal yang TIDAK BOLEH dilanggar (gagal = bug)
//   - kewajaran  : angka hasil pertandingan harus masuk rentang target desain.
//                  Rentangnya tebakan awal, boleh disesuaikan setelah ditonton.

import { FORMATIONS, validateFormation } from '../src/engine/formations.js';
import { createDemoTeams } from '../src/engine/teams.js';
import { createMatchState, validateMatchState, gameClock } from '../src/engine/state.js';
import { createSimulation } from '../src/engine/simulation.js';
import { createRng } from '../src/engine/rng.js';
import { TICK_RATE, HALF_TICKS } from '../src/engine/constants.js';
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

console.log('Struktur pertandingan');
{
  const errors = [];
  const teams = createDemoTeams(2026);
  const sim = createSimulation(teams.home, teams.away, 5);
  const homeSideBefore = sim.getState().teams.home.attacksRight;

  let s = sim.getState();
  while (s.period === 'first') s = sim.step();
  if (s.period !== 'halftime') errors.push(`setelah babak 1 seharusnya halftime, dapat ${s.period}`);
  if (s.tick !== HALF_TICKS) errors.push(`babak 1 seharusnya ${HALF_TICKS} tick, dapat ${s.tick}`);
  if (gameClock(s).minute !== 45) errors.push(`jam saat jeda seharusnya 45', dapat ${gameClock(s).minute}'`);

  const frozen = sim.step();
  if (frozen.tick !== s.tick) errors.push('waktu berjalan saat jeda babak');

  s = sim.startSecondHalf();
  if (s.teams.home.attacksRight === homeSideBefore) errors.push('tim tidak bertukar sisi di babak 2');
  if (s.ball.restartTeamId !== 'away') errors.push('kick-off babak 2 bukan oleh tim tamu');
  for (const e of validateMatchState(s)) errors.push(`awal babak 2: ${e}`);

  while (s.period === 'second') s = sim.step();
  if (s.period !== 'fulltime') errors.push(`setelah babak 2 seharusnya fulltime, dapat ${s.period}`);
  if (gameClock(s).minute !== 90) errors.push(`jam akhir seharusnya 90', dapat ${gameClock(s).minute}'`);
  if (sim.step().tick !== s.tick) errors.push('waktu berjalan setelah peluit akhir');

  let threw = false;
  try {
    sim.startSecondHalf();
  } catch {
    threw = true;
  }
  if (!threw) errors.push('startSecondHalf boleh dipanggil setelah peluit akhir');

  check(`2 babak × ${HALF_TICKS / TICK_RATE / 60} menit nyata, jam 0'–90', tukar sisi, jeda membeku`, errors);
}

// Satu pertandingan penuh (babak 1 + babak 2).
function runMatch(seed, { validate = true, homeQuality = 12, awayQuality = 12 } = {}) {
  const teams = createDemoTeams(2026, { homeQuality, awayQuality });
  const sim = createSimulation(teams.home, teams.away, seed);
  const errors = [];
  let stuckTicks = 0;
  let longestStuck = 0;
  let overlapPairs = 0;
  let ticks = 0;

  const watch = (s) => {
    ticks += 1;
    if (validate) for (const e of validateMatchState(s)) errors.push(`tick ${s.tick}: ${e}`);

    // Bola macet: bebas, diam, dan bukan bola mati.
    const stuck = s.ball.ownerId === null && s.ball.restartTeamId === null && s.ball.vx === 0 && s.ball.vy === 0;
    stuckTicks = stuck ? stuckTicks + 1 : 0;
    longestStuck = Math.max(longestStuck, stuckTicks);

    if (!validate) return;
    for (let p = 0; p < s.players.length; p += 1) {
      for (let q = p + 1; q < s.players.length; q += 1) {
        const A = s.players[p];
        const B = s.players[q];
        if (A.teamId === B.teamId && Math.hypot(A.x - B.x, A.y - B.y) < 1) overlapPairs += 1;
      }
    }
  };

  let s = sim.getState();
  while (s.period === 'first' && errors.length <= 50) watch((s = sim.step()));
  if (s.period === 'halftime') s = sim.startSecondHalf();
  while (s.period === 'second' && errors.length <= 50) watch((s = sim.step()));

  return { final: s, errors, longestStuck, overlapPerTick: overlapPairs / Math.max(1, ticks) };
}

function summarize(seeds, options) {
  const t = { goals: 0, homeGoals: 0, awayGoals: 0, homeWins: 0, awayWins: 0, draws: 0 };
  const sums = { shots: 0, onTarget: 0, passes: 0, passesDone: 0, tackles: 0, tacklesWon: 0, turnovers: 0, homePossession: 0 };
  const scores = [];
  for (const seed of seeds) {
    const { final } = runMatch(seed, { ...options, validate: false });
    const st = final.stats;
    const h = st.goals.home;
    const a = st.goals.away;
    scores.push(`${h}-${a}`);
    t.goals += h + a;
    t.homeGoals += h;
    t.awayGoals += a;
    if (h > a) t.homeWins += 1;
    else if (a > h) t.awayWins += 1;
    else t.draws += 1;
    for (const id of ['home', 'away']) {
      sums.shots += st.shots[id].total;
      sums.onTarget += st.shots[id].onTarget;
      sums.passes += st.passes[id].attempted;
      sums.passesDone += st.passes[id].completed;
      sums.tackles += st.tackles[id].attempted;
      sums.tacklesWon += st.tackles[id].won;
    }
    sums.turnovers += st.turnovers;
    sums.homePossession += st.possessionTicks.home / (st.possessionTicks.home + st.possessionTicks.away);
  }
  return { n: seeds.length, scores, ...t, ...sums };
}

console.log('Satu pertandingan penuh');
const run1 = runMatch(7);
check('invariant terjaga di setiap tick kedua babak', run1.errors);
inRange('bola macet terlama (detik nyata)', run1.longestStuck / TICK_RATE, 0, 8);
inRange('rata-rata pasangan rekan bertumpuk (<1 m) per tick', run1.overlapPerTick, 0, 0.3, (v) => v.toFixed(2));
const run2 = runMatch(7);
check('seed sama → pertandingan identik', JSON.stringify(run1.final) === JSON.stringify(run2.final) ? [] : ['hasil berbeda']);
const run3 = runMatch(8);
check('seed beda → pertandingan beda', JSON.stringify(run1.final) !== JSON.stringify(run3.final) ? [] : ['hasil sama']);
check('seed lain juga lolos invariant', run3.errors);

// Target DESAIN game ini (bukan angka sepak bola nyata): pertandingan
// 2 × 5 menit nyata yang padat. Titik nol kalibrasi = dua tim rata-rata.
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
console.log(`Titik nol: tim rata-rata vs tim rata-rata (${SEEDS.length} pertandingan)`);
{
  const r = summarize(SEEDS, {});
  console.log(`  info  skor: ${r.scores.join(', ')}`);
  inRange('gol per pertandingan', r.goals / r.n, 2, 4);
  inRange('tembakan per tim', r.shots / r.n / 2, 5, 15);
  inRange('tembakan tepat sasaran', (r.onTarget / Math.max(1, r.shots)) * 100, 25, 65, (v) => `${v.toFixed(0)}%`);
  inRange('gol per tembakan', (r.goals / Math.max(1, r.shots)) * 100, 8, 30, (v) => `${v.toFixed(0)}%`);
  inRange('operan per tim', r.passes / r.n / 2, 60, 250, (v) => v.toFixed(0));
  inRange('operan sukses', (r.passesDone / Math.max(1, r.passes)) * 100, 55, 92, (v) => `${v.toFixed(0)}%`);
  inRange('tekel dicoba per tim', r.tackles / r.n / 2, 5, 40, (v) => v.toFixed(0));
  inRange('tekel berhasil', (r.tacklesWon / Math.max(1, r.tackles)) * 100, 35, 75, (v) => `${v.toFixed(0)}%`);
  inRange('penguasaan bola kandang (rata-rata)', (r.homePossession / r.n) * 100, 35, 65, (v) => `${v.toFixed(0)}%`);
}

// Dinamika: kualitas skuad harus terasa di hasil, tapi tanpa efek bola salju.
//   15 vs 9  : beda kelas — tim kuat wajar hampir selalu menang
//   13 vs 11 : satu liga — kejutan harus masih sering terjadi
// Untuk angka yang lebih pasti (dengan rentang ketidakpastian): npm run calibrate
for (const [strongQ, weakQ, winRange, lossRange] of [
  [15, 9, [75, 100], [0, 15]],
  [13, 11, [30, 70], [5, 40]],
]) {
  console.log(`Tim ${strongQ} vs tim ${weakQ}, bergantian kandang/tamu (${SEEDS.length} pertandingan)`);
  let strongGoals = 0;
  let weakGoals = 0;
  let strongWins = 0;
  let weakWins = 0;
  for (const seed of SEEDS) {
    const strongIsHome = seed % 2 === 0;
    const { final } = runMatch(seed, {
      validate: false,
      homeQuality: strongIsHome ? strongQ : weakQ,
      awayQuality: strongIsHome ? weakQ : strongQ,
    });
    const strongId = strongIsHome ? 'home' : 'away';
    const weakId = strongIsHome ? 'away' : 'home';
    strongGoals += final.stats.goals[strongId];
    weakGoals += final.stats.goals[weakId];
    if (final.stats.goals[strongId] > final.stats.goals[weakId]) strongWins += 1;
    if (final.stats.goals[weakId] > final.stats.goals[strongId]) weakWins += 1;
  }
  const n = SEEDS.length;
  console.log(
    `  info  gol rata-rata ${(strongGoals / n).toFixed(2)} vs ${(weakGoals / n).toFixed(2)}; ` +
      `menang ${strongWins}, kalah ${weakWins}, seri ${n - strongWins - weakWins}`,
  );
  inRange(`tim ${strongQ} menang`, (strongWins / n) * 100, winRange[0], winRange[1], (v) => `${v.toFixed(0)}%`);
  inRange(`tim ${weakQ} menang (kejutan)`, (weakWins / n) * 100, lossRange[0], lossRange[1], (v) => `${v.toFixed(0)}%`);
  inRange('tim yang lebih bagus mencetak lebih banyak gol', strongGoals - weakGoals, 1, Infinity, (v) => v.toFixed(0));
}

if (failures > 0) {
  console.log(`\n${failures} pemeriksaan gagal.`);
  process.exit(1);
}
if (warnings > 0) {
  console.log(`\nSemua invariant lolos. ${warnings} angka kewajaran di luar rentang (AWAS) — tonton dan setel.`);
} else {
  console.log('\nSemua pemeriksaan lolos.');
}
