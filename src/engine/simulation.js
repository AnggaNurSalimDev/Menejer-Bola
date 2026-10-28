// Simulasi pertandingan: memegang state dan angka acak ber-seed,
// lalu memajukan semuanya satu tick setiap kali step() dipanggil.
// Tidak tahu apa-apa soal tampilan — bisa dijalankan di Node.
//
// Urutan satu tick:
//   0. Kalau sedang jeda setelah gol: pemain kembali ke posisi kick-off, selesai.
//   1. Duel & keputusan pemegang bola: ditekel? kalau tidak, tembak / oper / giring.
//   2. Setiap tim menunjuk satu pemain untuk menjemput/menekan bola.
//   3. Setiap pemain mendapat tugas & target, lalu tubuhnya bergerak.
//   4. Bola bergerak: menempel di kaki pemegang, atau menggelinding lalu dicek:
//      siapa yang menyentuhnya, gol, atau keluar lapangan.
//   5. Statistik dicatat.

import { createRng } from './rng.js';
import {
  createMatchState,
  createInitialBall,
  slotToPitch,
  validateMatchState,
  emptyTeamRoles,
  gameClock,
  kickoffPause,
} from './state.js';
import {
  DT,
  TICK_RATE,
  DECISION_INTERVAL_TICKS,
  KICK_COOLDOWN_TICKS,
  HALF_TICKS,
  MAX_RETURN_TICKS,
  SETTLE_DISTANCE,
  SETTLE_SPEED,
} from './constants.js';
import { blunder } from './skill.js';
import { getPhilosophy } from './philosophy.js';
import {
  PITCH,
  clampToPitch,
  distance,
  forwardOf,
  isInsidePitch,
  isBetweenPosts,
  insideOwnPenaltyArea,
} from './pitch.js';
import { rollBall, MAX_KICK_SPEED } from './ball.js';
import { computeAnchor } from './shape.js';
import { stepBody } from './movement.js';
import { pickChaser, pickPresser } from './roles.js';
import { evaluatePassOptions, dribbleTarget, shotLaneBlocker } from './passing.js';
import { evaluateShot, shotVelocity, shotSpeedFor, goalAngle, SCREEN } from './shooting.js';
import {
  pickTackler,
  tackleSuccessChance,
  looseBallVelocity,
  BEATEN_COOLDOWN_TICKS,
  SUCCESS_COOLDOWN_TICKS,
} from './tackle.js';
import { findController } from './touch.js';
import { assignMarks, blendTowardMark, BACK_LINE_ROLES } from './marking.js';
import { catchChance, parryVelocity, isKeeperHandling } from './keeper.js';
import {
  initialCondition,
  drainEnergy,
  driftConfidence,
  recoverAtHalftime,
  applyConfidenceEvent,
  blunderScale,
  effectiveProfile,
  progressWeightScale,
  shotThresholdScale,
  physicalScale,
  instinctShotScale,
} from './condition.js';
import {
  foulChance,
  callChance,
  yellowChance,
  isFromBehind,
  isLastMan,
  advantageApplies,
  cautionScale,
  boxAttemptScale,
  raiseAgitation,
  calmDown,
  AGITATION,
} from './fouls.js';
import {
  createOfficials,
  stepOfficials,
  assistantFor,
  offsideReferenceX,
  flagChance,
  ASSISTANT,
} from './officials.js';
import {
  GRAVITY,
  AERIAL,
  isAirborne,
  airStep,
  heightAt,
  aerialCandidates,
  resolveAerial,
  keeperCatchChance,
  crossVelocity,
  headerShotVelocity,
  headerClearVelocity,
  headerKnockVelocity,
  inHeaderShotRange,
} from './aerial.js';
import {
  offsideLine,
  isOffside,
  clampOnside,
  onsideMarginFor,
  toShoulder,
  SHOULDER_ROLES,
  isBreakaway,
  pickRunner,
  RUN_MAX_TICKS,
  RUN_COOLDOWN_TICKS,
  RUN_START_CHANCE,
} from './attack.js';

// Pemegang bola
// Tempo padat (pertandingan 2 × 5 menit): bola dilepas dalam 0,5–1,5 detik.
const HOLD_MIN_TICKS = 5;
const HOLD_MAX_TICKS = 15;
const MIN_HOLD_TICKS = 3; // setelah tempo & Keputusan, tetap butuh sentuhan
const KEEPER_HOLD_MIN_TICKS = 5;
const KEEPER_HOLD_MAX_TICKS = 10;
const FORCED_PASS_TICKS = 25; // terlalu lama tanpa opsi aman → oper yang terbaik saja
const PRESSURE_RADIUS = 3; // meter
const PRESSURED_MIN_TICKS = 4; // ditekan pun, pemain butuh sejenak untuk melepas operan
const PRESSURED_FORCED_TICKS = 8;
const SHOT_MIN_TICKS = 2; // butuh sentuhan persiapan sebelum menembak
const RUN_SPOT_MIN_TICKS = 2; // butuh sentuhan persiapan sebelum mengirim umpan terobosan
const BREAKAWAY_SHOOT_DISTANCE = 14; // meter: lolos satu lawan satu, tembak dari sini
const BIG_CHANCE_DISTANCE = 16; // meter: tembakan sedekat ini = peluang besar (uji Ketenangan)
const BREAKAWAY_SPEED_SCALE = 0.9; // menggiring hampir dengan kecepatan penuh
const BREAKAWAY_AIM_DEPTH = 6; // meter di depan gawang lawan
const DRIBBLE_SPEED_SCALE = 0.75;
const BALL_AHEAD_OF_FEET = 0.6; // meter

// Penghindaran rekan
const SEPARATION_RADIUS = 4; // meter
const SEPARATION_STRENGTH = 0.8;

// Bola mati diletakkan sedikit di dalam garis.
const RESTART_INSET = 0.5;

function cloneStats(stats) {
  const perTeam = (obj) => Object.fromEntries(Object.entries(obj).map(([id, v]) => [id, { ...v }]));
  return {
    possessionTicks: { ...stats.possessionTicks },
    passes: perTeam(stats.passes),
    shots: perTeam(stats.shots),
    goals: { ...stats.goals },
    tackles: perTeam(stats.tackles),
    saves: perTeam(stats.saves),
    heavyTouches: { ...stats.heavyTouches },
    blocks: { ...stats.blocks },
    offsides: { ...stats.offsides },
    clearances: { ...stats.clearances },
    crosses: perTeam(stats.crosses),
    headers: perTeam(stats.headers),
    longShots: perTeam(stats.longShots),
    aerialsWon: { ...stats.aerialsWon },
    turnovers: stats.turnovers,
    outOfPlay: stats.outOfPlay,
    pauseTicks: stats.pauseTicks,
    offsideMissed: { ...stats.offsideMissed },
    offsideWrong: { ...stats.offsideWrong },
    fouls: { ...stats.fouls },
    foulsUnseen: { ...stats.foulsUnseen },
    advantages: { ...stats.advantages },
    yellows: { ...stats.yellows },
    secondYellows: { ...stats.secondYellows },
    freeKicks: perTeam(stats.freeKicks),
    penalties: perTeam(stats.penalties),
  };
}

function facingOf(player) {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > 0.5) return { x: player.vx / speed, y: player.vy / speed };
  return { x: player.attacksRight ? 1 : -1, y: 0 };
}

function ballAtFeet(player) {
  const facing = facingOf(player);
  return clampToPitch({
    x: player.x + facing.x * BALL_AHEAD_OF_FEET,
    y: player.y + facing.y * BALL_AHEAD_OF_FEET,
  });
}

function nearestDistance(point, others) {
  let best = Infinity;
  for (const other of others) best = Math.min(best, distance(point, other));
  return best;
}

// Dorong target menjauh dari rekan yang terlalu dekat, supaya tidak saling tumpuk.
function applySeparation(target, player, players) {
  let pushX = 0;
  let pushY = 0;
  for (const other of players) {
    if (other.id === player.id || other.teamId !== player.teamId) continue;
    const dx = player.x - other.x;
    const dy = player.y - other.y;
    const d = Math.hypot(dx, dy);
    if (d >= SEPARATION_RADIUS) continue;

    const push = (SEPARATION_RADIUS - d) * SEPARATION_STRENGTH;
    if (d < 1e-6) {
      // Posisi persis sama: pisahkan dengan arah tetap berdasarkan nomor, supaya tetap deterministik.
      pushY += player.number > other.number ? push : -push;
    } else {
      pushX += (dx / d) * push;
      pushY += (dy / d) * push;
    }
  }
  return clampToPitch({ x: target.x + pushX, y: target.y + pushY });
}

// Konteks kondisi satu pemain di tick ini (tahap 6): tertinggal? menit? ditekan?
// match = { goals, minute, teamIds }
function conditionContext(player, players, match, extra = {}) {
  const opponentTeamId = match.teamIds.find((id) => id !== player.teamId);
  let pressured = false;
  for (const o of players) {
    if (o.teamId !== player.teamId && distance(o, player) < PRESSURE_RADIUS) {
      pressured = true;
      break;
    }
  }
  return {
    trailing: match.goals[player.teamId] < match.goals[opponentTeamId],
    minute: match.minute,
    pressured,
    ...extra,
  };
}

// ---- Sapuan panik (permintaan 28 Okt) --------------------------------------
// Tim tertinggal + bek punya catatan blunder + bola di separuh sendiri:
// bek cenderung langsung membuang bola jauh ke depan, sering ke luar lapangan.
// Makin rendah percaya diri dan Ketenangan-nya, makin sering panik.
const PANIC_ROLES = Object.freeze(['CB', 'LB', 'RB', 'DM']);
const PANIC_MIN_BLUNDERS = 1;
const PANIC_DECISION_TICK = 2; // diputuskan sekali per penguasaan, setelah satu sentuhan
const PANIC_BASE_CHANCE = 0.15;
const PANIC_EXTRA_CHANCE = 1.2; // × (1 − percaya diri) × (1 − ketenangan)
const PANIC_MAX_CHANCE = 0.8;
const CLEAR_MIN_ANGLE = (15 * Math.PI) / 180; // dari arah lurus ke depan, menuju garis samping terdekat
const CLEAR_MAX_ANGLE = (70 * Math.PI) / 180;
const CLEAR_MIN_SPEED = 20; // m/s
const CLEAR_MAX_SPEED = 26;

export function canPanicClear(holder, ball, match) {
  if (!PANIC_ROLES.includes(holder.role)) return false;
  if (holder.condition.blunders < PANIC_MIN_BLUNDERS) return false;
  if (ball.heldTicks !== PANIC_DECISION_TICK) return false;
  if (forwardOf(ball, holder.attacksRight) >= PITCH.length / 2) return false;
  const opponentTeamId = match.teamIds.find((id) => id !== holder.teamId);
  return match.goals[holder.teamId] < match.goals[opponentTeamId];
}

function panicChance(holder) {
  const composure = (holder.skills.ketenangan - 1) / 19;
  const raw = PANIC_BASE_CHANCE + PANIC_EXTRA_CHANCE * (1 - holder.condition.confidence) * (1 - composure);
  return Math.min(PANIC_MAX_CHANCE, raw);
}

