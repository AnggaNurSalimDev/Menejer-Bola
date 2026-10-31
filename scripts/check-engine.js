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
import {
  CONDITION,
  BLUNDER_SCALE_MIN,
  BLUNDER_SCALE_MAX,
  blunderScale,
  physicalScale,
  applyConfidenceEvent,
  onFireAmount,
  shotThresholdScale,
} from '../src/engine/condition.js';
import { canPanicClear } from '../src/engine/simulation.js';
import { PHILOSOPHIES, validatePhilosophy } from '../src/engine/philosophy.js';
import { flagChance } from '../src/engine/officials.js';
import { foulChance, cautionScale, callChance, advantageApplies, initialDiscipline, resolveIncident } from '../src/engine/fouls.js';
import { kickoffTargets, pickKickoffTaker, penaltyTargets, pickPenaltyTaker, penaltySpot } from '../src/engine/simulation.js';
import { instinctShotScale } from '../src/engine/condition.js';
import { shotSpeedFor, isScreened, SHOT_POWER } from '../src/engine/shooting.js';
import { createTeam } from '../src/engine/teams.js';
import { blunderFromStats } from '../src/engine/skill.js';
import { lingerTicks, freeKickSettleTargets, AFTER_INCIDENT } from '../src/engine/simulation.js';
import { pickCover } from '../src/engine/roles.js';
import { parryVelocity } from '../src/engine/keeper.js';
import { boxRunSpots } from '../src/engine/simulation.js';
import { reshape, outfieldSlots, tacticsErrors, defaultTactics, teamStyle, TRANSITION, coachTactics, pressAllowedAt, LINE_OPTIONS } from '../src/engine/tactics.js';
import { substitutionErrors, SUBS } from '../src/engine/substitution.js';
import { repairShape, applySendOffs, emergencyKeeper } from '../src/engine/sendoff.js';
import { scuffleTargets, assignScuffleStyles, protestTarget } from '../src/engine/scuffle.js';
import { straightRedChance, yellowChance, isDogso, RED } from '../src/engine/fouls.js';
import { AERIAL, CROSS, airStep, loftVelocity, dropPoint, resolveAerial, isAirborne } from '../src/engine/aerial.js';

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

console.log('Kondisi pemain (tahap 6)');
{
  const skills = (overrides = {}) => ({
    stamina: 12, determinasi: 12, ketenangan: 12, stabilitasMental: 12, konsistensi: 12, egoisme: 12, ...overrides,
  });
  const worst = {
    condition: { energy: 0, confidence: 0, form: CONDITION.formMax, blunders: 9 },
    skills: skills({ ketenangan: 1, determinasi: 1 }),
    profile: { maxSpeed: 8, maxAccel: 4 },
  };
  const ctx = { pressured: true, bigChance: true, trailing: false, minute: 10 };
  const errors = [];
  const b = blunderScale(worst, ctx);
  const ph = physicalScale(worst, ctx);
  if (!(b <= 1 + CONDITION.maxBlunderPenalty + 1e-9)) errors.push(`blunderScale ${b} melewati batas`);
  if (!(ph >= 1 - CONDITION.maxPhysicalPenalty - 1e-9)) errors.push(`physicalScale ${ph} melewati batas`);
  check(`batas nerf: blunder ≤ +${CONDITION.maxBlunderPenalty * 100}%, fisik ≥ −${CONDITION.maxPhysicalPenalty * 100}% di kondisi terburuk`, errors);

  const fresh = { energy: 1, confidence: CONDITION.startConfidence, form: 0, blunders: 0 };
  const fragile = applyConfidenceEvent(fresh, skills({ stabilitasMental: 3 }), 'heavyTouch');
  const steady = applyConfidenceEvent(fresh, skills({ stabilitasMental: 18 }), 'heavyTouch');
  check(
    `stabilitas mental rendah lebih goyah setelah blunder (${fragile.confidence.toFixed(2)} vs ${steady.confidence.toFixed(2)})`,
    fragile.confidence < steady.confidence && fragile.blunders === 1 ? [] : ['urutan salah atau blunder tidak tercatat'],
  );

  const tiredLate = { ...worst, condition: { ...worst.condition, energy: 0.3, confidence: 1, form: 0 }, skills: skills({ determinasi: 20 }) };
  const lateEffect = physicalScale(tiredLate, { trailing: true, minute: 85 });
  const earlyEffect = physicalScale(tiredLate, { trailing: false, minute: 20 });
  check(
    `determinasi menahan lelah saat tertinggal / menit akhir (${lateEffect.toFixed(3)} vs ${earlyEffect.toFixed(3)})`,
    lateEffect > earlyEffect ? [] : ['determinasi tidak berpengaruh'],
  );

  const match = { goals: { home: 0, away: 1 }, minute: 50, teamIds: ['home', 'away'] };
  const defender = { role: 'CB', teamId: 'home', attacksRight: true, condition: { ...fresh, blunders: 1 } };
  const ownHalfBall = { x: 30, y: 30, heldTicks: 2 };
  const e2 = [];
  if (!canPanicClear(defender, ownHalfBall, match)) e2.push('bek tertinggal dengan catatan blunder seharusnya bisa panik');
  if (canPanicClear(defender, ownHalfBall, { ...match, goals: { home: 1, away: 1 } })) e2.push('panik padahal tidak tertinggal');
  if (canPanicClear({ ...defender, condition: fresh }, ownHalfBall, match)) e2.push('panik padahal tanpa catatan blunder');
  if (canPanicClear(defender, { ...ownHalfBall, x: 70 }, match)) e2.push('panik padahal bola di separuh lawan');
  if (canPanicClear({ ...defender, role: 'ST' }, ownHalfBall, match)) e2.push('penyerang ikut panik');
  check('sapuan panik hanya saat tertinggal + catatan blunder + separuh sendiri + pemain bertahan', e2);

  // On fire: bonus kecil, terbatas, hanya di atas ambang.
  const fireBase = { ...worst, condition: { energy: 1, confidence: 1, form: 0, blunders: 0 }, skills: skills() };
  const onFire = blunderScale(fireBase, {});
  const atThreshold = blunderScale({ ...fireBase, condition: { ...fireBase.condition, confidence: CONDITION.fireThreshold } }, {});
  const tiredFire = blunderScale({ ...fireBase, condition: { ...worst.condition, confidence: 1 } }, ctx);
  const e3 = [];
  if (!(Math.abs(onFire - BLUNDER_SCALE_MIN) < 1e-9)) e3.push(`on fire penuh seharusnya ${BLUNDER_SCALE_MIN}, dapat ${onFire}`);
  if (!(atThreshold > onFire)) e3.push('tepat di ambang seharusnya belum dapat bonus penuh');
  if (!(tiredFire >= BLUNDER_SCALE_MIN && tiredFire <= BLUNDER_SCALE_MAX)) e3.push(`pengali di luar batas ${tiredFire}`);
  if (!(onFireAmount({ confidence: 0.8 }) === 0 && onFireAmount({ confidence: 1 }) === 1)) e3.push('onFireAmount salah');
  if (!(shotThresholdScale(fireBase) < shotThresholdScale({ ...fireBase, condition: { ...fireBase.condition, confidence: 0.75 } }))) {
    e3.push('on fire seharusnya lebih berani menembak');
  }
  check(`on fire: blunder ×${onFire.toFixed(2)} di percaya diri 1, tetap dalam batas ${BLUNDER_SCALE_MIN}–${BLUNDER_SCALE_MAX}`, e3);
}

