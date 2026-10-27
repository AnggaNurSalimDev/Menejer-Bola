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
import { createMatchState, createInitialBall, slotToPitch, validateMatchState, GOAL_PAUSE_TICKS } from './state.js';
import { DT, TICK_RATE, DECISION_INTERVAL_TICKS, KICK_COOLDOWN_TICKS, HALF_TICKS } from './constants.js';
import { blunder } from './skill.js';
import { PITCH, clampToPitch, distance, isInsidePitch, isBetweenPosts } from './pitch.js';
import { rollBall, MAX_KICK_SPEED } from './ball.js';
import { computeAnchor } from './shape.js';
import { stepBody } from './movement.js';
import { pickChaser, pickPresser } from './roles.js';
import { evaluatePassOptions, dribbleTarget, shotLaneBlocker } from './passing.js';
import { evaluateShot, shotVelocity } from './shooting.js';
import {
  pickTackler,
  tackleSuccessChance,
  looseBallVelocity,
  BEATEN_COOLDOWN_TICKS,
  SUCCESS_COOLDOWN_TICKS,
} from './tackle.js';
import { findController } from './touch.js';
import { assignMarks, blendTowardMark } from './marking.js';
import { catchChance, parryVelocity, isKeeperHandling } from './keeper.js';

// Pemegang bola
// Tempo padat (pertandingan 2 × 5 menit): bola dilepas dalam 0,5–1,5 detik.
const HOLD_MIN_TICKS = 5;
const HOLD_MAX_TICKS = 15;
const KEEPER_HOLD_MIN_TICKS = 5;
const KEEPER_HOLD_MAX_TICKS = 10;
const FORCED_PASS_TICKS = 25; // terlalu lama tanpa opsi aman → oper yang terbaik saja
const PRESSURE_RADIUS = 3; // meter
const PRESSURED_MIN_TICKS = 4; // ditekan pun, pemain butuh sejenak untuk melepas operan
const PRESSURED_FORCED_TICKS = 8;
const SHOT_MIN_TICKS = 2; // butuh sentuhan persiapan sebelum menembak
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
    turnovers: stats.turnovers,
    outOfPlay: stats.outOfPlay,
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

// Keputusan pemegang bola: { type: 'shoot', shot } | { type: 'pass', option } | null (terus menggiring)
function decideHolder(holder, ball, players, rng) {
  const opponents = players.filter((p) => p.teamId !== holder.teamId);
  const pressured = nearestDistance(holder, opponents) < PRESSURE_RADIUS;

  if (ball.heldTicks >= SHOT_MIN_TICKS) {
    const shot = evaluateShot({ origin: ball, opponents, attacksRight: holder.attacksRight, pressured });
    if (shot?.shouldShoot) return { type: 'shoot', shot };
  }

  const ready = ball.heldTicks >= ball.holdTarget || (pressured && ball.heldTicks >= PRESSURED_MIN_TICKS);
  if (!ready) return null;

  const options = evaluatePassOptions({
    holder,
    origin: ball,
    teammates: players.filter((p) => p.teamId === holder.teamId),
    opponents,
    attacksRight: holder.attacksRight,
    previousOwnerId: ball.previousOwnerId,
    rng,
  });
  if (options.length === 0) return null;

  const best = options[0];
  const forced =
    ball.heldTicks >= FORCED_PASS_TICKS || (pressured && ball.heldTicks >= PRESSURED_FORCED_TICKS);
  return best.safe || forced ? { type: 'pass', option: best } : null;
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
    lastTouchTeamId: kicker.teamId,
    restartTeamId: null,
    ...extra,
  };
}