function clearVelocity(holder, ball, rng, scale) {
  const forward = holder.attacksRight ? 0 : Math.PI;
  // Ke arah garis samping terdekat (dari sudut pandang arah serang).
  const towardTop = ball.y < PITCH.width / 2;
  const sideSign = (towardTop ? -1 : 1) * (holder.attacksRight ? 1 : -1);
  const angle =
    forward +
    sideSign * rng.range(CLEAR_MIN_ANGLE, CLEAR_MAX_ANGLE) +
    rng.normal(0, blunder(holder, 'passAngle') * scale);
  const speed = Math.min(MAX_KICK_SPEED, rng.range(CLEAR_MIN_SPEED, CLEAR_MAX_SPEED));
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

// ---- Umpan silang & sepak pojok (percobaan 2, 28 Okt) -----------------------
// Pemegang bola di sayap dekat garis gawang lawan, dengan rekan di kotak penalti,
// bisa melambungkan bola ke kepala rekan itu. Sepak pojok selalu dilambungkan
// kalau ada rekan di kotak.
const CROSS_ZONE_DEPTH = 30; // m dari garis gawang lawan
const CROSS_ZONE_MIN_WIDE = 10; // m dari garis tengah memanjang
const CORNER_RADIUS = 3; // m dari titik pojok
const CORNER_HOLD_TICKS = 20; // menunggu rekan masuk kotak
const CROSS_AIM_MIN_DEPTH = 4; // m dari garis gawang
const CROSS_AIM_MAX_DEPTH = 15;
const CROSS_AIM_TOWARD_GOAL = 1.5; // m: bidik sedikit di depan sasaran, ke arah gawang
// Penyerang yang menyerbu kotak saat umpan silang akan / sedang datang.
const BOX_RUN_ROLES = Object.freeze(['ST', 'LW', 'RW', 'LM', 'RM', 'AM', 'CM']);
const BOX_RUN_COUNT = 3;
// Striker menempel di bahu bek terakhir hanya saat bola sedekat ini ke garis gawang lawan.
const SHOULDER_BALL_RANGE = 40; // meter

function opponentGoalPoint(attacksRight) {
  return { x: attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
}

function depthToGoalLine(point, attacksRight) {
  return attacksRight ? PITCH.length - point.x : point.x;
}

export function inCrossZone(ball, attacksRight) {
  return (
    depthToGoalLine(ball, attacksRight) <= CROSS_ZONE_DEPTH && Math.abs(ball.y - PITCH.width / 2) >= CROSS_ZONE_MIN_WIDE
  );
}

function atCornerSpot(ball, attacksRight) {
  const goalLineX = attacksRight ? PITCH.length : 0;
  return Math.min(Math.hypot(ball.x - goalLineX, ball.y), Math.hypot(ball.x - goalLineX, ball.y - PITCH.width)) <= CORNER_RADIUS;
}

function inOpponentBox(point, attacksRight) {
  return insideOwnPenaltyArea(point, !attacksRight);
}

// Sasaran umpan silang terbaik: rekan di kotak lawan, tidak offside,
// dengan keunggulan udara terbesar atas bek terdekatnya. null kalau tidak ada.
function pickCrossTarget(holder, ball, players) {
  const opponents = players.filter((p) => p.teamId !== holder.teamId);
  const line = offsideLine(opponents, holder.attacksRight);
  const goal = opponentGoalPoint(holder.attacksRight);
  let best = null;
  for (const mate of players) {
    if (mate.teamId !== holder.teamId || mate.id === holder.id || mate.role === 'GK') continue;
    if (!inOpponentBox(mate, holder.attacksRight)) continue;
    if (isOffside(mate, ball, line, holder.attacksRight)) continue;
    let marker = null;
    for (const o of opponents) {
      if (o.role === 'GK') continue;
      if (!marker || distance(o, mate) < distance(marker, mate)) marker = o;
    }
    const gap = marker ? Math.min(4, distance(marker, mate)) : 4;
    const edge =
      (mate.skills.duelUdara - (marker ? marker.skills.duelUdara : 1)) / 19 + gap * 0.15 - distance(mate, goal) * 0.02;
    if (!best || edge > best.edge) best = { mate, edge };
  }
  if (!best) return null;

  // Bidik sedikit di depan sasaran (ke arah gawang), dalam rentang kedalaman yang wajar.
  const toGoal = distance(best.mate, goal);
  const lead = toGoal > 0 ? CROSS_AIM_TOWARD_GOAL / toGoal : 0;
  const raw = { x: best.mate.x + (goal.x - best.mate.x) * lead, y: best.mate.y + (goal.y - best.mate.y) * lead };
  const depth = Math.min(CROSS_AIM_MAX_DEPTH, Math.max(CROSS_AIM_MIN_DEPTH, depthToGoalLine(raw, holder.attacksRight)));
  const aim = { x: holder.attacksRight ? PITCH.length - depth : depth, y: raw.y };
  if (distance(ball, aim) < 6) return null; // terlalu dekat untuk dilambungkan
  return { target: best.mate, aim };
}

// Titik-titik serbuan kotak: tiang dekat, titik penalti, tiang jauh (dilihat dari sisi bola).
function boxRunSpots(ball, attacksRight) {
  const mid = PITCH.width / 2;
  const side = ball.y < mid ? -1 : 1;
  const at = (depth, y) => ({ x: attacksRight ? PITCH.length - depth : depth, y });
  return [at(6, mid + side * 3), at(11, mid), at(6.5, mid - side * 3.5)];
}

// Penyerang mana menuju titik serbuan mana. Map playerId → titik.
function assignBoxRuns(players, teamId, ball, attacksRight, excluded) {
  const runs = new Map();
  const free = players.filter(
    (p) => p.teamId === teamId && BOX_RUN_ROLES.includes(p.role) && !excluded.has(p.id),
  );
  for (const spot of boxRunSpots(ball, attacksRight).slice(0, BOX_RUN_COUNT)) {
    let best = null;
    for (const p of free) {
      if (runs.has(p.id)) continue;
      if (!best || distance(p, spot) < distance(best, spot)) best = p;
    }
    if (best) runs.set(best.id, spot);
  }
  return runs;
}

// Keputusan pemegang bola:
//   { type: 'clear' } | { type: 'shoot', shot } | { type: 'cross', aim } | { type: 'pass', option }
//   | null (terus menggiring)
function decideHolder(holder, ball, players, rng, match) {
  const opponents = players.filter((p) => p.teamId !== holder.teamId);
  const context = conditionContext(holder, players, match);
  const { pressured } = context;

  // Bola mati dicek PALING AWAL: eksekutor tidak boleh memakai keputusan biasa (tembak/oper)
  // sebelum aturan bola matinya selesai (bug 29 Okt: penalti & tendangan bebas ditembak seperti biasa).
  // Penalti: langsung ditendang.
  if (ball.setPieceKind === 'penalty') return { type: 'penalty', context };

  // Tendangan bebas: tunggu pagar betis & posisi siap, lalu tembak langsung bila cukup dekat.
  if (ball.setPieceKind === 'freeKick') {
    if (ball.heldTicks < FREE_KICK.holdTicks) return null;
    if (ball.heldTicks === FREE_KICK.holdTicks) {
      const goal = opponentGoalPoint(holder.attacksRight);
      const near = distance(ball, goal) <= FREE_KICK.shotRange && goalAngle(ball, holder.attacksRight) >= FREE_KICK.minShotAngle;
      if (near && rng.chance(FREE_KICK.shotChance)) return { type: 'freeKickShot', context };
      // Tidak ditembak: lambungkan ke kotak bila cukup dekat & ada sasaran.
      if (distance(ball, goal) <= FREE_KICK.crossRange) {
        const target = pickCrossTarget(holder, ball, players);
        if (target) return { type: 'cross', aim: target.aim, context, freeKick: true };
      }
    }
  }

  if (canPanicClear(holder, ball, match) && rng.chance(panicChance(holder))) return { type: 'clear', context };

  // Lolos satu lawan satu: tidak mengoper, lari ke gawang dan tembak saat cukup dekat.
  const breakaway = isBreakaway(holder, opponents, holder.attacksRight);

  if (ball.heldTicks >= SHOT_MIN_TICKS) {
    // Insting gol: makin dekat gawang lawan, makin besar dorongan menembak.
    const toGoal = distance(ball, opponentGoalPoint(holder.attacksRight));
    const shot = evaluateShot({
      origin: ball,
      opponents,
      attacksRight: holder.attacksRight,
      pressured,
      thresholdScale: shotThresholdScale(holder) * instinctShotScale(holder, toGoal),
      shotSpeed: shotSpeedFor(holder),
      screeners: players.filter((p) => p.id !== holder.id),
    });
    if (shot?.shouldShoot) return { type: 'shoot', shot, context };
    if (breakaway && shot && shot.quality > 0 && shot.distance <= BREAKAWAY_SHOOT_DISTANCE) {
      return { type: 'shoot', shot, context };
    }
  }
  if (breakaway) return null;

  // Sepak pojok: tunggu rekan masuk kotak, lalu lambungkan.
  const corner = atCornerSpot(ball, holder.attacksRight);
  if (corner && ball.heldTicks < CORNER_HOLD_TICKS) return null;
  const cross = holder.role !== 'GK' && inCrossZone(ball, holder.attacksRight) ? pickCrossTarget(holder, ball, players) : null;
  if (cross && corner) return { type: 'cross', aim: cross.aim, context };

  // Rekan mulai berlari ke belakang garis bek: lihat dan layani larinya sekarang.
  const runnerAvailable = players.some((p) => p.teamId === holder.teamId && p.task === 'run');
  const ready =
    ball.heldTicks >= ball.holdTarget ||
    (pressured && ball.heldTicks >= PRESSURED_MIN_TICKS) ||
    (runnerAvailable && ball.heldTicks >= RUN_SPOT_MIN_TICKS);
  if (!ready) return null;

  // Kecenderungan umpan silang dari filosofi pelatih.
  if (cross && rng.chance(match.philosophies[holder.teamId].crossPreference)) {
    return { type: 'cross', aim: cross.aim, context };
  }

  const options = evaluatePassOptions({
    holder,
    origin: ball,
    teammates: players.filter((p) => p.teamId === holder.teamId),
    opponents,
    attacksRight: holder.attacksRight,
    previousOwnerId: ball.previousOwnerId,
    rng,
    misjudgeScale: blunderScale(holder, context),
    progressScale: progressWeightScale(holder),
  });
  const best = options[0] ?? null;
  // Tidak ada operan aman: umpan silang jadi jalan keluar sebelum dipaksa mengoper.
  if (cross && !best?.safe) return { type: 'cross', aim: cross.aim, context };
  if (!best) return null;

  const forced =
    ball.heldTicks >= FORCED_PASS_TICKS || (pressured && ball.heldTicks >= PRESSURED_FORCED_TICKS);
  return best.safe || forced ? { type: 'pass', option: best, context } : null;
}

// Bola meninggalkan kaki pemain (operan, tembakan, atau terlepas karena tekel).
function releaseBall(ball, kicker, velocity, extra) {
  return {
    ...ball,
    vx: velocity.vx,
    vy: velocity.vy,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    previousOwnerId: kicker.id,
    kickerId: kicker.id,
    kickCooldown: KICK_COOLDOWN_TICKS,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    offsideFlagIds: [],
    offsideTrueIds: [],
    offsideTeamId: null,
    lastTouchTeamId: kicker.teamId,
    restartTeamId: null,
    restartKind: null,
    setPieceKind: null,
    z: 0,
    vz: 0,
    crossTeamId: null,
    shotKind: null,
    ...extra,
  };
}

// Arah dan laju operan setelah diberi meleset sesuai stat Passing pengoper,
// diperbesar oleh kondisi (scale ≥ 1: lelah, tekanan, percaya diri, form).
function passVelocity(ball, option, passer, rng, scale = 1) {
  const d = distance(ball, option.target);
  if (!(d > 0)) throw new Error('passVelocity: jarak operan nol');
  const angle =
    Math.atan2(option.target.y - ball.y, option.target.x - ball.x) + rng.normal(0, blunder(passer, 'passAngle') * scale);
  const speedFactor = Math.max(0.5, 1 + rng.normal(0, blunder(passer, 'passSpeed') * scale));
  const speed = Math.min(MAX_KICK_SPEED, option.speed * speedFactor);
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

// Sentuhan pertama terlalu jauh (stat Kontrol): bola memantul dari kaki,
// makin sering untuk bola yang datang kencang. Kiper yang memakai tangan
// di kotaknya tidak terkena aturan ini (lihat keeper.js).
const HEAVY_TOUCH_MAX_CHANCE = 0.6;
const HEAVY_TOUCH_SPEED_MIN = 0.3; // bagian dari laju datang
const HEAVY_TOUCH_SPEED_MAX = 0.55;
const HEAVY_TOUCH_SPREAD = (40 * Math.PI) / 180;

// Tembakan yang mengenai bek lapangan biasanya memantul liar, tidak langsung dikuasai.
const BLOCK_DEFLECT_CHANCE = 0.75;
const DEFLECT_SPEED_MIN = 0.25; // bagian dari laju datang
const DEFLECT_SPEED_MAX = 0.55;
const DEFLECT_SPREAD = (60 * Math.PI) / 180;

function deflectVelocity(ball, rng) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const angle = Math.atan2(ball.vy, ball.vx) + Math.PI + rng.range(-DEFLECT_SPREAD, DEFLECT_SPREAD);
  const out = speed * rng.range(DEFLECT_SPEED_MIN, DEFLECT_SPEED_MAX);
  return { vx: Math.cos(angle) * out, vy: Math.sin(angle) * out };
}

function reactionTicks(player) {
  return Math.round(player.profile.reaction * TICK_RATE);
}

function heavyTouchChance(player, incomingSpeed, scale = 1) {
  return Math.min(HEAVY_TOUCH_MAX_CHANCE, (incomingSpeed / 10) * blunder(player, 'heavyTouchPer10ms') * scale);
}

function heavyTouchVelocity(ball, rng) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const angle = Math.atan2(ball.vy, ball.vx) + rng.range(-HEAVY_TOUCH_SPREAD, HEAVY_TOUCH_SPREAD);
  const out = speed * rng.range(HEAVY_TOUCH_SPEED_MIN, HEAVY_TOUCH_SPEED_MAX);
  return { vx: Math.cos(angle) * out, vy: Math.sin(angle) * out };
}

// Apakah arah bola saat ini akan melewati garis gawang di antara tiang?
function headingBetweenPosts(ball) {
  if (ball.vx === 0) return false;
  const lineX = ball.vx > 0 ? PITCH.length : 0;
  const y = ball.y + ball.vy * ((lineX - ball.x) / ball.vx);
  return isBetweenPosts(y);
}

// Tembakan lawan yang sampai ke jangkauan kiper di kotaknya sendiri.
function isShotReachingKeeper(ball, player, point) {
  return (
    player.role === 'GK' &&
    ball.shotTeamId !== null &&
    ball.shotTeamId !== player.teamId &&
    isKeeperHandling(player, point)
  );
}

// tempo: pengali lama menahan bola dari filosofi pelatih (philosophy.js).
function gainControl(ball, controller, stats, rng, note, tempo = 1) {
  if (typeof note !== 'function') throw new TypeError('gainControl: note wajib berupa fungsi');
  if (!(tempo > 0)) throw new RangeError(`gainControl: tempo tidak valid ${tempo}`);
  if (ball.passTeamId !== null && controller.teamId === ball.passTeamId) {
    stats.passes[controller.teamId].completed += 1;
    if (ball.kickerId) note(ball.kickerId, 'passCompleted');
  } else if (ball.passTeamId !== null && ball.kickerId) {
    note(ball.kickerId, 'passIntercepted');
  }
  const isRestart = ball.restartTeamId !== null;
  if (!isRestart && ball.lastTouchTeamId !== null && controller.teamId !== ball.lastTouchTeamId) {
    stats.turnovers += 1;
  }

  const isKeeper = controller.role === 'GK';
  return {
    ...ball,
    ...ballAtFeet(controller),
    vx: controller.vx,
    vy: controller.vy,
    ownerId: controller.id,
    heldTicks: 0,
    holdTarget: isKeeper
      ? rng.int(KEEPER_HOLD_MIN_TICKS, KEEPER_HOLD_MAX_TICKS)
      : Math.max(
          MIN_HOLD_TICKS,
          Math.round(rng.int(HOLD_MIN_TICKS, HOLD_MAX_TICKS) * tempo * blunder(controller, 'holdTempo')),
        ),
    previousOwnerId: ball.kickerId ?? ball.previousOwnerId,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    offsideFlagIds: [],
    offsideTrueIds: [],
    offsideTeamId: null,
    lastTouchTeamId: controller.teamId,
    restartTeamId: null,
    restartKind: null,
    // Pemegang bola yang mengeksekusi bola mati (pojok, lemparan, tendangan gawang
    // dibebaskan dari offside saat bola itu dimainkan).
    setPieceKind: isRestart ? ball.restartKind : null,
    z: 0,
    vz: 0,
    crossTeamId: null,
    shotKind: null,
  };
}

// Di mana lintasan from→to memotong garis gawang, kalau memotong.
// Mengembalikan { lineX, y, u } (u = posisi relatif di lintasan) atau null.
export function goalLineCrossing(from, to) {
  for (const lineX of [0, PITCH.length]) {
    // Bola harus melewati garis sepenuhnya; berada tepat di garis belum dihitung.
    const crosses = (from.x - lineX) * (to.x - lineX) < 0;
    if (!crosses) continue;
    const u = (lineX - from.x) / (to.x - from.x);
    return { lineX, y: from.y + (to.y - from.y) * u, u };
  }
  return null;
}

// Bola keluar: diberikan ke lawan dari tim yang terakhir menyentuh.
//   lewat garis samping              → lemparan ke dalam (versi sederhana) di titik keluar
//   lewat garis gawang, milik bertahan → tendangan gawang dari tepi kotak gawang
//   lewat garis gawang, milik penyerang → sepak pojok
function restartFromOut(ball, from, outPoint, teams, teamIds) {
  const restartTeamId = teamIds.find((id) => id !== ball.lastTouchTeamId) ?? teamIds[0];
  const crossing = goalLineCrossing(from, outPoint);
  const mid = PITCH.width / 2;
  let spot;
  let restartKind = 'throwIn';

  if (crossing) {
    const defendingTeamId = teamIds.find((id) => teams[id].attacksRight === (crossing.lineX === 0));
    restartKind = restartTeamId === defendingTeamId ? 'goalKick' : 'corner';
    if (restartTeamId === defendingTeamId) {
      const halfGoalArea = PITCH.goalAreaWidth / 2;
      spot = {
        x: crossing.lineX === 0 ? PITCH.goalAreaDepth : PITCH.length - PITCH.goalAreaDepth,
        y: Math.min(mid + halfGoalArea, Math.max(mid - halfGoalArea, crossing.y)),
      };
    } else {
      spot = {
        x: crossing.lineX === 0 ? RESTART_INSET : PITCH.length - RESTART_INSET,
        y: crossing.y < mid ? RESTART_INSET : PITCH.width - RESTART_INSET,
      };
    }
  } else {
    spot = clampToPitch(outPoint, RESTART_INSET);
  }

  return {
    ...ball,
    ...spot,
    vx: 0,
    vy: 0,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    offsideFlagIds: [],
    offsideTrueIds: [],
    offsideTeamId: null,
    restartTeamId,
    restartKind,
    setPieceKind: null,
    z: 0,
    vz: 0,
    crossTeamId: null,
    shotKind: null,
  };
}

// ---- Tendangan bebas (tahap 7b-1) -------------------------------------------
export const FREE_KICK = Object.freeze({
  holdTicks: 20, // eksekutor menunggu 2 detik: pagar betis & posisi disiapkan
  wallRange: 32, // meter ke gawang: dalam jarak ini bertahan memasang pagar betis
  wallSize: 3,
  wallSpacing: 0.8,
  distance: 9.15, // lawan minimal sejauh ini dari bola
  shotRange: 30, // meter ke tengah gawang: boleh ditembak langsung
  crossRange: 42, // meter ke tengah gawang: dilambungkan ke kotak bila tidak ditembak
  minShotAngle: 0.22, // radian sudut gawang yang terlihat
  shotChance: 0.7, // peluang memilih tembakan langsung saat syarat terpenuhi
  shotSpreadScale: 1.4, // lebih sulit dari tembakan biasa
  arrivalHeight: 1.6, // meter: bola melewati pagar dan turun di bawah mistar
});

// ---- Penalti (dimajukan dari 7c, 29 Okt) -------------------------------------
export const PENALTY = Object.freeze({
  takerGap: 0.8, // meter di belakang bola
  outsideDepth: 18.5, // meter dari garis gawang: pemain lain berjejer di tepi luar kotak
  slotSpacing: 2.2,
  staggerDepth: 3,
  arcClearance: 9.65, // meter dari titik penalti
  postInsetMin: 0.45, // bidikan: sekian meter di dalam tiang (di luar jangkauan kiper yang diam)
  postInsetMax: 1.1,
  placementScale: 0.45, // bola diam di titik penalti jauh lebih mudah diarahkan daripada tembakan biasa
  pressureSpread: 0.4, // tambahan meleset × (1 − Ketenangan)
  // Kiper menebak arah: peluang tebakan benar dari Penempatan, laju lompatan dari Refleks.
  // Peluang tebakan benar YANG BERBUAH jangkauan (kiper yang menebak benar pun sering tidak sampai).
  guess: Object.freeze({ low: 0.14, high: 0.26 }),
  commitTicks: 8, // kiper yang sudah melompat tidak bisa berbalik arah selama 0,8 detik
  diveSpeed: Object.freeze({ low: 2.2, high: 3.4 }), // m/s; tebakan benar pun tidak selalu terjangkau
});

export function penaltySpot(kickerAttacksRight) {
  return {
    x: kickerAttacksRight ? PITCH.length - PITCH.penaltySpotDistance : PITCH.penaltySpotDistance,
    y: PITCH.width / 2,
  };
}

export function penaltyBall(ball, kickerTeamId, teams) {
  return {
    ...freeKickBallAt(ball, penaltySpot(teams[kickerTeamId].attacksRight), kickerTeamId, teams),
    restartKind: 'penalty',
  };
}

// Penendang: pemain lapangan dengan Finishing + Ketenangan terbaik.
export function pickPenaltyTaker(players, teamId) {
  const score = (p) => p.skills.finishing + p.skills.ketenangan;
  const candidates = players
    .filter((p) => p.teamId === teamId && p.role !== 'GK')
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  if (candidates.length === 0) throw new Error(`pickPenaltyTaker: tim ${teamId} tanpa pemain lapangan`);
  return candidates[0];
}

// Posisi saat penalti: penendang di belakang bola, kiper bertahan di garis gawang,
// pemain lain di luar kotak & busur, di belakang bola. Map playerId → titik.
export function penaltyTargets(players, kickerTeamId, teams) {
  const attacksRight = teams[kickerTeamId].attacksRight;
  const spot = penaltySpot(attacksRight);
  const goalLineX = attacksRight ? PITCH.length : 0;
  const toward = attacksRight ? 1 : -1; // arah ke gawang yang diserang
  const taker = pickPenaltyTaker(players, kickerTeamId);
  const targets = new Map();
  // Satu baris di tepi luar kotak, kiri-kanan busur penalti: tempat terdekat ke tengah dipakai dulu.
  const slots = [];
  const dx = PENALTY.outsideDepth - PITCH.penaltySpotDistance;
  const minLat = Math.sqrt(Math.max(0, PENALTY.arcClearance ** 2 - dx ** 2));
  for (let k = 0; k < 14; k += 1) {
    for (const side of [-1, 1]) {
      const y = PITCH.width / 2 + side * (minLat + k * PENALTY.slotSpacing);
      if (y < 1 || y > PITCH.width - 1) continue;
      // Berselang-seling di dua kedalaman supaya jersey & nama tidak saling menumpuk.
      const depth = PENALTY.outsideDepth + (k % 2) * PENALTY.staggerDepth;
      slots.push({ x: goalLineX - toward * depth, y });
    }
  }
  const needed = players.filter((p) => p.id !== taker.id && p.role !== 'GK').length;
  if (slots.length < needed) throw new Error(`penaltyTargets: tempat di tepi kotak kurang (${slots.length} < ${needed})`);
  slots.length = needed; // hanya tempat terdekat ke tengah
  const used = new Set();
  const others = players
    .filter((p) => p.id !== taker.id && p.role !== 'GK')
    .sort((a, b) => distance(a, spot) - distance(b, spot) || a.id.localeCompare(b.id));
  for (const p of others) {
    let best = -1;
    for (let i = 0; i < slots.length; i += 1) {
      if (used.has(i)) continue;
      if (best < 0 || distance(p, slots[i]) < distance(p, slots[best])) best = i;
    }
    if (best < 0) throw new Error('penaltyTargets: tempat di luar kotak habis');
    used.add(best);
    targets.set(p.id, slots[best]);
  }
  for (const p of players) {
    if (p.id === taker.id) targets.set(p.id, { x: spot.x - toward * PENALTY.takerGap, y: spot.y });
    else if (p.role === 'GK' && p.teamId !== kickerTeamId) targets.set(p.id, { x: goalLineX - toward * 0.3, y: PITCH.width / 2 });
    else if (p.role === 'GK') targets.set(p.id, slotToPitch(p.slot, p.attacksRight));
  }
  return targets;
}

// Tendangan penalti: pilih sisi, bidik di dalam tiang, meleset dari Finishing + tekanan (Ketenangan).
function penaltyShot(spot, taker, rng, scale) {
  const goalX = taker.attacksRight ? PITCH.length : 0;
  const side = rng.chance(0.5) ? 1 : -1;
  const inset = rng.range(PENALTY.postInsetMin, PENALTY.postInsetMax);
  const aim = { x: goalX, y: PITCH.width / 2 + side * (PITCH.goalWidth / 2 - inset) };
  const pressure = 1 + PENALTY.pressureSpread * (1 - (taker.skills.ketenangan - 1) / 19);
  const spread = blunder(taker, 'shotSpread') * PENALTY.placementScale * pressure * scale;
  return { aim, side, velocity: shotVelocity(spot, aim, taker.attacksRight, rng, spread, shotSpeedFor(taker)) };
}

// Kiper menebak arah tendangan penalti dan melompat. Mengembalikan { target, vx, vy }.
function keeperDive(keeper, shotSide, rng) {
  const t = (v) => (v - 1) / 19;
  const guessRight = rng.chance(PENALTY.guess.low + (PENALTY.guess.high - PENALTY.guess.low) * t(keeper.skills.penempatan ?? 10));
  const side = guessRight ? shotSide : -shotSide;
  const speed = PENALTY.diveSpeed.low + (PENALTY.diveSpeed.high - PENALTY.diveSpeed.low) * t(keeper.skills.refleks ?? 10);
  const target = { x: keeper.x, y: PITCH.width / 2 + side * (PITCH.goalWidth / 2) };
  return { target, vx: 0, vy: side * speed, guessRight };
}

// Bola mati tendangan bebas untuk tim pemegang bola yang dilanggar, di titik pelanggaran.
// Pelanggaran di kotak penalti sendiri seharusnya penalti (tahap 7c): sementara dipindah
// ke tepat di luar kotak.
function freeKickBall(ball, fouled, teams) {
  return freeKickBallAt(ball, clampToPitch(fouled, 0.5), fouled.teamId, teams);
}

// Pelanggaran di kotak penalti lawan si pelanggar → penalti.
function foulInPenaltyArea(fouled, teams) {
  return insideOwnPenaltyArea(fouled, !teams[fouled.teamId].attacksRight);
}

function freeKickBallAt(ball, spot, teamId, teams) {
  return {
    ...ball,
    ...spot,
    vx: 0,
    vy: 0,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    offsideFlagIds: [],
    offsideTrueIds: [],
    offsideTeamId: null,
    lastTouchTeamId: teamOther(teams, teamId), // tim pelanggar
    restartTeamId: teamId,
    restartKind: 'freeKick',
    setPieceKind: null,
    z: 0,
    vz: 0,
    crossTeamId: null,
    shotKind: null,
  };
}

function freeKickShotVelocity(ball, taker, keeper, rng, scale) {
  const goalX = taker.attacksRight ? PITCH.length : 0;
  const mid = PITCH.width / 2;
  const inner = PITCH.goalWidth / 2 - 0.6;
  const aim = { x: goalX, y: (keeper ? keeper.y : mid) <= mid ? mid + inner : mid - inner };
  const d = distance(ball, aim);
  const speed = shotSpeedFor(taker);
  const angle =
    Math.atan2(aim.y - ball.y, aim.x - ball.x) + rng.normal(0, blunder(taker, 'shotSpread') * FREE_KICK.shotSpreadScale * scale);
  const T = d / speed;
  const vz = (FREE_KICK.arrivalHeight + 0.5 * GRAVITY * T * T) / T;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, vz };
}