console.log('Filosofi pelatih & tempo');
{
  const e1 = [];
  for (const key of Object.keys(PHILOSOPHIES)) e1.push(...validatePhilosophy(key));
  let threw = false;
  try {
    createTeam({ id: 'x', name: 'X', colors: { shirt: '#000', number: '#fff' }, formation: '4-4-2', quality: 12, seed: 1, philosophy: 'tidak-ada' });
  } catch {
    threw = true;
  }
  if (!threw) e1.push('filosofi tak dikenal seharusnya ditolak');
  check('setiap filosofi hanya memindahkan kekuatan (jumlah geseran stat = 0)', e1);

  const sharp = blunderFromStats({ passing: 20 }, 'passArrival');
  const soft = blunderFromStats({ passing: 1 }, 'passArrival');
  const quick = blunderFromStats({ keputusan: 20 }, 'holdTempo');
  const slow = blunderFromStats({ keputusan: 1 }, 'holdTempo');
  check(
    `tempo dari stat: operan tiba ${soft}–${sharp} m/s, lama menahan ×${slow}–×${quick}`,
    sharp > soft && quick < slow && slow / quick < 1.3 ? [] : ['arah atau rentang tempo dari stat salah'],
  );
}

console.log('Insting gol & tembakan jarak jauh');
{
  const e = [];
  const hungry = { skills: { instingGol: 20 } };
  const shy = { skills: { instingGol: 1 } };
  if (instinctShotScale(hungry, 40) !== 1) e.push('insting berpengaruh padahal masih jauh dari gawang');
  if (!(instinctShotScale(hungry, 18) < instinctShotScale(hungry, 28))) e.push('dorongan tidak naik saat makin dekat');
  if (!(instinctShotScale(hungry, 18) < instinctShotScale(shy, 18))) e.push('Insting 20 tidak lebih berani dari Insting 1');
  const strong = shotSpeedFor({ skills: { finishing: 20, kekuatan: 20 } });
  const weak = shotSpeedFor({ skills: { finishing: 1, kekuatan: 1 } });
  if (!(strong === SHOT_POWER.max && weak === SHOT_POWER.min)) e.push(`rentang tenaga tendangan salah (${weak}–${strong})`);
  const keeper = { role: 'GK', x: 103, y: 34 };
  const origin = { x: 75, y: 34 };
  const aim = { x: 105, y: 31 };
  if (!isScreened(origin, aim, keeper, [{ role: 'CB', x: 90, y: 33 }])) e.push('pemain di jalur tembakan tidak menghalangi');
  if (isScreened(origin, aim, keeper, [{ role: 'CB', x: 90, y: 40 }])) e.push('pemain jauh dari jalur dianggap menghalangi');
  if (isScreened(origin, aim, keeper, [{ role: 'CB', x: 101.5, y: 31.5 }])) e.push('pemain tepat di depan kiper dianggap menghalangi pandangan');
  check(`dorongan menembak naik dekat gawang; tenaga tendangan ${weak}–${strong} m/s; pandangan kiper terhalang`, e);
}

console.log('Wasit, hakim garis & offside (tahap 7a)');
{
  const e = [];
  // Hakim garis: jelas offside hampir selalu dibenderai; jelas sah tidak pernah; kejadian tipis bisa salah.
  const clearOff = flagChance({ margin: 3, misalignment: 0, ketelitian: 12 });
  const clearOn = flagChance({ margin: -3, misalignment: 0, ketelitian: 12 });
  const tightOff = flagChance({ margin: 0.1, misalignment: 0, ketelitian: 12 });
  const tightOn = flagChance({ margin: -0.1, misalignment: 0, ketelitian: 12 });
  const tightOffMisaligned = flagChance({ margin: 0.1, misalignment: 5, ketelitian: 12 });
  const tightOffSharp = flagChance({ margin: 0.1, misalignment: 0, ketelitian: 20 });
  if (!(clearOff > 0.99)) e.push(`offside jelas tidak selalu dibenderai (${clearOff})`);
  if (clearOn !== 0) e.push(`pemain jelas sah dibenderai (${clearOn})`);
  if (!(tightOff < 0.99 && tightOff > 0.5)) e.push(`kejadian tipis offside tidak wajar (${tightOff})`);
  if (!(tightOn > 0 && tightOn < 0.2)) e.push(`kejadian tipis sah tidak wajar (${tightOn})`);
  if (!(tightOffMisaligned < tightOff)) e.push('hakim garis yang tidak sejajar tidak lebih sering salah');
  if (!(tightOffSharp > tightOff)) e.push('Ketelitian tinggi tidak lebih akurat');

  // Kick-off: penendang di belakang bola di titik tengah, lawan di luar lingkaran.
  const st = createMatchState(createDemoTeams(2026).home, createDemoTeams(2026).away);
  const kickTeam = st.ball.restartTeamId;
  const targets = kickoffTargets(st.players, kickTeam);
  const taker = pickKickoffTaker(st.players, kickTeam);
  const c = { x: PITCH.length / 2, y: PITCH.width / 2 };
  const tt = targets.get(taker.id);
  if (Math.hypot(tt.x - c.x, tt.y - c.y) > 1) e.push('penendang tidak di titik tengah');
  for (const p of st.players) {
    const t = targets.get(p.id);
    if (p.teamId !== kickTeam && Math.hypot(t.x - c.x, t.y - c.y) < PITCH.centerCircleRadius) e.push(`${p.id} (lawan) di dalam lingkaran`);
    const ownHalf = p.attacksRight ? t.x <= c.x + 0.01 : t.x >= c.x - 0.01;
    if (!ownHalf) e.push(`${p.id} tidak di separuh sendiri saat kick-off`);
  }
  check('hakim garis: jelas = benar, tipis = bisa salah; kick-off: penendang di titik tengah, lawan di luar lingkaran', e);
}