// Arah dan laju operan setelah diberi meleset sesuai stat Passing pengoper.
function passVelocity(ball, option, passer, rng) {
  const d = distance(ball, option.target);
  if (!(d > 0)) throw new Error('passVelocity: jarak operan nol');
  const angle = Math.atan2(option.target.y - ball.y, option.target.x - ball.x) + rng.normal(0, blunder(passer, 'passAngle'));
  const speedFactor = Math.max(0.5, 1 + rng.normal(0, blunder(passer, 'passSpeed')));
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

function heavyTouchChance(player, incomingSpeed) {
  return Math.min(HEAVY_TOUCH_MAX_CHANCE, (incomingSpeed / 10) * blunder(player, 'heavyTouchPer10ms'));
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

function gainControl(ball, controller, stats, rng) {
  if (ball.passTeamId !== null && controller.teamId === ball.passTeamId) {
    stats.passes[controller.teamId].completed += 1;
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
      : rng.int(HOLD_MIN_TICKS, HOLD_MAX_TICKS),
    previousOwnerId: ball.kickerId ?? ball.previousOwnerId,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    lastTouchTeamId: controller.teamId,
    restartTeamId: null,
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

  if (crossing) {
    const defendingTeamId = teamIds.find((id) => teams[id].attacksRight === (crossing.lineX === 0));
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
    restartTeamId,
  };
}

export function createSimulation(home, away, seed) {
  if (!Number.isInteger(seed)) throw new TypeError(`createSimulation: seed harus bilangan bulat, dapat ${seed}`);

  const rng = createRng(seed);
  let state = createMatchState(home, away);
  const teamIds = Object.keys(state.teams);

  // 0. Jeda setelah gol: semua pemain berjalan kembali ke posisi kick-off.
  function stepPause(prev, tick, stats) {
    const players = prev.players.map((player) => {
      const target = slotToPitch(player.slot, player.attacksRight);
      const body = stepBody(player, target, DT);
      return {
        ...player,
        ...body,
        target,
        task: 'shape',
        tackleCooldown: Math.max(0, player.tackleCooldown - 1),
        reactionDelay: 0,
      };
    });
    stats.possessionTicks[prev.ball.restartTeamId] += 1;
    return { ...prev, tick, players, stats, pauseTicks: prev.pauseTicks - 1 };
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
    let pauseTicks = 0;

    const cooldownOverrides = new Map();
    const stumbled = new Set();
    // Siapa yang melepas bola di tick ini (operan, tembakan, tekel): pemain lain
    // butuh waktu reaksi (stat Antisipasi) sebelum mengubah arah larinya.
    let ballReleasedBy = null;

    // 1. Duel dan keputusan pemegang bola.
    if (ball.ownerId !== null) {
      const holder = byId.get(ball.ownerId);
      if (!holder) throw new Error(`step: pemegang bola ${ball.ownerId} tidak ditemukan`);
      ball.heldTicks += 1;

      const opponents = prev.players.filter((p) => p.teamId !== holder.teamId);
      // Bola di tangan kiper tidak boleh ditekel.
      const tackler = isKeeperHandling(holder, ball) ? null : pickTackler(holder, opponents, rng);
      let tackled = false;

      if (tackler) {
        stats.tackles[tackler.teamId].attempted += 1;
        if (rng.chance(tackleSuccessChance(tackler, holder))) {
          stats.tackles[tackler.teamId].won += 1;
          ball = releaseBall(ball, holder, looseBallVelocity(tackler, holder, rng), {});
          cooldownOverrides.set(tackler.id, SUCCESS_COOLDOWN_TICKS);
          tackled = true;
          ballReleasedBy = holder.id;
        } else {
          cooldownOverrides.set(tackler.id, BEATEN_COOLDOWN_TICKS);
          stumbled.add(tackler.id);
        }
      }

      if (!tackled) {
        const decision = decideHolder(holder, ball, prev.players, rng);
        if (decision?.type === 'shoot') {
          // "Tepat sasaran" dihitung saat tembakan berakhir (gol atau diselamatkan
          // kiper), sesuai definisi statistik sepak bola; tembakan terblok tidak termasuk.
          const spread = blunder(holder, 'shotSpread');
          const velocity = shotVelocity(ball, decision.shot.aim, holder.attacksRight, rng, spread);
          stats.shots[holder.teamId].total += 1;
          ball = releaseBall(ball, holder, velocity, { shotTeamId: holder.teamId });
          ballReleasedBy = holder.id;
        } else if (decision?.type === 'pass') {
          stats.passes[holder.teamId].attempted += 1;
          ball = releaseBall(ball, holder, passVelocity(ball, decision.option, holder, rng), {
            passTargetId: decision.option.receiver.id,
            passTeamId: holder.teamId,
          });
          ballReleasedBy = holder.id;
        }
      }
    }

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
        if (owner.teamId !== id && !keeperHolding) pick = pickPresser(own, owner, team.attacksRight, team.chaserId);
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
    }

    // 3. Tugas, target, lalu gerak.
    const possessingTeamId = owner
      ? owner.teamId
      : (ball.passTeamId ?? ball.shotTeamId ?? ball.restartTeamId ?? null);

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
        target = dribbleTarget(player, team.attacksRight, pressing, laneBlocker);
        moveOptions = { speedScale: DRIBBLE_SPEED_SCALE };
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
          target = computeAnchor(player, ball, team.attacksRight, phase);
          if (phase === 'defend') target = blendTowardMark(target, marksByTeam.get(player.teamId)?.get(player.id));
        }
      }

      // Waktu reaksi (stat Antisipasi): selama masih "telat membaca", pemain
      // tetap berlari ke target lamanya walau tugasnya sudah berubah.
      if (player.reactionDelay > 0 && task !== 'hold') target = player.target;

      target = clampToPitch(target);
      const moveTarget = task === 'shape' ? applySeparation(target, player, prev.players) : target;
      // Penekan yang gagal menekel kehilangan momentum.
      const body = stepBody(stumbled.has(player.id) ? { ...player, vx: 0, vy: 0 } : player, moveTarget, DT, moveOptions);
      const tackleCooldown = cooldownOverrides.get(player.id) ?? Math.max(0, player.tackleCooldown - 1);
      let reactionDelay = Math.max(0, player.reactionDelay - 1);
      // Bola baru saja dilepas: semua orang kecuali pelepas dan penerima yang dituju harus bereaksi.
      if (ballReleasedBy !== null && player.id !== ballReleasedBy && player.id !== ball.passTargetId) {
        reactionDelay = reactionTicks(player);
      }
      return { ...player, ...body, target, task, tackleCooldown, reactionDelay };
    });

    // Bola terlepas di tahap 4 (tepisan, sentuhan buruk): reaksi berlaku mulai tick berikutnya.
    const startReactions = (releaserId) => {
      for (let i = 0; i < players.length; i += 1) {
        if (players[i].id !== releaserId) players[i] = { ...players[i], reactionDelay: reactionTicks(players[i]) };
      }
    };

    // 4. Bola.
    if (ball.ownerId !== null) {
      const holder = players.find((p) => p.id === ball.ownerId);
      ball = { ...ball, ...ballAtFeet(holder), vx: holder.vx, vy: holder.vy };
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

      if (isGoal) {
        // Gol: tim yang menyerang ke garis itu mencetak angka.
        const scoringTeamId = teamIds.find((id) => teams[id].attacksRight === (crossing.lineX === PITCH.length));
        const concedingTeamId = teamIds.find((id) => id !== scoringTeamId);
        stats.goals[scoringTeamId] += 1;
        if (ball.shotTeamId === scoringTeamId) stats.shots[scoringTeamId].onTarget += 1;
        lastGoal = {
          teamId: scoringTeamId,
          scorerId: ball.kickerId,
          ownGoal: ball.lastTouchTeamId !== scoringTeamId,
          tick,
        };
        ball = createInitialBall(concedingTeamId);
        pauseTicks = GOAL_PAUSE_TICKS;
        for (let i = 0; i < players.length; i += 1) {
          if (players[i].task !== 'shape') players[i] = { ...players[i], task: 'shape' };
        }
        for (const id of teamIds) teams[id].chaserId = null;
      } else if (touch && isShotReachingKeeper(ball, touch.player, from)) {
        // Kiper menjangkau tembakan: tangkap, atau tepis jadi bola muntah.
        const keeper = touch.player;
        const speed = Math.hypot(ball.vx, ball.vy);
        if (headingBetweenPosts(ball)) stats.shots[ball.shotTeamId].onTarget += 1;
        const contact = { x: from.x + (rolled.x - from.x) * touch.u, y: from.y + (rolled.y - from.y) * touch.u };
        if (rng.chance(catchChance(speed, keeper))) {
          stats.saves[keeper.teamId].caught += 1;
          ball = gainControl(ball, keeper, stats, rng);
          for (let i = 0; i < players.length; i += 1) {
            const p = players[i];
            if (p.id === keeper.id) players[i] = { ...p, task: 'hold' };
            else if (p.task !== 'shape') players[i] = { ...p, task: 'shape' };
          }
          for (const id of teamIds) teams[id].chaserId = null;
        } else {
          stats.saves[keeper.teamId].parried += 1;
          ball = releaseBall({ ...ball, ...clampToPitch(contact) }, keeper, parryVelocity(keeper, speed, rng), {});
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
        ball = releaseBall({ ...ball, ...clampToPitch(contact) }, blocker, deflectVelocity(ball, rng), {});
        startReactions(blocker.id);
      } else if (
        touch &&
        ball.restartTeamId === null &&
        !isKeeperHandling(touch.player, from) &&
        rng.chance(heavyTouchChance(touch.player, Math.hypot(ball.vx, ball.vy)))
      ) {
        // Sentuhan pertama terlalu jauh: bola memantul dari kaki dan bisa direbut siapa saja.
        const player = touch.player;
        const contact = { x: from.x + (rolled.x - from.x) * touch.u, y: from.y + (rolled.y - from.y) * touch.u };
        if (ball.passTeamId !== null && player.teamId === ball.passTeamId) stats.passes[player.teamId].completed += 1;
        if (ball.lastTouchTeamId !== null && player.teamId !== ball.lastTouchTeamId) stats.turnovers += 1;
        stats.heavyTouches[player.teamId] += 1;
        ball = releaseBall({ ...ball, ...clampToPitch(contact) }, player, heavyTouchVelocity(ball, rng), {});
        startReactions(player.id);
      } else if (touch) {
        ball = gainControl(ball, touch.player, stats, rng);
        // Tugas pemain mengikuti pergantian penguasaan di tick yang sama.
        for (let i = 0; i < players.length; i += 1) {
          const p = players[i];
          if (p.id === touch.player.id) players[i] = { ...p, task: 'hold' };
          else if (p.task !== 'shape') players[i] = { ...p, task: 'shape' };
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

    state = { ...prev, tick, teams, ball, players, stats, pauseTicks, lastGoal };
    return state;
  }

  // Maju satu tick. Saat jeda babak atau setelah peluit akhir, tidak ada yang bergerak.
  function step() {
    if (state.period === 'halftime' || state.period === 'fulltime') return state;

    advance();
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
      teamIds.map((id) => [id, { ...state.teams[id], attacksRight: !state.teams[id].attacksRight, chaserId: null }]),
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
      };
    });
    const kickOffTeamId = teamIds.find((id) => id !== state.firstKickOffTeamId);

    const next = {
      ...state,
      teams,
      players,
      ball: createInitialBall(kickOffTeamId),
      pauseTicks: 0,
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