function teamOther(teams, teamId) {
  const other = Object.keys(teams).find((id) => id !== teamId);
  if (!other) throw new Error(`teamOther: tim lawan ${teamId} tidak ada`);
  return other;
}

// Posisi bertahan saat tendangan bebas: pagar betis (bila dekat gawang) dan semua lawan ≥ 9,15 m.
// Map playerId → titik, hanya untuk pemain tim bertahan.
function freeKickDefence(ball, defenders, attacksRightOfKicker) {
  const goal = { x: attacksRightOfKicker ? PITCH.length : 0, y: PITCH.width / 2 };
  const toGoal = distance(ball, goal);
  const targets = new Map();
  if (toGoal <= FREE_KICK.wallRange && toGoal > FREE_KICK.distance + 1) {
    const ux = (goal.x - ball.x) / toGoal;
    const uy = (goal.y - ball.y) / toGoal;
    const center = { x: ball.x + ux * FREE_KICK.distance, y: ball.y + uy * FREE_KICK.distance };
    const outfield = defenders.filter((p) => p.role !== 'GK').sort((a, b) => distance(a, center) - distance(b, center) || a.id.localeCompare(b.id));
    outfield.slice(0, FREE_KICK.wallSize).forEach((p, i) => {
      const offset = (i - (FREE_KICK.wallSize - 1) / 2) * FREE_KICK.wallSpacing;
      targets.set(p.id, clampToPitch({ x: center.x - uy * offset, y: center.y + ux * offset }, 0.5));
    });
  }
  return targets;
}