console.log('Pelanggaran & kartu (tahap 7b-1)');
{
  const e = [];
  const mk = (over = {}, discipline = {}) => ({
    id: 'x',
    skills: { kecerobohan: 10, temperamen: 10, ketenangan: 10, keputusan: 10, ...over },
    condition: { energy: 1 },
    discipline: { ...initialDiscipline(), ...discipline },
  });
  const ctx = { won: false, fromBehind: false, trailingLate: false };
  if (!(foulChance(mk({ kecerobohan: 18 }), ctx) > foulChance(mk({ kecerobohan: 3 }), ctx))) e.push('Kecerobohan tinggi tidak lebih sering melanggar');
  if (!(foulChance(mk(), { ...ctx, won: true }) < foulChance(mk(), ctx))) e.push('tekel yang menang tidak lebih jarang melanggar');
  if (!(foulChance(mk(), { ...ctx, fromBehind: true }) > foulChance(mk(), ctx))) e.push('tekel dari belakang tidak lebih sering melanggar');
  const hot = mk({ temperamen: 18 }, { agitation: 1 });
  if (!(foulChance(hot, ctx) > foulChance(mk({ temperamen: 18 }), ctx))) e.push('emosi panas tidak menambah pelanggaran');
  const calmBooked = mk({ ketenangan: 18, keputusan: 18, kecerobohan: 5 }, { yellows: 1 });
  const wildBooked = mk({ ketenangan: 3, keputusan: 3, kecerobohan: 19 }, { yellows: 1, agitation: 1 });
  if (cautionScale(mk()) !== 1) e.push('pemain tanpa kartu ikut berhati-hati');
  if (!(cautionScale(calmBooked) < cautionScale(wildBooked))) e.push('pemain tenang tidak lebih berhati-hati setelah dikartu daripada pemain ceroboh & panas');
  if (!(cautionScale(wildBooked) <= 1 && cautionScale(calmBooked) > 0)) e.push('kehati-hatian di luar 0–1');
  const ref = { x: 50, y: 34, skills: { ketegasan: 12 } };
  if (!(callChance(ref, { x: 52, y: 34 }, false) > callChance(ref, { x: 95, y: 5 }, false))) e.push('wasit jauh tidak lebih sering melewatkan pelanggaran');
  const holder = { id: 'h', attacksRight: true, x: 70, y: 34 };
  if (!advantageApplies(holder, [{ id: 'off', x: 70.5, y: 34 }], 'off')) e.push('keuntungan terhalang oleh si pelanggar sendiri');
  if (advantageApplies({ ...holder, x: 90 }, [], 'off')) e.push('keuntungan diberikan padahal tendangan bebas dekat gawang lebih berharga');
  check('pelanggaran: Kecerobohan, emosi, dari belakang; kehati-hatian setelah kuning; wasit; keuntungan', e);
}

console.log('Penalti');
{
  const e = [];
  const st = createMatchState(createDemoTeams(2026).home, createDemoTeams(2026).away);
  for (const kicker of ['home', 'away']) {
    const targets = penaltyTargets(st.players, kicker, st.teams);
    const ar = st.teams[kicker].attacksRight;
    const spot = penaltySpot(ar);
    const taker = pickPenaltyTaker(st.players, kicker);
    for (const p of st.players) {
      const t = targets.get(p.id);
      if (!t) { e.push(`${p.id}: tanpa posisi penalti`); continue; }
      const depthFromGoal = ar ? PITCH.length - t.x : t.x;
      if (p.id === taker.id) {
        if (Math.hypot(t.x - spot.x, t.y - spot.y) > 1.2) e.push('penendang tidak di titik penalti');
      } else if (p.role === 'GK' && p.teamId !== kicker) {
        if (depthFromGoal > 0.5 || Math.abs(t.y - PITCH.width / 2) > 0.1) e.push('kiper tidak di garis gawang');
      } else if (p.role !== 'GK') {
        if (depthFromGoal <= PITCH.penaltyAreaDepth) e.push(`${p.id} di dalam kotak saat penalti`);
        if (Math.hypot(t.x - spot.x, t.y - spot.y) < 9.15) e.push(`${p.id} di dalam busur penalti`);
        if (depthFromGoal < PITCH.penaltySpotDistance) e.push(`${p.id} di depan bola`);
      }
    }
  }
  check('penalti: penendang di titik, kiper di garis, pemain lain di luar kotak, busur, dan di belakang bola', e);
}

console.log('Jeda setelah pelanggaran: protes & pertikaian (tahap 7b-2)');
{
  const e = [];
  const mkP = (id, teamId, over = {}, agitation = 0) => ({
    id,
    teamId,
    role: 'CM',
    x: 50,
    y: 34,
    skills: { temperamen: 10, ketenangan: 10, ...over },
    discipline: { ...initialDiscipline(), agitation },
  });
  const run = (players, ctxOver, trials = 600, refK = 12) => {
    const rng = createRng(9);
    let protests = 0, dissent = 0, scuffles = 0;
    for (let i = 0; i < trials; i += 1) {
      const r = resolveIncident(rng, {
        kind: 'foul', offender: players[0], fouled: players[1], card: null, hard: true, penalty: false,
        spot: { x: 50, y: 34 }, referee: { x: 52, y: 36, skills: { ketegasan: refK } }, players, ...ctxOver,
      });
      protests += r.protesters.length; dissent += r.dissent.length; scuffles += r.scuffle ? 1 : 0;
      if (r.dissent.some((id) => !r.protesters.includes(id))) e.push('kartu protes tanpa protes');
      if (r.scuffle && (!r.scuffle.ids.includes(players[0].id) || !r.scuffle.ids.includes(players[1].id))) e.push('pertikaian tanpa pelaku & korban');
    }
    return { protests, dissent, scuffles };
  };
  const calm = [mkP('a', 'A', { temperamen: 3, ketenangan: 18 }), mkP('b', 'B', { temperamen: 3, ketenangan: 18 })];
  const hot = [mkP('a', 'A', { temperamen: 19, ketenangan: 3 }, 0.8), mkP('b', 'B', { temperamen: 19, ketenangan: 3 }, 0.8)];
  const c = run(calm, {});
  const h = run(hot, {});
  if (!(h.protests > c.protests * 2)) e.push(`pemain panas tidak lebih sering protes (${h.protests} vs ${c.protests})`);
  if (!(h.scuffles > c.scuffles * 2)) e.push(`korban panas tidak lebih sering memicu pertikaian (${h.scuffles} vs ${c.scuffles})`);
  if (run(hot, { hard: false }).scuffles !== 0) e.push('pertikaian setelah pelanggaran ringan');
  const lenient = run(hot, {}, 600, 2);
  const strict = run(hot, {}, 600, 19);
  if (!(strict.dissent > lenient.dissent)) e.push(`wasit tegas tidak lebih sering memberi kuning protes (${strict.dissent} vs ${lenient.dissent})`);
  check(`protes & pertikaian: panas ${h.protests}/${h.scuffles} vs tenang ${c.protests}/${c.scuffles}; kuning protes tegas ${strict.dissent} vs lunak ${lenient.dissent}`, e);
}

console.log('Jeda bola keluar (lemparan, pojok, tendangan gawang)');
{
  const e = [];
  const sim = createSimulation(createDemoTeams(2026).home, createDemoTeams(2026).away, 11);
  let s = sim.getState();
  let prev = s;
  let restarts = 0;
  const kinds = new Set();
  while (s.period === 'first') {
    s = sim.step();
    if (prev.pauseReason === 'restart' && s.pauseReason === null) {
      restarts += 1;
      kinds.add(prev.ball.restartKind);
      const taker = s.players.find((p) => p.id === prev.incident.takerId);
      if (!taker || Math.hypot(taker.x - s.ball.x, taker.y - s.ball.y) > 1.5) e.push(`eksekutor ${prev.ball.restartKind} tidak di bola saat jeda selesai`);
      if (prev.ball.restartKind === 'goalKick' && taker?.role !== 'GK') e.push('tendangan gawang bukan oleh kiper');
    }
    if (prev.pauseReason === 'restart' && s.periodTick !== prev.periodTick) e.push('jam berjalan saat jeda bola keluar');
    prev = s;
  }
  if (restarts === 0) e.push('tidak ada bola keluar di babak 1');
  check(`jeda bola keluar: ${restarts} kali (${[...kinds].join(', ')}), eksekutor di bola, jam berhenti`, e.slice(0, 5));
}

console.log('Bola udara (umpan silang & sundulan)');
{
  // Lambungan tiba setinggi kepala di titik bidikan.
  const from = { x: 80, y: 5 };
  const to = { x: 98, y: 30 };
  const v = loftVelocity(from, to);
  let b = { ...from, z: 0, vx: v.vx, vy: v.vy, vz: v.vz };
  const steps = Math.round(v.flightTime / 0.01);
  for (let i = 0; i < steps; i += 1) b = { ...b, ...airStep(b, 0.01) };
  const miss = Math.hypot(b.x - to.x, b.y - to.y);
  check(
    `lambungan tiba di bidikan (meleset ${miss.toFixed(2)} m, tinggi ${b.z.toFixed(2)} m)`,
    miss < 0.5 && Math.abs(b.z - CROSS.arrivalHeight) < 0.2 ? [] : ['lintasan lambungan tidak sesuai perhitungan'],
  );

  // Titik jatuh konsisten dengan lintasan, tinggi tidak pernah negatif, pantulan berhenti.
  const drop = dropPoint({ ...from, z: 0, vx: v.vx, vy: v.vy, vz: v.vz });
  const e1 = [];
  if (Math.hypot(drop.point.x - to.x, drop.point.y - to.y) > 0.5) e1.push('titik jatuh tidak di bidikan');
  let c = { ...from, z: 0, vx: v.vx, vy: v.vy, vz: v.vz };
  let settledAt = null;
  for (let i = 0; i < 200; i += 1) {
    c = { ...c, ...airStep(c, 0.1) };
    if (!(c.z >= 0)) e1.push(`tinggi negatif di langkah ${i}`);
    if (!isAirborne(c)) {
      settledAt = i;
      break;
    }
  }
  if (settledAt === null) e1.push('bola tidak pernah berhenti memantul');
  check('titik jatuh cocok, tinggi ≥ 0, pantulan berhenti', e1);

  // Duel udara: stat Duel udara tinggi lebih sering menang (posisi sama).
  const rng = createRng(77);
  const mk = (id, duelUdara) => ({
    player: { id, role: 'CB', attacksRight: true, skills: { duelUdara, kekuatan: 10, antisipasi: 10 } },
    u: 0.5,
    d: 0.5,
    point: { x: 50, y: 34 },
    z: 1.8,
  });
  let strongWins = 0;
  const trials = 400;
  for (let i = 0; i < trials; i += 1) if (resolveAerial([mk('a', 18), mk('b', 6)], rng).player.id === 'a') strongWins += 1;
  const rate = strongWins / trials;
  check(
    `duel udara: stat 18 vs 6 menang ${(rate * 100).toFixed(0)}% (harus jelas unggul tapi tidak mutlak)`,
    rate > 0.7 && rate < 0.95 ? [] : ['pengaruh stat Duel udara tidak wajar'],
  );
}