function freeKickNearGoal(ball, owner, teams) {
  const teamId = ball.restartKind === 'freeKick' ? ball.restartTeamId : ball.setPieceKind === 'freeKick' ? owner?.teamId : null;
  if (!teamId) return false;
  const goal = { x: teams[teamId].attacksRight ? PITCH.length : 0, y: PITCH.width / 2 };
  return distance(ball, goal) <= FREE_KICK.crossRange;
}

// Menjaga jarak dari bola mati TANPA mundur ke garis gawang: geser ke samping pada
// kedalaman yang sama (dulu didorong menjauh lurus dari bola, sehingga saat tendangan
// bebas di tepi kotak semua bek menumpuk di garis gawang — masukan 29 Okt).
function pushAway(target, ball, minDistance) {
  const d = distance(target, ball);
  if (d >= minDistance) return target;
  const dx = target.x - ball.x;
  const lateral = Math.sqrt(Math.max(0, minDistance * minDistance - dx * dx));
  const side = target.y - ball.y >= 0 ? 1 : -1;
  let y = ball.y + side * lateral;
  // Kalau sisi itu keluar lapangan, pindah ke sisi seberang.
  if (y < 0.5 || y > PITCH.width - 0.5) y = ball.y - side * lateral;
  return clampToPitch({ x: target.x, y }, 0.5);
}

// Bola mati yang dibebaskan dari offside saat dimainkan (Laws of the Game, hukum 11).
const OFFSIDE_EXEMPT = Object.freeze(['corner', 'throwIn', 'goalKick', 'penalty']);

// Titik acuan offside di tiap separuh (untuk posisi hakim garis).
function offsideReferences(players, ball) {
  const ref = (attacksRight) => {
    const defenders = players.filter((p) => p.attacksRight !== attacksRight);
    return offsideReferenceX(offsideLine(defenders, attacksRight), ball, attacksRight);
  };
  return { right: ref(true), left: ref(false) };
}

// Posisi kick-off: penendang berdiri di belakang bola di titik tengah, rekannya di
// posisi formasi, lawan di luar lingkaran tengah. Map playerId → titik.
const KICKOFF_TAKER_GAP = 0.7; // meter di belakang bola
const CIRCLE_CLEARANCE = 0.5; // meter di luar lingkaran tengah
export function pickKickoffTaker(players, kickOffTeamId) {
  const center = { x: PITCH.length / 2, y: PITCH.width / 2 };
  const candidates = players
    .filter((p) => p.teamId === kickOffTeamId && p.role !== 'GK')
    .map((p) => ({ p, d: distance(slotToPitch(p.slot, p.attacksRight), center) }))
    .sort((a, b) => (a.p.role === 'ST' ? 0 : 1) - (b.p.role === 'ST' ? 0 : 1) || a.d - b.d || a.p.id.localeCompare(b.p.id));
  if (candidates.length === 0) throw new Error(`pickKickoffTaker: tim ${kickOffTeamId} tanpa pemain lapangan`);
  return candidates[0].p;
}

export function kickoffTargets(players, kickOffTeamId) {
  const center = { x: PITCH.length / 2, y: PITCH.width / 2 };
  const taker = pickKickoffTaker(players, kickOffTeamId);
  const minRadius = PITCH.centerCircleRadius + CIRCLE_CLEARANCE;
  const targets = new Map();
  for (const p of players) {
    if (p.id === taker.id) {
      targets.set(p.id, { x: center.x + (p.attacksRight ? -KICKOFF_TAKER_GAP : KICKOFF_TAKER_GAP), y: center.y });
      continue;
    }
    let spot = slotToPitch(p.slot, p.attacksRight);
    // Semua pemain di separuh sendiri.
    const ownMaxX = PITCH.length / 2 - 0.5;
    if (p.attacksRight && spot.x > ownMaxX) spot = { ...spot, x: ownMaxX };
    if (!p.attacksRight && spot.x < PITCH.length - ownMaxX) spot = { ...spot, x: PITCH.length - ownMaxX };
    // Lawan di luar lingkaran tengah (ke arah gawangnya sendiri).
    if (p.teamId !== kickOffTeamId) {
      const d = distance(spot, center);
      if (d < minRadius) {
        const dir = d > 1e-6 ? { x: (spot.x - center.x) / d, y: (spot.y - center.y) / d } : { x: p.attacksRight ? -1 : 1, y: 0 };
        spot = { x: center.x + dir.x * minRadius, y: center.y + dir.y * minRadius };
      }
    }
    targets.set(p.id, spot);
  }
  return targets;
}

export function createSimulation(home, away, seed) {
  if (!Number.isInteger(seed)) throw new TypeError(`createSimulation: seed harus bilangan bulat, dapat ${seed}`);

  const rng = createRng(seed);
  let state = createMatchState(home, away);
  const teamIds = Object.keys(state.teams);
  state = { ...state, players: state.players.map((p) => ({ ...p, condition: initialCondition(p.skills, rng) })) };
  state = { ...state, officials: createOfficials(rng) };

  // Hakim garis menilai posisi offside saat seorang pemain memainkan bola.
  // exempt: bola mati yang dibebaskan dari offside (pojok, lemparan, tendangan gawang).
  function markPlay(b, kicker, positions, exempt, officials) {
    const empty = { ...b, offsideFlagIds: [], offsideTrueIds: [], offsideTeamId: null };
    if (exempt) return empty;
    const ar = kicker.attacksRight;
    const defenders = positions.filter((p) => p.teamId !== kicker.teamId);
    const refX = offsideReferenceX(offsideLine(defenders, ar), b, ar);
    const refDepth = ar ? refX : PITCH.length - refX;
    const assistant = assistantFor(officials, ar);
    const misalignment = Math.abs(assistant.x - refX);
    const flagged = [];
    const truly = [];
    for (const p of positions) {
      if (p.teamId !== kicker.teamId || p.id === kicker.id || p.role === 'GK') continue;
      const depth = forwardOf(p, ar);
      if (depth <= PITCH.length / 2) continue; // separuh sendiri: tidak bisa offside
      const margin = depth - refDepth;
      if (margin > 0) truly.push(p.id);
      if (margin < -ASSISTANT.maxError) continue;
      if (rng.chance(flagChance({ margin, misalignment, ketelitian: assistant.skills.ketelitian }))) flagged.push(p.id);
    }
    return { ...b, offsideFlagIds: flagged, offsideTrueIds: truly, offsideTeamId: kicker.teamId };
  }

  // Lari ke belakang garis bek: lanjutkan, akhiri, atau mulai lari baru.
  // Hanya untuk tim yang sedang menguasai bola; satu pelari per tim.
  function updateRunner(team, owner, ball, players, line, runCooldowns) {
    const endRun = () => {
      if (team.runnerId !== null) runCooldowns.set(team.runnerId, RUN_COOLDOWN_TICKS);
      Object.assign(team, { runnerId: null, runTarget: null, runTicks: 0 });
    };
    const inPossession = owner !== null && owner.teamId === team.id;

    if (team.runnerId !== null) {
      // Operan sudah datang ke pelari: dia kini penerima (pengejar), larinya selesai.
      if (ball.passTargetId === team.runnerId) return endRun();
      team.runTicks += 1;
      const stillOn =
        inPossession && owner.id !== team.runnerId && team.chaserId !== team.runnerId && team.runTicks <= RUN_MAX_TICKS;
      if (!stillOn) endRun();
      return undefined;
    }

    if (!inPossession || !rng.chance(RUN_START_CHANCE)) return undefined;
    const pick = pickRunner({
      teammates: players.filter((p) => p.teamId === team.id),
      holder: owner,
      defenders: players.filter((p) => p.teamId !== team.id),
      ballPoint: ball,
      attacksRight: team.attacksRight,
    });
    if (pick && Number.isFinite(line)) {
      Object.assign(team, { runnerId: pick.player.id, runTarget: pick.target, runTicks: 0 });
      return team.id; // lari baru dimulai
    }
    return undefined;
  }

  // 0. Persiapan kick-off (awal babak / setelah gol): jam berhenti, semua pemain
  //    berjalan ke posisi formasinya. Hitung mundur tunggu baru berjalan setelah
  //    semua sampai (atau setelah MAX_RETURN_TICKS, supaya tidak menunggu selamanya).
  function stepPause(prev, tick, stats) {
    const targets =
      prev.pauseReason === 'penalty'
        ? penaltyTargets(prev.players, prev.ball.restartTeamId, prev.teams)
        : kickoffTargets(prev.players, prev.ball.restartTeamId);
    const players = prev.players.map((player) => {
      const target = targets.get(player.id);
      const body = stepBody(player, target, DT);
      const condition = driftConfidence(
        { ...player.condition, energy: drainEnergy(player, Math.hypot(body.vx, body.vy), DT) },
        DT,
      );
      return {
        ...player,
        ...body,
        target,
        task: 'shape',
        tackleCooldown: Math.max(0, player.tackleCooldown - 1),
        reactionDelay: 0,
        condition,
        discipline: calmDown(player.discipline, DT),
      };
    });
    stats.pauseTicks += 1;
    const settled =
      prev.pauseElapsed >= MAX_RETURN_TICKS ||
      players.every((p) => distance(p, targets.get(p.id)) <= SETTLE_DISTANCE && Math.hypot(p.vx, p.vy) <= SETTLE_SPEED);
    const pauseTicks = settled ? prev.pauseTicks - 1 : prev.pauseTicks;
    const done = pauseTicks === 0;
    const officials = stepOfficials(prev.officials, prev.ball, offsideReferences(players, prev.ball), true, DT);
    return {
      ...prev,
      tick,
      players,
      stats,
      officials,
      pauseTicks,
      pauseReason: done ? null : prev.pauseReason,
      pauseElapsed: done ? 0 : prev.pauseElapsed + 1,
      // Peluit kick-off saat persiapan selesai.
      whistle: done
        ? { tick, kind: prev.pauseReason === 'penalty' ? 'penalty' : 'kickoff', teamId: prev.ball.restartTeamId }
        : prev.whistle,
    };
  }

  // Satu tick permainan (dipanggil hanya saat babak sedang berjalan).
  function advance() {
    const prev = state;
    const tick = prev.tick + 1;
    const stats = cloneStats(prev.stats);

    if (prev.pauseTicks > 0) {
      state = stepPause(prev, tick, stats);
      return state;
    }

    const teams = Object.fromEntries(teamIds.map((id) => [id, { ...prev.teams[id] }]));
    const byId = new Map(prev.players.map((p) => [p.id, p]));
    let ball = { ...prev.ball };
    let lastGoal = prev.lastGoal;
    let whistle = prev.whistle;
    let pause = { pauseTicks: 0, pauseReason: null, pauseElapsed: 0 };

    const cooldownOverrides = new Map();
    // Disiplin yang berubah di tick ini (pelanggaran, kartu, emosi), diterapkan saat pemain bergerak.
    const disciplineUpdates = new Map();
    const disciplineOf = (p) => disciplineUpdates.get(p.id) ?? p.discipline;
    const runCooldowns = new Map();
    // Tim yang penyerangnya baru mulai berlari di tick ini: lawan butuh waktu membacanya.
    const runStartedBy = new Set();
    const stumbled = new Set();
    // Siapa yang melepas bola di tick ini (operan, tembakan, tekel): pemain lain
    // butuh waktu reaksi (stat Antisipasi) sebelum mengubah arah larinya.
    let ballReleasedBy = null;
    let screenedKeeperId = null; // kiper yang pandangannya terhalang pada tembakan tick ini
    const dives = new Map(); // kiper yang melompat menebak arah penalti: id → { target, vx, vy }

    // Kondisi (tahap 6): skor & menit untuk konteks, dan peristiwa percaya diri
    // yang dikumpulkan sepanjang tick lalu diterapkan di akhir.
    const philosophies = Object.fromEntries(teamIds.map((id) => [id, getPhilosophy(teams[id].philosophy)]));
    const match = { goals: prev.stats.goals, minute: gameClock(prev).minute, teamIds, philosophies };
    const tempoOf = (player) => philosophies[player.teamId].tempo;
    const events = [];
    const note = (playerId, event) => events.push([playerId, event]);

    // 1. Duel dan keputusan pemegang bola.
    if (ball.ownerId !== null) {
      const holder = byId.get(ball.ownerId);
      if (!holder) throw new Error(`step: pemegang bola ${ball.ownerId} tidak ditemukan`);
      ball.heldTicks += 1;

      const opponents = prev.players.filter((p) => p.teamId !== holder.teamId);
      // Bola di tangan kiper tidak boleh ditekel.
      // Pemain yang sudah dikartu kuning lebih jarang mencoba tekel (fouls.js: cautionScale).
      // Eksekutor tendangan bebas yang sedang bersiap tidak boleh ditekel.
      const freeKickSetup =
        (ball.setPieceKind === 'freeKick' && ball.heldTicks < FREE_KICK.holdTicks) || ball.setPieceKind === 'penalty';
      const tackler =
        isKeeperHandling(holder, ball) || freeKickSetup
          ? null
          : pickTackler(holder, opponents, rng, (p) =>
              insideOwnPenaltyArea(holder, p.attacksRight) ? cautionScale(p) * boxAttemptScale(p) : cautionScale(p),
            );
      let tackled = false;
      const setPiece = ball.setPieceKind;

      if (tackler) {
        stats.tackles[tackler.teamId].attempted += 1;
        const won = rng.chance(tackleSuccessChance(tackler, holder));
        const fromBehind = isFromBehind(tackler, holder);
        const trailingLate = match.minute >= 70 && match.goals[tackler.teamId] < match.goals[holder.teamId];
        let foulStopsPlay = false;

        const inOwnBox = insideOwnPenaltyArea(holder, tackler.attacksRight);
        if (rng.chance(foulChance(tackler, { won, fromBehind, trailingLate, inOwnBox }))) {
          const referee = prev.officials.referee;
          const breaking = isLastMan(tackler, holder, prev.players) || isBreakaway(holder, opponents, holder.attacksRight);
          const kind = breaking ? 'tactical' : fromBehind ? 'fromBehind' : 'reckless';
          const yellow = rng.chance(yellowChance(referee, kind, tackler));
          if (rng.chance(callChance(referee, holder, yellow))) {
            stats.fouls[tackler.teamId] += 1;
            const tacklerDiscipline = disciplineOf(tackler);
            let nextDiscipline = { ...tacklerDiscipline, fouls: tacklerDiscipline.fouls + 1 };
            let card = null;
            if (yellow) {
              if (nextDiscipline.yellows === 0) {
                nextDiscipline = raiseAgitation({ ...nextDiscipline, yellows: 1 }, tackler.skills, AGITATION.booked, false);
                stats.yellows[tackler.teamId] += 1;
                card = 'yellow';
              } else {
                // Kuning kedua = kartu merah di tahap 7c. Untuk sekarang hanya dicatat.
                stats.secondYellows[tackler.teamId] += 1;
                card = 'secondYellow';
              }
            }
            disciplineUpdates.set(tackler.id, nextDiscipline);
            disciplineUpdates.set(holder.id, raiseAgitation(disciplineOf(holder), holder.skills, AGITATION.fouled));
            note(tackler.id, 'beaten');

            if (!won && advantageApplies(holder, opponents, tackler.id)) {
              // Keuntungan: tim yang dilanggar tetap menyerang; kartu tetap diberikan.
              stats.advantages[holder.teamId] += 1;
              whistle = { tick, kind: 'advantage', teamId: tackler.teamId, playerId: tackler.id, card };
            } else {
              foulStopsPlay = true;
              const penalty = foulInPenaltyArea(holder, teams);
              if (penalty) {
                ball = penaltyBall(ball, holder.teamId, teams);
                stats.penalties[holder.teamId].awarded += 1;
                pause = kickoffPause('penalty'); // jam berhenti: pemain mengambil posisi penalti
              } else {
                ball = freeKickBall(ball, holder, teams);
                stats.freeKicks[holder.teamId].awarded += 1;
              }
              for (const id of teamIds) teams[id].chaserId = null;
              whistle = { tick, kind: 'foul', teamId: tackler.teamId, playerId: tackler.id, card, penalty };
            }
          } else {
            stats.foulsUnseen[tackler.teamId] += 1;
          }
        }

        if (foulStopsPlay) {
          cooldownOverrides.set(tackler.id, BEATEN_COOLDOWN_TICKS);
          tackled = true; // bola mati: pemegang bola tidak memutuskan apa-apa
        } else if (won) {
          stats.tackles[tackler.teamId].won += 1;
          note(tackler.id, 'tackleWon');
          note(holder.id, 'dispossessed');
          ball = releaseBall(ball, holder, looseBallVelocity(tackler, holder, rng), {});
          cooldownOverrides.set(tackler.id, SUCCESS_COOLDOWN_TICKS);
          tackled = true;
          ballReleasedBy = holder.id;
        } else {
          cooldownOverrides.set(tackler.id, BEATEN_COOLDOWN_TICKS);
          stumbled.add(tackler.id);
          note(tackler.id, 'beaten');
        }
      }

      if (!tackled) {
        const decision = decideHolder(holder, ball, prev.players, rng, match);
        if (decision?.type === 'clear') {
          // Guard: sapuan panik hanya boleh terjadi bila semua syaratnya terpenuhi.
          if (!canPanicClear(holder, ball, match)) throw new Error(`sapuan panik tidak sah oleh ${holder.id}`);
          stats.clearances[holder.teamId] += 1;
          ball = releaseBall(ball, holder, clearVelocity(holder, ball, rng, blunderScale(holder, decision.context)), {});
          ballReleasedBy = holder.id;
        } else if (decision?.type === 'shoot') {
          // "Tepat sasaran" dihitung saat tembakan berakhir (gol atau diselamatkan
          // kiper), sesuai definisi statistik sepak bola; tembakan terblok tidak termasuk.
          const bigChance = decision.shot.distance <= BIG_CHANCE_DISTANCE;
          const spread = blunder(holder, 'shotSpread') * blunderScale(holder, { ...decision.context, bigChance });
          const velocity = shotVelocity(ball, decision.shot.aim, holder.attacksRight, rng, spread, decision.shot.speed);
          stats.shots[holder.teamId].total += 1;
          const long = !inOpponentBox(ball, holder.attacksRight);
          if (long) stats.longShots[holder.teamId].shots += 1;
          ball = releaseBall(ball, holder, velocity, { shotTeamId: holder.teamId, shotKind: long ? 'long' : 'foot' });
          ballReleasedBy = holder.id;
          // Pandangan kiper terhalang: kiper bereaksi lebih lambat dari biasanya.
          if (decision.shot.screened) {
            const keeper = prev.players.find((p) => p.role === 'GK' && p.teamId !== holder.teamId);
            if (keeper) screenedKeeperId = keeper.id;
          }
        } else if (decision?.type === 'penalty') {
          if (ball.setPieceKind !== 'penalty') throw new Error(`penalti tanpa bola mati penalti oleh ${holder.id}`);
          const shot = penaltyShot(ball, holder, rng, blunderScale(holder, { ...decision.context, bigChance: true }));
          stats.shots[holder.teamId].total += 1;
          ball = releaseBall(ball, holder, { vx: shot.velocity.vx, vy: shot.velocity.vy }, { shotTeamId: holder.teamId, shotKind: 'penalty' });
          ballReleasedBy = holder.id;
          const keeper = prev.players.find((p) => p.role === 'GK' && p.teamId !== holder.teamId);
          if (keeper) dives.set(keeper.id, keeperDive(keeper, shot.side, rng));
        } else if (decision?.type === 'freeKickShot') {
          // Tendangan bebas langsung: dilambungkan melewati pagar betis, turun di bawah mistar.
          if (ball.setPieceKind !== 'freeKick') throw new Error(`tendangan bebas tanpa bola mati oleh ${holder.id}`);
          const keeper = prev.players.find((p) => p.role === 'GK' && p.teamId !== holder.teamId) ?? null;
          const v = freeKickShotVelocity(ball, holder, keeper, rng, blunderScale(holder, { ...decision.context, bigChance: false }));
          stats.shots[holder.teamId].total += 1;
          stats.freeKicks[holder.teamId].shots += 1;
          ball = releaseBall(ball, holder, { vx: v.vx, vy: v.vy }, { vz: v.vz, shotTeamId: holder.teamId, shotKind: 'freeKick' });
          ballReleasedBy = holder.id;
        } else if (decision?.type === 'cross') {
          // Guard: umpan silang hanya dari zona sayap dekat garis gawang lawan, atau dari tendangan bebas.
          if (!inCrossZone(ball, holder.attacksRight) && !(decision.freeKick && ball.setPieceKind === 'freeKick')) {
            throw new Error(`umpan silang di luar zona oleh ${holder.id}`);
          }
          stats.crosses[holder.teamId].attempted += 1;
          const v = crossVelocity(ball, decision.aim, holder, rng, blunderScale(holder, decision.context));
          ball = releaseBall(ball, holder, { vx: v.vx, vy: v.vy }, { vz: v.vz, crossTeamId: holder.teamId });
          ballReleasedBy = holder.id;
        } else if (decision?.type === 'pass') {
          stats.passes[holder.teamId].attempted += 1;
          ball = releaseBall(ball, holder, passVelocity(ball, decision.option, holder, rng, blunderScale(holder, decision.context)), {
            passTargetId: decision.option.receiver.id,
            passTeamId: holder.teamId,
          });
          ballReleasedBy = holder.id;
        }
        // Offside dinilai saat bola dimainkan: tandai rekan yang offside / akan dibenderai.
        if (ballReleasedBy === holder.id) {
          ball = markPlay(ball, holder, prev.players, OFFSIDE_EXEMPT.includes(setPiece), prev.officials);
        }
      }
    }

    // Garis offside untuk setiap tim (dari sudut pandang tim itu sebagai penyerang).
    const offsideLines = Object.fromEntries(
      teamIds.map((id) => [id, offsideLine(prev.players.filter((p) => p.teamId !== id), teams[id].attacksRight)]),
    );

    // 2. Siapa yang menjemput/menekan bola di tiap tim.
    const owner = ball.ownerId !== null ? byId.get(ball.ownerId) : null;
    const roleTargets = new Map();
    for (const id of teamIds) {
      const team = teams[id];
      const own = prev.players.filter((p) => p.teamId === id);
      let pick = null;

      if (owner) {
        // Kiper memegang bola di kotaknya: lawan tidak menekan, cukup jaga bentuk.
        const keeperHolding = isKeeperHandling(owner, ball);
        // Tendangan bebas yang sedang disiapkan: lawan tidak menekan eksekutor.
        const freeKickSetup =
          (ball.setPieceKind === 'freeKick' && ball.heldTicks < FREE_KICK.holdTicks) || ball.setPieceKind === 'penalty';
        if (owner.teamId !== id && !keeperHolding && !freeKickSetup) pick = pickPresser(own, owner, team.attacksRight, team.chaserId);
      } else if (ball.restartTeamId !== null && ball.restartTeamId !== id) {
        pick = null; // bola mati milik lawan: tunggu
      } else if (ball.passTeamId === id) {
        const receiver = byId.get(ball.passTargetId);
        pick = pickChaser([receiver], ball, team.attacksRight, receiver.id) ?? {
          player: receiver,
          point: clampToPitch(ball),
        };
      } else {
        pick = pickChaser(own, ball, team.attacksRight, team.chaserId);
      }

      team.chaserId = pick ? pick.player.id : null;
      if (pick) roleTargets.set(pick.player.id, pick.point);

      if (updateRunner(team, owner, ball, prev.players, offsideLines[id], runCooldowns) === id) runStartedBy.add(id);
    }

    // 3. Tugas, target, lalu gerak.
    const possessingTeamId = owner
      ? owner.teamId
      : (ball.passTeamId ?? ball.shotTeamId ?? ball.crossTeamId ?? ball.restartTeamId ?? null);

    // Serbuan kotak: umpan silang sedang/akan datang (pemegang di zona sayap,
    // sepak pojok, atau bola silang di udara). Paling banyak BOX_RUN_COUNT penyerang.
    let boxRuns = new Map();
    const crossingTeamId =
      ball.crossTeamId ??
      (owner && owner.role !== 'GK' && inCrossZone(ball, teams[owner.teamId].attacksRight) ? owner.teamId : null) ??
      (ball.restartTeamId !== null && atCornerSpot(ball, teams[ball.restartTeamId].attacksRight) ? ball.restartTeamId : null) ??
      // Tendangan bebas dekat kotak: penyerang ikut menyerbu kotak.
      (freeKickNearGoal(ball, owner, teams) ? (owner?.teamId ?? ball.restartTeamId) : null);
    if (crossingTeamId !== null) {
      const excluded = new Set([ball.ownerId, teams[crossingTeamId].chaserId, teams[crossingTeamId].runnerId]);
      boxRuns = assignBoxRuns(prev.players, crossingTeamId, ball, teams[crossingTeamId].attacksRight, excluded);
    }

    // Tendangan bebas sedang disiapkan: tim bertahan memasang pagar betis & mundur ≥ 9,15 m.
    const freeKickTeamId =
      ball.restartKind === 'freeKick'
        ? ball.restartTeamId
        : owner && ball.setPieceKind === 'freeKick' && ball.heldTicks < FREE_KICK.holdTicks
          ? owner.teamId
          : null;
    const wall =
      freeKickTeamId !== null
        ? freeKickDefence(ball, prev.players.filter((p) => p.teamId !== freeKickTeamId), teams[freeKickTeamId].attacksRight)
        : new Map();

    // Tim yang bertahan membagi penjagaan lawan (tidak termasuk pemegang bola,
    // yang sudah diurus penekan).
    const marksByTeam = new Map();
    if (possessingTeamId !== null) {
      for (const id of teamIds) {
        if (id === possessingTeamId) continue;
        const defenders = prev.players.filter((p) => p.teamId === id && p.id !== teams[id].chaserId);
        const attackers = prev.players.filter((p) => p.teamId === possessingTeamId && p.id !== ball.ownerId);
        marksByTeam.set(id, assignMarks(defenders, attackers, teams[id].attacksRight));
      }
    }

    const players = prev.players.map((player, index) => {
      const team = teams[player.teamId];
      let task = 'shape';
      let target = player.target;
      let moveOptions = {};

      if (ball.ownerId === player.id) {
        task = 'hold';
        const presserId = teamIds
          .map((id) => teams[id].chaserId)
          .find((id) => id && byId.get(id).teamId !== player.teamId);
        const presser = presserId ? byId.get(presserId) : null;
        const pressing = presser && distance(presser, player) < PRESSURE_RADIUS * 2 ? presser : null;
        const opponentsOfHolder = prev.players.filter((p) => p.teamId !== player.teamId);
        const laneBlocker = shotLaneBlocker(ball, opponentsOfHolder, team.attacksRight);
        if (isBreakaway(player, opponentsOfHolder, team.attacksRight)) {
          // Satu lawan satu: lari secepatnya ke arah gawang.
          const goalX = team.attacksRight ? PITCH.length - BREAKAWAY_AIM_DEPTH : BREAKAWAY_AIM_DEPTH;
          target = { x: goalX, y: PITCH.width / 2 };
          moveOptions = { speedScale: BREAKAWAY_SPEED_SCALE };
        } else {
          target = dribbleTarget(player, team.attacksRight, pressing, laneBlocker);
          moveOptions = { speedScale: DRIBBLE_SPEED_SCALE };
        }
      } else if (team.runnerId === player.id) {
        task = 'run';
        target = team.runTarget;
        moveOptions = { urgent: true };
      } else if (team.chaserId === player.id) {
        if (owner) task = 'press';
        else task = ball.passTargetId === player.id ? 'receive' : 'chase';
        target = roleTargets.get(player.id);
        moveOptions = { urgent: true };
      } else {
        // Lapisan keputusan untuk bentuk tim: bergiliran tiap beberapa tick,
        // atau langsung kalau pemain baru saja selesai mengurus bola.
        const isDecisionTick = (tick + index) % DECISION_INTERVAL_TICKS === 0;
        if (isDecisionTick || player.task !== 'shape') {
          let phase = 'neutral';
          if (possessingTeamId !== null) phase = possessingTeamId === player.teamId ? 'attack' : 'defend';
          target = boxRuns.get(player.id) ?? computeAnchor(player, ball, team.attacksRight, phase);
          if (phase === 'defend') {
            const mark = marksByTeam.get(player.teamId)?.get(player.id);
            const holdLine =
              BACK_LINE_ROLES.includes(player.role) && mark && !insideOwnPenaltyArea(mark.point, team.attacksRight);
            target = blendTowardMark(target, mark, { lateralOnly: holdLine });
          }
          if (freeKickTeamId !== null && player.teamId !== freeKickTeamId && player.role !== 'GK') {
            target = wall.get(player.id) ?? pushAway(target, ball, FREE_KICK.distance + 0.5);
          }
          // Penyerang tidak menunggu di posisi offside.
          if (phase === 'attack') {
            const line = offsideLines[player.teamId];
            const margin = onsideMarginFor(player);
            // Di bahu bek hanya saat bola sudah dekat gawang lawan; saat membangun serangan, striker ikut turun.
            const ballNearGoal = forwardOf(ball, team.attacksRight) >= PITCH.length - SHOULDER_BALL_RANGE;
            if (ballNearGoal && SHOULDER_ROLES.includes(player.role) && !boxRuns.has(player.id)) {
              target = toShoulder(target, line, team.attacksRight, margin);
            }
            target = clampOnside(target, ball, line, team.attacksRight, margin);
          }
        }
      }

      // Waktu reaksi (stat Antisipasi): selama masih "telat membaca", pemain
      // tetap berlari ke target lamanya walau tugasnya sudah berubah.
      if (player.reactionDelay > 0 && task !== 'hold') target = player.target;
      const dive = dives.get(player.id);
      if (dive) target = dive.target;

      target = clampToPitch(target);
      const moveTarget = task === 'shape' ? applySeparation(target, player, prev.players) : target;
      // Penekan yang gagal menekel kehilangan momentum.
      const base = stumbled.has(player.id)
        ? { ...player, vx: 0, vy: 0 }
        : dive
          ? { ...player, vx: dive.vx, vy: dive.vy }
          : player;
      const moveContext = conditionContext(player, prev.players, match);
      const body = stepBody({ ...base, profile: effectiveProfile(player, moveContext) }, moveTarget, DT, moveOptions);
      const condition = driftConfidence(
        { ...player.condition, energy: drainEnergy(player, Math.hypot(body.vx, body.vy), DT) },
        DT,
      );
      const tackleCooldown = cooldownOverrides.get(player.id) ?? Math.max(0, player.tackleCooldown - 1);
      let reactionDelay = Math.max(0, player.reactionDelay - 1);
      // Bola baru saja dilepas: semua orang kecuali pelepas dan penerima yang dituju harus bereaksi.
      if (ballReleasedBy !== null && player.id !== ballReleasedBy && player.id !== ball.passTargetId) {
        reactionDelay = reactionTicks(player);
        if (player.id === screenedKeeperId) reactionDelay += Math.round(SCREEN.delay * TICK_RATE);
        if (dive) reactionDelay = PENALTY.commitTicks; // terkunci pada arah lompatannya
      }
      // Lari tanpa bola tidak langsung terbaca oleh lawan (stat Antisipasi).
      for (const teamId of runStartedBy) {
        if (player.teamId !== teamId) reactionDelay = Math.max(reactionDelay, reactionTicks(player));
      }
      const runCooldown = runCooldowns.get(player.id) ?? Math.max(0, player.runCooldown - 1);
      const discipline = calmDown(disciplineOf(player), DT);
      return { ...player, ...body, target, task, tackleCooldown, reactionDelay, runCooldown, condition, discipline };
    });

    // Bola terlepas di tahap 4 (tepisan, sentuhan buruk): reaksi berlaku mulai tick berikutnya.
    const startReactions = (releaserId) => {
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].id !== releaserId) players[i] = { ...players[i], reactionDelay: reactionTicks(players[i]) };
      }
    };

    // Gol: tim yang menyerang ke garis itu mencetak angka.
    const scoreGoal = (crossing) => {
      const scoringTeamId = teamIds.find((id) => teams[id].attacksRight === (crossing.lineX === PITCH.length));
      const concedingTeamId = teamIds.find((id) => id !== scoringTeamId);
      stats.goals[scoringTeamId] += 1;
      if (ball.kickerId && ball.lastTouchTeamId === scoringTeamId) note(ball.kickerId, 'goal');
      const concedingKeeper = players.find((p) => p.teamId !== scoringTeamId && p.role === 'GK');
      if (concedingKeeper) note(concedingKeeper.id, 'conceded');
      if (ball.shotTeamId === scoringTeamId) stats.shots[scoringTeamId].onTarget += 1;
      const header = ball.shotTeamId === scoringTeamId && ball.shotKind === 'header';
      if (header) stats.headers[scoringTeamId].goals += 1;
      const longShot = ball.shotTeamId === scoringTeamId && ball.shotKind === 'long';
      if (longShot) stats.longShots[scoringTeamId].goals += 1;
      const freeKick = ball.shotTeamId === scoringTeamId && ball.shotKind === 'freeKick';
      if (freeKick) stats.freeKicks[scoringTeamId].goals += 1;
      const penalty = ball.shotTeamId === scoringTeamId && ball.shotKind === 'penalty';
      if (penalty) stats.penalties[scoringTeamId].scored += 1;
      // Kebobolan memanaskan emosi tim (× Temperamen).
      for (let i = 0; i < players.length; i += 1) {
        const p = players[i];
        if (p.teamId === concedingTeamId) players[i] = { ...p, discipline: raiseAgitation(p.discipline, p.skills, AGITATION.conceded) };
      }
      lastGoal = {
        teamId: scoringTeamId,
        scorerId: ball.kickerId,
        ownGoal: ball.lastTouchTeamId !== scoringTeamId,
        header,
        longShot,
        freeKick,
        penalty,
        tick,
      };
      ball = createInitialBall(concedingTeamId);
      pause = kickoffPause('goal');
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].task !== 'shape') players[i] = { ...players[i], task: 'shape' };
      }
      for (const id of teamIds) Object.assign(teams[id], emptyTeamRoles());
    };

    // Pemain menguasai bola: tugas semua pemain menyesuaikan di tick yang sama.
    const takeControl = (controller, at = null) => {
      ball = gainControl(at ? { ...ball, ...at } : ball, controller, stats, rng, note, tempoOf(controller));
      for (let i = 0; i < players.length; i += 1) {
        const p = players[i];
        if (p.id === controller.id) players[i] = { ...p, task: 'hold' };
        else if (p.task !== 'shape' && p.task !== 'run') players[i] = { ...p, task: 'shape' };
      }
      for (const id of teamIds) teams[id].chaserId = null;
    };

    // Pemenang duel udara memakai bolanya: kiper tangkap/tinju, sundulan ke gawang,
    // sapuan di separuh sendiri, atau sundulan pendek ke depan.
    const winAerial = (winner) => {
      const w = winner.player;
      const contact = clampToPitch(winner.point);
      stats.aerialsWon[w.teamId] += 1;
      if (ball.crossTeamId === w.teamId) stats.crosses[w.teamId].won += 1;

      if (w.role === 'GK' && insideOwnPenaltyArea(contact, w.attacksRight)) {
        if (rng.chance(keeperCatchChance(w))) {
          takeControl(w, contact);
        } else {
          const v = headerClearVelocity(w, rng); // ditinju menjauh
          ball = releaseBall({ ...ball, ...contact }, w, v, { vz: v.vz });
          startReactions(w.id);
        }
        return;
      }
      if (inHeaderShotRange(contact, w.attacksRight)) {
        const keeper = players.find((p) => p.role === 'GK' && p.teamId !== w.teamId) ?? null;
        const scale = blunderScale(w, conditionContext(w, players, match, { bigChance: true }));
        const v = headerShotVelocity(contact, w.attacksRight, keeper, rng, scale, w);
        stats.shots[w.teamId].total += 1;
        stats.headers[w.teamId].shots += 1;
        ball = releaseBall({ ...ball, ...contact }, w, { vx: v.vx, vy: v.vy }, { shotTeamId: w.teamId, shotKind: 'header' });
      } else if (forwardOf(contact, w.attacksRight) < PITCH.length / 2) {
        const v = headerClearVelocity(w, rng);
        ball = releaseBall({ ...ball, ...contact }, w, v, { vz: v.vz });
      } else {
        const v = headerKnockVelocity(w, rng);
        ball = releaseBall({ ...ball, ...contact }, w, v, {});
      }
      startReactions(w.id);
    };

    // Offside dibenderai hakim garis: tendangan bebas untuk lawan di posisi pelanggar.
    const callOffside = (offender) => {
      const defendingTeamId = teamIds.find((id) => id !== offender.teamId);
      stats.offsides[offender.teamId] += 1;
      if (!ball.offsideTrueIds.includes(offender.id)) stats.offsideWrong[offender.teamId] += 1;
      note(offender.id, 'offside');
      ball = {
        ...ball,
        ...clampToPitch(offender, 0.5),
        vx: 0,
        vy: 0,
        ownerId: null,
        heldTicks: 0,
        holdTarget: 0,
        kickerId: null,
        kickCooldown: 0,
        passTargetId: null,
        passTeamId: null,
        shotTeamId: null,
        offsideFlagIds: [],
        offsideTrueIds: [],
        offsideTeamId: null,
        lastTouchTeamId: offender.teamId,
        restartTeamId: defendingTeamId,
        restartKind: 'freeKick',
        setPieceKind: null,
        z: 0,
        vz: 0,
        crossTeamId: null,
        shotKind: null,
      };
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].task !== 'shape' && players[i].task !== 'run') players[i] = { ...players[i], task: 'shape' };
      }
      for (const id of teamIds) teams[id].chaserId = null;
      whistle = { tick, kind: 'offside', teamId: offender.teamId, playerId: offender.id };
    };
    // Pemain yang sebenarnya offside ikut bermain, tetapi hakim garis tidak mengangkat bendera.
    const noteMissedOffside = (player) => {
      if (ball.offsideTrueIds.includes(player.id) && !ball.offsideFlagIds.includes(player.id)) {
        stats.offsideMissed[player.teamId] += 1;
      }
    };
    // Tepisan kiper dan blok bek bukan "memainkan bola": penanda offside tetap berlaku.
    const keepOffside = () => ({
      offsideFlagIds: ball.offsideFlagIds,
      offsideTrueIds: ball.offsideTrueIds,
      offsideTeamId: ball.offsideTeamId,
    });

    // 4. Bola.
    if (pause.pauseTicks > 0) {
      // Penalti baru ditiup di tick ini: bola tetap mati di titik penalti.
    } else if (ball.ownerId !== null) {
      const holder = players.find((p) => p.id === ball.ownerId);
      ball = { ...ball, ...ballAtFeet(holder), vx: holder.vx, vy: holder.vy };
    } else if (ball.restartTeamId === null && isAirborne(ball)) {
      // Bola di udara: hanya kepala (atau tangan kiper) yang menjangkau; jatuh rendah = kaki.
      const from = { x: ball.x, y: ball.y };
      const flight = airStep(ball, DT);
      const cooldown = Math.max(0, ball.kickCooldown - 1);
      const freeKickShot = ball.shotKind === 'freeKick';
      // Tendangan bebas langsung melewati pagar betis: hanya kiper yang bisa menjangkaunya di udara.
      const canTouch = (p) => !(p.id === ball.kickerId && ball.kickCooldown > 0) && (!freeKickShot || p.role === 'GK');
      const candidates = aerialCandidates(ball, flight, DT, players, canTouch);
      const crossing = goalLineCrossing(from, flight);
      const firstContact = candidates.length > 0 ? Math.min(...candidates.map((c) => c.u)) : Infinity;

      if (crossing && crossing.u < firstContact) {
        if (isBetweenPosts(crossing.y) && heightAt(ball, DT, crossing.u) <= AERIAL.crossbar) {
          scoreGoal(crossing);
        } else {
          stats.outOfPlay += 1;
          ball = restartFromOut(ball, from, flight, teams, teamIds);
        }
      } else if (candidates.length > 0 && freeKickShot) {
        // Kiper menjangkau tendangan bebas: tangkap atau tepis (seperti tembakan biasa).
        const keeper = candidates[0].player;
        const contact = clampToPitch(candidates[0].point);
        const speed = Math.hypot(ball.vx, ball.vy);
        if (headingBetweenPosts(ball)) stats.shots[ball.shotTeamId].onTarget += 1;
        note(keeper.id, 'save');
        if (rng.chance(catchChance(speed, keeper))) {
          stats.saves[keeper.teamId].caught += 1;
          takeControl(keeper, contact);
        } else {
          stats.saves[keeper.teamId].parried += 1;
          ball = releaseBall({ ...ball, ...contact }, keeper, parryVelocity(keeper, speed, rng), keepOffside());
          startReactions(keeper.id);
        }
      } else if (candidates.length > 0) {
        // Yang berduel: pemain yang menjangkau bola di saat paling awal (±0,3 langkah).
        const contest = candidates.filter((c) => c.u <= firstContact + 0.3);
        const winner = resolveAerial(contest, rng, (p) => physicalScale(p, conditionContext(p, players, match)));
        if (ball.offsideFlagIds.includes(winner.player.id)) {
          callOffside(winner.player);
        } else {
          noteMissedOffside(winner.player);
          winAerial(winner);
          if (ball.ownerId === null && ball.kickerId === winner.player.id) ball = markPlay(ball, winner.player, players, false, prev.officials);
        }
      } else if (!isInsidePitch(flight.x, flight.y)) {
        stats.outOfPlay += 1;
        ball = restartFromOut(ball, from, flight, teams, teamIds);
      } else if (flight.z <= AERIAL.footMax) {
        const touch = findController(from, flight, players, canTouch);
        if (touch && ball.offsideFlagIds.includes(touch.player.id)) {
          callOffside(touch.player);
        } else if (touch) {
          noteMissedOffside(touch.player);
          if (ball.crossTeamId === touch.player.teamId) stats.crosses[touch.player.teamId].won += 1;
          takeControl(touch.player);
        } else {
          const settled = flight.z === 0 && flight.vz === 0;
          ball = { ...ball, ...flight, kickCooldown: cooldown, crossTeamId: settled ? null : ball.crossTeamId };
        }
      } else {
        ball = { ...ball, ...flight, kickCooldown: cooldown };
      }
    } else {
      const from = { x: ball.x, y: ball.y };
      const rolled = ball.restartTeamId !== null ? { ...from, vx: 0, vy: 0 } : rollBall(ball, DT);
      const cooldown = Math.max(0, ball.kickCooldown - 1);

      const touch = findController(
        from,
        rolled,
        players,
        (p) =>
          !(p.id === ball.kickerId && ball.kickCooldown > 0) &&
          (ball.restartTeamId === null || p.teamId === ball.restartTeamId),
      );
      const crossing = goalLineCrossing(from, rolled);
      const isGoal = crossing && isBetweenPosts(crossing.y) && (!touch || crossing.u < touch.u);
      if (!isGoal && touch) noteMissedOffside(touch.player);

      if (isGoal) {
        scoreGoal(crossing);
      } else if (touch && ball.offsideFlagIds.includes(touch.player.id)) {
        callOffside(touch.player);
      } else if (touch && isShotReachingKeeper(ball, touch.player, from)) {
        // Kiper menjangkau tembakan: tangkap, atau tepis jadi bola muntah.
        const keeper = touch.player;
        const speed = Math.hypot(ball.vx, ball.vy);
        if (headingBetweenPosts(ball)) stats.shots[ball.shotTeamId].onTarget += 1;
        const contact = { x: from.x + (rolled.x - from.x) * touch.u, y: from.y + (rolled.y - from.y) * touch.u };
        if (rng.chance(catchChance(speed, keeper))) {
          stats.saves[keeper.teamId].caught += 1;
          note(keeper.id, 'save');
          ball = gainControl(ball, keeper, stats, rng, note, tempoOf(keeper));
          for (let i = 0; i < players.length; i += 1) {
            const p = players[i];
            if (p.id === keeper.id) players[i] = { ...p, task: 'hold' };
            else if (p.task !== 'shape' && p.task !== 'run') players[i] = { ...p, task: 'shape' };
          }
          for (const id of teamIds) teams[id].chaserId = null;
        } else {
          stats.saves[keeper.teamId].parried += 1;
          note(keeper.id, 'save');
          ball = releaseBall({ ...ball, ...clampToPitch(contact) }, keeper, parryVelocity(keeper, speed, rng), keepOffside());
          startReactions(keeper.id);
        }
      } else if (
        touch &&
        ball.shotTeamId !== null &&
        touch.player.teamId !== ball.shotTeamId &&
        rng.chance(BLOCK_DEFLECT_CHANCE)
      ) {
        // Tembakan terblok bek: bola memantul liar ke arah datangnya.
        const blocker = touch.player;
        const contact = { x: from.x + (rolled.x - from.x) * touch.u, y: from.y + (rolled.y - from.y) * touch.u };
        stats.blocks[blocker.teamId] += 1;
        ball = releaseBall({ ...ball, ...clampToPitch(contact) }, blocker, deflectVelocity(ball, rng), keepOffside());
        startReactions(blocker.id);
      } else if (
        touch &&
        ball.restartTeamId === null &&
        !isKeeperHandling(touch.player, from) &&
        rng.chance(
          heavyTouchChance(
            touch.player,
            Math.hypot(ball.vx, ball.vy),
            blunderScale(touch.player, conditionContext(touch.player, players, match)),
          ),
        )
      ) {
        // Sentuhan pertama terlalu jauh: bola memantul dari kaki dan bisa direbut siapa saja.
        const player = touch.player;
        const contact = { x: from.x + (rolled.x - from.x) * touch.u, y: from.y + (rolled.y - from.y) * touch.u };
        if (ball.passTeamId !== null && player.teamId === ball.passTeamId) stats.passes[player.teamId].completed += 1;
        if (ball.lastTouchTeamId !== null && player.teamId !== ball.lastTouchTeamId) stats.turnovers += 1;
        stats.heavyTouches[player.teamId] += 1;
        note(player.id, 'heavyTouch');
        ball = releaseBall({ ...ball, ...clampToPitch(contact) }, player, heavyTouchVelocity(ball, rng), {});
        ball = markPlay(ball, player, players, false, prev.officials);
        startReactions(player.id);
      } else if (touch) {
        ball = gainControl(ball, touch.player, stats, rng, note, tempoOf(touch.player));
        // Tugas pemain mengikuti pergantian penguasaan di tick yang sama.
        for (let i = 0; i < players.length; i += 1) {
          const p = players[i];
          if (p.id === touch.player.id) players[i] = { ...p, task: 'hold' };
          else if (p.task !== 'shape' && p.task !== 'run') players[i] = { ...p, task: 'shape' };
        }
        for (const id of teamIds) teams[id].chaserId = null;
      } else if (!isInsidePitch(rolled.x, rolled.y)) {
        stats.outOfPlay += 1;
        ball = restartFromOut(ball, from, rolled, teams, teamIds);
      } else {
        ball = { ...ball, ...rolled, kickCooldown: cooldown };
      }
    }

    // Kalau bola sudah tidak dalam operan, penerima kembali menjadi pengejar biasa
    // pada tick berikutnya; tugasnya di tick ini harus tetap konsisten.
    if (ball.passTargetId === null) {
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].task === 'receive') players[i] = { ...players[i], task: 'chase' };
      }
    }

    // 5. Statistik penguasaan bola.
    const holderTeamId = ball.ownerId !== null ? players.find((p) => p.id === ball.ownerId).teamId : null;
    const creditTeamId =
      holderTeamId ?? ball.passTeamId ?? ball.shotTeamId ?? ball.restartTeamId ?? ball.lastTouchTeamId ?? teamIds[0];
    stats.possessionTicks[creditTeamId] += 1;

    // Peristiwa percaya diri (sukses & blunder) diterapkan sekaligus di akhir tick.
    for (const [playerId, event] of events) {
      const i = players.findIndex((p) => p.id === playerId);
      if (i < 0) throw new Error(`peristiwa "${event}" untuk pemain tak dikenal ${playerId}`);
      players[i] = { ...players[i], condition: applyConfidenceEvent(players[i].condition, players[i].skills, event) };
    }

    // Jeda dimulai di tick ini (gol atau penalti): semua kembali ke bentuk tim, tanpa pengejar/pelari.
    if (pause.pauseTicks > 0) {
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].task !== 'shape') players[i] = { ...players[i], task: 'shape' };
      }
      for (const id of teamIds) Object.assign(teams[id], emptyTeamRoles());
    }
    const officials = stepOfficials(prev.officials, ball, offsideReferences(players, ball), false, DT);
    state = { ...prev, tick, teams, ball, players, stats, ...pause, lastGoal, officials, whistle };
    return state;
  }

  // Maju satu tick. Saat jeda babak atau setelah peluit akhir, tidak ada yang bergerak.
  function step() {
    if (state.period === 'halftime' || state.period === 'fulltime') return state;

    // Jam berhenti selama persiapan kick-off (awal babak & setelah gol).
    const wasPaused = state.pauseTicks > 0;
    advance();
    if (wasPaused) return state;
    const periodTick = state.periodTick + 1;
    if (periodTick < HALF_TICKS) {
      state = { ...state, periodTick };
      return state;
    }

    // Peluit akhir babak.
    state = {
      ...state,
      periodTick: HALF_TICKS,
      pauseTicks: 0,
      pauseReason: null,
      pauseElapsed: 0,
      period: state.period === 'first' ? 'halftime' : 'fulltime',
    };
    return state;
  }

  // Mulai babak kedua: kedua tim bertukar sisi, pemain kembali ke posisi
  // kick-off, dan tim yang tidak kick-off di babak pertama memulai.
  function startSecondHalf() {
    if (state.period !== 'halftime') {
      throw new Error(`startSecondHalf: hanya bisa saat jeda babak, sekarang "${state.period}"`);
    }

    const teams = Object.fromEntries(
      teamIds.map((id) => [id, { ...state.teams[id], attacksRight: !state.teams[id].attacksRight, ...emptyTeamRoles() }]),
    );
    const players = state.players.map((player) => {
      const attacksRight = teams[player.teamId].attacksRight;
      const spot = slotToPitch(player.slot, attacksRight);
      return {
        ...player,
        attacksRight,
        ...spot,
        vx: 0,
        vy: 0,
        target: spot,
        task: 'shape',
        tackleCooldown: 0,
        reactionDelay: 0,
        runCooldown: 0,
        condition: recoverAtHalftime(player.condition),
      };
    });
    const kickOffTeamId = teamIds.find((id) => id !== state.firstKickOffTeamId);

    const next = {
      ...state,
      teams,
      players,
      ball: createInitialBall(kickOffTeamId),
      ...kickoffPause('kickoff'),
      period: 'second',
      periodTick: 0,
    };
    const errors = validateMatchState(next);
    if (errors.length > 0) throw new Error(`startSecondHalf: state tidak valid:\n- ${errors.join('\n- ')}`);
    state = next;
    return state;
  }

  return {
    getState: () => state,
    step,
    startSecondHalf,
  };
}