console.log('Gerak pertikaian (masukan 29 Okt: jangan menumpuk diam)');
{
  const teams = createDemoTeams(2026, {});
  const st = createMatchState(teams.home, teams.away);
  const spot = { x: 50, y: 34 };
  const home = st.players.filter((p) => p.teamId === teams.home.id && p.role !== 'GK').slice(0, 4);
  const away = st.players.filter((p) => p.teamId === teams.away.id && p.role !== 'GK').slice(0, 4);
  const crowd = [...home, ...away].map((p, i) => ({ ...p, x: spot.x + (i % 4) * 2 - 3, y: spot.y + (i < 4 ? -2 : 2) }));
  const scuffle = { ids: [home[0].id, away[0].id, ...home.slice(1).map((p) => p.id), ...away.slice(1).map((p) => p.id)], instigatorId: home[0].id };
  scuffle.styles = assignScuffleStyles(scuffle, crowd);
  const styles = new Set(Object.values(scuffle.styles));
  check('peran pertikaian beragam (≥ 4 gaya berbeda di kerumunan 8 orang)', styles.size >= 4 ? [] : [`hanya ${[...styles].join(', ')}`]);
  check('pemicu & pelaku terpasang', scuffle.styles[home[0].id] === 'pemicu' && scuffle.styles[away[0].id] === 'pelaku' ? [] : ['peran inti salah']);
  // Sasaran bergerak sepanjang drama, dan setiap pemain punya lintasan sendiri.
  const errs = [];
  const travel = new Map();
  let prev = null;
  let minGap = Infinity;
  for (let t = 0; t < 120; t += 1) {
    const targets = scuffleTargets(scuffle, spot, crowd, t, t / 120);
    if (prev) for (const [id, pt] of targets) travel.set(id, (travel.get(id) ?? 0) + Math.hypot(pt.x - prev.get(id).x, pt.y - prev.get(id).y));
    const pts = [...targets.values()];
    for (let i = 0; i < pts.length; i += 1) for (let j = i + 1; j < pts.length; j += 1) minGap = Math.min(minGap, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    prev = targets;
  }
  for (const [id, d] of travel) if (d < 3) errs.push(`${id} (${scuffle.styles[id]}) hampir diam: sasaran bergeser ${d.toFixed(1)} m`);
  check('setiap peserta pertikaian bergerak (sasaran bergeser ≥ 3 m dalam 12 dtk)', errs);
  const distinct = new Set([...travel.values()].map((d) => d.toFixed(0)));
  check('lintasan berbeda-beda antarpemain', distinct.size >= 4 ? [] : [`hanya ${distinct.size} variasi jarak`]);
  check('sasaran tidak menumpuk (jarak minimum ≥ 2 m)', minGap >= 2 ? [] : [`jarak minimum ${minGap.toFixed(2)} m`]);
  const ref = { x: 50, y: 34 };
  const a = protestTarget('home-7', 0, 1, ref, 0);
  const b = protestTarget('home-7', 0, 1, ref, 7);
  check('pemrotes maju-mundur di depan wasit', Math.hypot(a.x - b.x, a.y - b.y) > 0.3 ? [] : ['pemrotes diam']);
}

console.log('Taktik empat kotak (31 Okt)');
{
  const teams = createDemoTeams(2026, {});
  const sim = createSimulation(teams.home, teams.away, 5, { aiTeams: ['away'] });
  let s = sim.getState();
  for (const f of Object.keys(FORMATIONS)) {
    s = sim.setTactics('home', { inPossession: { formation: f }, outOfPossession: { formation: f } });
    const mine = s.players.filter((p) => p.teamId === 'home' && p.role !== 'GK');
    const slotsIn = new Set(mine.map((p) => `${p.slotIn.depth}|${p.slotIn.lane}`));
    const slotsOut = new Set(mine.map((p) => `${p.slotOut.depth}|${p.slotOut.lane}`));
    check(`formasi ${f}: 10 pemain di 10 slot berbeda (dengan & tanpa bola)`, slotsIn.size === 10 && slotsOut.size === 10 ? [] : [`${slotsIn.size}/${slotsOut.size}`]);
  }
  check('formasi tidak dikenal ditolak', tacticsErrors({ inPossession: { formation: '2-3-5' } }).length > 0 ? [] : ['diterima']);
  check('pengaturan tidak dikenal ditolak', tacticsErrors({ tempo: 'cepat' }).length > 0 && tacticsErrors({ onLoss: 'kabur' }).length > 0 ? [] : ['diterima']);
  check('kurang orang (9 di 4-4-2): satu penyerang yang dikosongkan', outfieldSlots('4-4-2', 9).filter((x) => x.role === 'ST').length === 1 && outfieldSlots('4-4-2', 9).filter((x) => x.role === 'CB').length === 2 ? [] : ['slot salah']);
  const ten = s.players.filter((p) => p.teamId === 'home').slice(0, 10);
  check('reshape 9 pemain lapangan ke 4-3-3', reshape(ten, '4-3-3').size === 9 ? [] : ['jumlah salah']);
  // Dua bentuk: 4-4-2 tanpa bola, 3-2-5 dengan bola → bentuk berubah saat bola berpindah.
  s = sim.setTactics('home', { inPossession: { formation: '3-2-5', width: 'lebar' }, outOfPossession: { formation: '4-4-2', line: 'tinggi' }, onLoss: 'counterPress', onWin: 'seranganBalik' });
  check('bentuk dengan bola 3-2-5: lima pemain di lini depan', s.players.filter((p) => p.teamId === 'home' && p.slotIn.depth > 0.4).length === 5 ? [] : ['salah']);
  check('bentuk tanpa bola 4-4-2: empat bek', s.players.filter((p) => p.teamId === 'home' && p.role !== 'GK' && p.slotOut.depth <= 0.24).length === 4 ? [] : ['salah']);
  let blends = new Set();
  const errs = [];
  for (let i = 0; i < 1500; i += 1) {
    s = sim.step();
    blends.add(Math.round(s.teams.home.shapeBlend * 4));
    if (i % 50 === 0) errs.push(...validateMatchState(s));
  }
  check('bentuk bergeser mulus di antara dua bentuk (nilai antara terlihat)', blends.has(1) || blends.has(2) || blends.has(3) ? [] : ['melompat']);
  check('state valid selama taktik empat kotak berjalan', errs.slice(0, 5));
  // Gaya efektif: jendela transisi.
  const t1 = defaultTactics('4-4-2');
  const cp = teamStyle({ ...t1, onLoss: 'counterPress' }, 10, Infinity);
  const mu = teamStyle({ ...t1, onLoss: 'mundur' }, 10, Infinity);
  const late = teamStyle({ ...t1, onLoss: 'counterPress' }, TRANSITION.windowTicks + 5, Infinity);
  check('counter-press aktif hanya di jendela transisi', cp.counterPress && !late.counterPress ? [] : ['salah']);
  check('mundur: tidak menekan tinggi tepat setelah kehilangan bola', mu.pressZone <= TRANSITION.regroupZone ? [] : ['masih menekan']);
  const sb = teamStyle({ ...t1, onWin: 'seranganBalik' }, Infinity, 5);
  const bu = teamStyle({ ...t1, onWin: 'bangunUlang' }, Infinity, 5);
  check('serangan balik lebih langsung, bangun ulang lebih sabar', sb.directness > 1 && sb.tempo < 1 && bu.directness < 1 && bu.tempo > 1 ? [] : ['salah']);
  const base = teamStyle(t1);
  check('taktik bawaan = permainan lama (tanpa geser, tekan di mana saja, lebar 1,35)', base.blockShift === 0 && base.pressZone === 1 && base.widthAttack === 1.35 && base.directness === 1 && base.tempo === 1 ? [] : ['berbeda']);
  // AI pelatih (tim AI saja): kalah jumlah → garis rendah; tim pengguna tidak diubah.
  const cb = s.players.find((p) => p.teamId === 'home' && p.role === 'CB');
  const sim10 = createSimulation(teams.home, teams.away, 5, { aiTeams: ['home'], startSentOff: [cb.id] });
  let t = sim10.getState();
  for (let i = 0; i < 300; i += 1) t = sim10.step();
  check('AI pelatih: tim AI yang kalah jumlah → garis rendah', t.teams.home.activeTactics.outOfPossession.line === 'rendah' ? [] : [t.teams.home.activeTactics.outOfPossession.line]);
  const simUser = createSimulation(teams.home, teams.away, 5, { aiTeams: ['away'], startSentOff: [cb.id] });
  let u = simUser.getState();
  for (let i = 0; i < 300; i += 1) u = simUser.step();
  check('tim pengguna tidak diubah AI saat kalah jumlah', u.teams.home.activeTactics.outOfPossession.line === 'normal' ? [] : ['diubah']);
}

console.log('Skema bola mati (8d)');
{
  check('skema tidak dikenal ditolak', tacticsErrors({ corner: 'trik' }).length > 0 && tacticsErrors({ freeKick: 'tendangan pisang' }).length > 0 ? [] : ['diterima']);
  const teams = createDemoTeams(2026, {});
  const run = (changes, seeds) => {
    const total = { fkShots: 0, fkAwarded: 0, corners: 0, cornerShots: 0 };
    for (const seed of seeds) {
      const sim = createSimulation(teams.home, teams.away, seed);
      sim.setTactics('home', changes);
      let st = sim.getState();
      while (st.period === 'first') st = sim.step();
      total.fkShots += st.stats.freeKicks.home.shots;
      total.fkAwarded += st.stats.freeKicks.home.awarded;
      total.corners += st.stats.corners.home.taken;
      total.cornerShots += st.stats.corners.home.shots;
      const errs = validateMatchState(st);
      if (errs.length) check(`state valid (${JSON.stringify(changes)}, seed ${seed})`, errs);
    }
    return total;
  };
  const seeds = [1, 2, 3, 4, 5, 6];
  const lambung = run({ freeKick: 'lambung' }, seeds);
  const pendek = run({ freeKick: 'pendek' }, seeds);
  const tembak = run({ freeKick: 'tembak' }, [...seeds, 7, 8, 9, 10, 11, 12, 13, 14]);
  check('tendangan bebas "lambung" & "pendek" tidak pernah ditembak langsung', lambung.fkShots === 0 && pendek.fkShots === 0 ? [] : [`${lambung.fkShots} / ${pendek.fkShots}`]);
  check('tendangan bebas "tembak" dicoba bila ada kesempatan', tembak.fkShots > 0 ? [] : ['tidak pernah']);
  // Titik serbuan kotak per skema (bola di pojok kiri atas, tim menyerang ke kanan).
  const cornerBall = { x: PITCH.length, y: 0 };
  const nearPost = { x: PITCH.length, y: PITCH.width / 2 - PITCH.goalWidth / 2 };
  const farPost = { x: PITCH.length, y: PITCH.width / 2 + PITCH.goalWidth / 2 };
  const avgDist = (spots, p) => spots.reduce((t, q) => t + Math.hypot(q.x - p.x, q.y - p.y), 0) / spots.length;
  const dekat = boxRunSpots(cornerBall, true, 'tiangDekat');
  const jauh = boxRunSpots(cornerBall, true, 'tiangJauh');
  check('skema tiang dekat: penyerbu lebih dekat ke tiang dekat', avgDist(dekat, nearPost) < avgDist(jauh, nearPost) ? [] : ['tidak']);
  check('skema tiang jauh: penyerbu lebih dekat ke tiang jauh', avgDist(jauh, farPost) < avgDist(dekat, farPost) ? [] : ['tidak']);
  const pendekSpot = boxRunSpots(cornerBall, true, 'pendek')[0];
  check('skema pendek: satu rekan mendekat ke bola (≤ 12 m)', Math.hypot(pendekSpot.x - cornerBall.x, pendekSpot.y - cornerBall.y) <= 12 ? [] : ['terlalu jauh']);
  // Tepisan melebar: sebagian tepisan menuju garis gawang sendiri (asal sepak pojok).
  {
    const rng = createRng(11);
    const keeper = { attacksRight: true, y: 30 };
    let wide = 0;
    for (let i = 0; i < 400; i += 1) if (parryVelocity(keeper, 20, rng, 30).vx < 0) wide += 1;
    check('sebagian tepisan kiper melebar ke arah garis gawang (25–55%)', wide / 400 >= 0.25 && wide / 400 <= 0.55 ? [] : [`${((100 * wide) / 400).toFixed(0)}%`]);
  }
}

console.log('Skuad & pergantian pemain (8a)');
{
  const teams = createDemoTeams(2026, {});
  check('7 cadangan per tim, nomor 12–18', teams.home.bench.length === 7 && teams.away.bench.every((p) => p.number >= 12 && p.number <= 18) ? [] : ['bangku salah']);
  const names = [...teams.home.players, ...teams.home.bench, ...teams.away.players, ...teams.away.bench].map((p) => p.shortName);
  check('nama punggung unik di 36 pemain', new Set(names).size === names.length ? [] : ['nama ganda']);
  // Antrian di babak 1 → dijalankan saat babak 2 dimulai; tim kandang diatur pengguna (AI hanya tim tamu).
  const sim = createSimulation(teams.home, teams.away, 3, { aiTeams: ['away'] });
  let s = sim.getState();
  const outP = s.players.find((p) => p.teamId === 'home' && p.role === 'ST');
  const inP = s.teams.home.bench.find((p) => p.role === 'ST');
  check('menolak kiper diganti pemain lapangan', substitutionErrors(s, 'home', s.players.find((p) => p.teamId === 'home' && p.role === 'GK').id, inP.id).length > 0 ? [] : ['diterima']);
  s = sim.queueSubstitution('home', outP.id, inP.id);
  let errs = [];
  for (let i = 0; i < 400; i += 1) {
    s = sim.step();
    if (s.players.some((p) => p.id === inP.id)) errs.push('pemain masuk di babak 1');
  }
  check('antrian babak 1 tidak dijalankan selama babak 1', errs.slice(0, 1));
  while (s.period === 'first') s = sim.step();
  s = sim.startSecondHalf();
  const entered = s.players.find((p) => p.id === inP.id);
  check('dijalankan saat babak 2 dimulai, mengambil slot pemain keluar', entered && !s.players.some((p) => p.id === outP.id) && entered.slot.lane === outP.slot.lane ? [] : ['tidak terganti']);
  check('state valid setelah pergantian', validateMatchState(s));
  // Babak 2: diantrikan saat bola hidup → baru masuk di bola mati berikutnya.
  const out2 = s.players.find((p) => p.teamId === 'home' && p.role === 'CM');
  const in2 = s.teams.home.bench.find((p) => p.role === 'CM');
  while (s.pauseTicks > 0) s = sim.step();
  s = sim.queueSubstitution('home', out2.id, in2.id);
  let liveEntry = false;
  let entered2 = false;
  errs = [];
  while (s.period === 'second' && !entered2) {
    const wasLive = s.pauseTicks === 0;
    s = sim.step();
    if (s.players.some((p) => p.id === in2.id)) {
      entered2 = true;
      if (wasLive && s.pauseTicks === 0) liveEntry = true;
    }
    if (s.tick % 50 === 0) errs.push(...validateMatchState(s));
  }
  check('babak 2: pergantian hanya saat bola mati', entered2 && !liveEntry ? [] : [entered2 ? 'masuk saat bola hidup' : 'tidak pernah masuk']);
  while (s.period === 'second') {
    s = sim.step();
    if (s.tick % 50 === 0) errs.push(...validateMatchState(s));
  }
  check('laga dengan pergantian lolos invariant', errs);
  check(`AI pelatih tim tamu memakai pergantian (≤ ${SUBS.max})`, s.teams.away.subsUsed >= 1 && s.teams.away.subsUsed <= SUBS.max ? [] : [`${s.teams.away.subsUsed} pergantian`]);
  check('tim kandang (pengguna) tidak diganti AI', s.teams.home.subsUsed === 2 ? [] : [`${s.teams.home.subsUsed} pergantian`]);
}

console.log('AI pelatih & penutup tembakan');
{
  const base = defaultTactics('4-4-2');
  const ctx = { goalsFor: 0, goalsAgainst: 0, minute: 30 };
  check('11 vs 11 → taktik dasar', coachTactics(base, { ...ctx, own: 11, opponents: 11 }) === base ? [] : ['diubah']);
  check('10 vs 11 → garis rendah', coachTactics(base, { ...ctx, own: 10, opponents: 11 }).outOfPossession.line === 'rendah' ? [] : ['salah']);
  check('10 vs 11, tertinggal di menit 80 → kembali ke taktik dasar', coachTactics(base, { ...ctx, own: 10, opponents: 11, goalsAgainst: 1, minute: 80 }) === base ? [] : ['salah']);
  check('tekanan rendah tidak menekan tinggi', !pressAllowedAt(teamStyle({ ...base, outOfPossession: { ...base.outOfPossession, press: 'rendah' } }), { x: 90, y: 34 }, true) ? [] : ['menekan']);
  {
    const demo = createDemoTeams(2026, {});
    const st2 = createMatchState(demo.home, demo.away);
    const defenders = st2.players.filter((p) => p.teamId === 'home').map((p, i) => ({ ...p, x: 8 + (i % 4) * 4, y: 20 + i * 2.5 }));
    const attackers = st2.players.filter((p) => p.teamId === 'away');
    const holderNear = { ...attackers[9], x: 22, y: 34 };
    const holderFar = { ...attackers[9], x: 60, y: 34 };
    const lone = [{ ...holderNear }, ...attackers.slice(0, 9).map((p, i) => ({ ...p, x: 20 + (i % 3), y: 30 + i }))];
    const near = pickCover(defenders, holderNear, true, { range: 26, chaserId: null, previousId: null, attackers: [holderNear] });
    check('penutup tembakan aktif dekat gawang sendiri', near && near.point.x < holderNear.x ? [] : ['tidak ada penutup']);
    check('penutup tidak aktif jauh dari gawang', pickCover(defenders, holderFar, true, { range: 26, chaserId: null, previousId: null, attackers: [holderFar] }) === null ? [] : ['aktif']);
    check('penutup tidak aktif saat kalah jumlah di sekitar bola', pickCover(defenders.slice(0, 2), holderNear, true, { range: 26, chaserId: null, previousId: null, attackers: lone }) === null ? [] : ['aktif']);
    check('hanya garis rendah yang menutup tembakan', LINE_OPTIONS.rendah.coverRange > 0 && LINE_OPTIONS.normal.coverRange === 0 && LINE_OPTIONS.tinggi.coverRange === 0 ? [] : ['salah']);
  }
  const teams = createDemoTeams(2026, {});
  const st = createMatchState(teams.home, teams.away);
  const cm = st.players.find((p) => p.role === 'CM' && p.teamId === teams.home.id);
  const ball = { x: 52, y: 34 };
  const low = teamStyle({ ...base, outOfPossession: { ...base.outOfPossession, line: 'rendah' } });
  const def = computeAnchor(cm, ball, true, 'defend', low).x - computeAnchor(cm, ball, true, 'defend').x;
  const att = computeAnchor(cm, ball, true, 'attack', low).x - computeAnchor(cm, ball, true, 'attack').x;
  check('garis rendah: blok mundur saat tanpa bola', def < -2 ? [] : [`geser ${def.toFixed(1)} m`]);
  check('garis rendah: tidak berlaku saat dengan bola', Math.abs(att) < 1e-9 ? [] : [`geser ${att.toFixed(1)} m`]);
}

console.log('Setelah protes: diam dulu, lalu bubar bertahap');
{
  const teams = createDemoTeams(2026, {});
  const st = createMatchState(teams.home, teams.away);
  const ls = st.players.map((p) => lingerTicks(p));
  check('pemrotes diam 0,8–2,5 dtk', ls.every((t) => t >= AFTER_INCIDENT.lingerMin && t <= AFTER_INCIDENT.lingerMin + AFTER_INCIDENT.lingerRange) ? [] : ['di luar rentang']);
  check('lama diam berbeda-beda antarpemain', new Set(ls).size >= 5 ? [] : ['terlalu seragam']);
  const ball = { ...st.ball, x: 60, y: 30, restartTeamId: teams.home.id };
  const taker = st.players.find((p) => p.teamId === teams.home.id && p.role === 'CM');
  const t = freeKickSettleTargets(st.players, ball, taker.id, st.teams);
  const support = st.players.filter((p) => p.teamId === teams.home.id && p.id !== taker.id && t.has(p.id) && Math.hypot(t.get(p.id).x - ball.x, t.get(p.id).y - ball.y) <= 12);
  check('rekan eksekutor mendekati bola (≥ 2 opsi pendek)', support.length >= 2 ? [] : [`hanya ${support.length}`]);
  const tooClose = st.players.filter((p) => p.teamId !== teams.home.id && p.role !== 'GK' && Math.hypot(t.get(p.id).x - ball.x, t.get(p.id).y - ball.y) < 9.15);
  check('lawan dituju ≥ 9,15 m dari bola', tooClose.length === 0 ? [] : tooClose.map((p) => p.id));
}

console.log('Kartu merah & bermain dengan 10 orang (tahap 7c)');
{
  const teams = createDemoTeams(2026, {});
  const st = createMatchState(teams.home, teams.away);
  const mine = st.players.filter((p) => p.teamId === teams.home.id);
  const outfield = mine.filter((p) => p.role !== 'GK');
  // 4-4-2 kehilangan bek tengah → gelandang turun, penyerang turun, satu penyerang tersisa di tengah.
  const cb = mine.find((p) => p.role === 'CB');
  const changes = repairShape(outfield.filter((p) => p.id !== cb.id), cb);
  const after = outfield.filter((p) => p.id !== cb.id).map((p) => ({ ...p, ...(changes.get(p.id) ?? {}) }));
  const defenders = after.filter((p) => p.slot.depth <= 0.24).length;
  const forwards = after.filter((p) => p.slot.depth > 0.4);
  check('lubang di lini belakang ditambal (tetap 4 bek)', defenders === 4 ? [] : [`bek ${defenders}`]);
  check('penyerang yang dikorbankan, sisa satu di tengah', forwards.length === 1 && Math.abs(forwards[0].slot.lane - 0.5) < 1e-9 ? [] : [`penyerang ${forwards.length}`]);
  const gk = mine.find((p) => p.role === 'GK');
  const swap = emergencyKeeper(outfield, gk);
  check('kiper dikeluarkan → bek jadi kiper darurat dengan stat kiper rendah', swap && swap.player.role === 'GK' && swap.player.skills.refleks <= 5 ? [] : ['tidak ada kiper darurat']);
  const out = applySendOffs(st.players, [], new Map([[gk.id, { card: 'red', reason: 'dogso' }]]), 10);
  const keepers = out.players.filter((p) => p.teamId === teams.home.id && p.role === 'GK');
  check('tetap tepat satu kiper setelah kiper dikartu merah', keepers.length === 1 && keepers[0].id !== gk.id ? [] : ['kiper tidak terganti']);

  const referee = { skills: { ketegasan: 12 } };
  const calmPlayer = { ...outfield[0], discipline: { ...initialDiscipline() }, skills: { ...outfield[0].skills, kecerobohan: 5, temperamen: 5 } };
  const hotPlayer = { ...calmPlayer, discipline: { ...initialDiscipline(), agitation: 0.8 }, skills: { ...calmPlayer.skills, kecerobohan: 18, temperamen: 18 } };
  check('merah langsung lebih mungkin untuk pemain ceroboh & panas', straightRedChance(referee, hotPlayer, { fromBehind: true }) > 3 * straightRedChance(referee, calmPlayer, { fromBehind: false }) ? [] : ['tidak naik']);
  check('menggagalkan peluang gol → merah sangat mungkin', straightRedChance(referee, calmPlayer, { dogso: true }) >= 0.5 ? [] : ['terlalu kecil']);
  const booked = { ...calmPlayer, discipline: { ...calmPlayer.discipline, yellows: 1 } };
  check('wasit ragu memberi kuning kedua', Math.abs(yellowChance(referee, 'reckless', booked) - RED.secondYellowLeniency * yellowChance(referee, 'reckless', calmPlayer)) < 1e-9 ? [] : ['tidak ada keraguan']);

  // Laga penuh dengan satu pemain sudah dikartu merah: invariant & bentuk tim 10 orang.
  const sim = createSimulation(teams.home, teams.away, 7, { startSentOff: [cb.id] });
  let s = sim.getState();
  const errors = [];
  while (s.period === 'first') {
    s = sim.step();
    if (s.tick % 50 === 0) errors.push(...validateMatchState(s));
  }
  s = sim.startSecondHalf();
  while (s.period === 'second') {
    s = sim.step();
    if (s.tick % 50 === 0) errors.push(...validateMatchState(s));
  }
  check('laga penuh dengan 10 orang lolos invariant', errors);
  check('tim 10 orang tetap ≤ 10 pemain (bisa kena merah lagi)', s.players.filter((p) => p.teamId === teams.home.id).length <= 10 ? [] : ['jumlah salah']);

  // Laga biasa: kartu merah muncul dari permainan dan pemain benar-benar keluar.
  let reds = 0;
  for (let seed = 1; seed <= 80 && reds === 0; seed += 1) {
    const m = createSimulation(teams.home, teams.away, seed);
    let x = m.getState();
    while (x.period === 'first') x = m.step();
    reds += x.sentOff.length;
    if (x.sentOff.length) {
      const errs = validateMatchState(x);
      for (const p of x.sentOff) if (x.players.some((q) => q.id === p.id)) errs.push(`${p.id} masih bermain`);
      check(`kartu merah dari permainan (seed ${seed}): pemain keluar, invariant lolos`, errs);
    }
  }
  check('kartu merah terjadi dalam 80 babak', reds > 0 ? [] : ['tidak pernah ada kartu merah']);
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
  // Jam berhenti selama persiapan kick-off: tick bermain = HALF_TICKS, tick jeda tercatat terpisah.
  if (s.tick - s.stats.pauseTicks !== HALF_TICKS) {
    errors.push(`babak 1 seharusnya ${HALF_TICKS} tick bermain, dapat ${s.tick - s.stats.pauseTicks}`);
  }
  if (s.periodTick !== HALF_TICKS) errors.push(`jam babak 1 seharusnya ${HALF_TICKS}, dapat ${s.periodTick}`);
  if (gameClock(s).minute !== 45) errors.push(`jam saat jeda seharusnya 45', dapat ${gameClock(s).minute}'`);

  const frozen = sim.step();
  if (frozen.tick !== s.tick) errors.push('waktu berjalan saat jeda babak');

  s = sim.startSecondHalf();
  if (s.pauseReason !== 'kickoff') errors.push('babak 2 tidak dimulai dengan persiapan kick-off');
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

console.log('Persiapan kick-off (jam berhenti)');
{
  const errors = [];
  const teams = createDemoTeams(2026);
  const sim = createSimulation(teams.home, teams.away, 19);
  let s = sim.getState();
  if (s.pauseReason !== 'kickoff') errors.push('pertandingan tidak dimulai dengan persiapan kick-off');
  let pausedSteps = 0;
  while (s.pauseTicks > 0) {
    s = sim.step();
    pausedSteps += 1;
    if (s.periodTick !== 0) errors.push('jam berjalan saat persiapan kick-off awal');
    if (pausedSteps > 200) break;
  }
  if (pausedSteps < 20) errors.push(`persiapan kick-off terlalu singkat (${pausedSteps} tick)`);
  // Setelah gol: jam membeku sampai semua pemain kembali & menunggu.
  // Cari gol pertama di babak 1 dari beberapa seed (seed apa pun boleh, yang penting ada gol).
  let goalFound = false;
  for (let seed = 1; seed <= 20 && !goalFound; seed += 1) {
    const g = createSimulation(teams.home, teams.away, seed);
    s = g.getState();
    while (s.period === 'first' && !goalFound) {
      const before = s.stats.goals.home + s.stats.goals.away;
      s = g.step();
      if (s.stats.goals.home + s.stats.goals.away > before) goalFound = true;
    }
    if (goalFound) {
      const clock = s.periodTick;
      if (s.pauseReason !== 'goal') errors.push('setelah gol tidak masuk jeda gol');
      let n = 0;
      while (s.pauseTicks > 0 && n < 200) {
        s = g.step();
        n += 1;
        if (s.periodTick !== clock) errors.push('jam berjalan saat jeda gol');
      }
      if (n > 80 + 20 + 1) errors.push(`jeda gol terlalu lama (${n} tick)`);
      if (s.pauseReason !== null) errors.push('jeda tidak berakhir');
    }
  }
  if (!goalFound) errors.push('20 seed tanpa gol di babak 1');
  check('awal laga & setelah gol: jam berhenti, pemain kembali ke posisi, menunggu, lalu kick-off', errors);
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
  // Patokan liga besar Eropa 2024/25: 2,6–3,2 gol per laga (keputusan 28 Okt sore).
  // Sampel 16 laga masih bergoyang ±0,4; angka pasti pakai npm run calibrate.
  inRange('gol per pertandingan', r.goals / r.n, 2.4, 3.0);
  inRange('laga 0–0', (r.scores.filter((x) => x === '0-0').length / r.n) * 100, 0, 10, (v) => `${v.toFixed(0)}%`);
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
