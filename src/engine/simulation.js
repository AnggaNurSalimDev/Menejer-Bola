// Simulasi pertandingan: memegang state dan angka acak ber-seed,
// lalu memajukan semuanya satu tick setiap kali step() dipanggil.
// Tidak tahu apa-apa soal tampilan — bisa dijalankan di Node.
//
// Urutan satu tick:
//   1. Pemegang bola memutuskan: tetap menggiring atau mengoper.
//   2. Setiap tim menunjuk satu pemain untuk menjemput/menekan bola.
//   3. Setiap pemain mendapat tugas & target, lalu tubuhnya bergerak.
//   4. Bola bergerak: menempel di kaki pemegang, atau menggelinding
//      lalu dicek siapa yang menyentuhnya / apakah keluar lapangan.
//   5. Statistik dicatat.

import { createRng } from './rng.js';
import { createMatchState } from './state.js';
import { DT, DECISION_INTERVAL_TICKS, KICK_COOLDOWN_TICKS } from './constants.js';
import { clampToPitch, distance, isInsidePitch } from './pitch.js';
import { rollBall } from './ball.js';
import { computeAnchor } from './shape.js';
import { stepBody } from './movement.js';
import { pickChaser, pickPresser } from './roles.js';
import { evaluatePassOptions, dribbleTarget } from './passing.js';
import { findController } from './touch.js';
import { assignMarks, blendTowardMark } from './marking.js';

// Pemegang bola
const HOLD_MIN_TICKS = 10; // menggiring paling sedikit 1 detik sebelum mempertimbangkan operan
const HOLD_MAX_TICKS = 30;
const KEEPER_HOLD_MIN_TICKS = 8;
const KEEPER_HOLD_MAX_TICKS = 15;
const FORCED_PASS_TICKS = 35; // terlalu lama tanpa opsi aman → oper yang terbaik saja
const PRESSURE_RADIUS = 3; // meter
const PRESSURED_MIN_TICKS = 5; // ditekan pun, pemain butuh setengah detik untuk melepas operan
const PRESSURED_FORCED_TICKS = 10;
const DRIBBLE_SPEED_SCALE = 0.75;
const BALL_AHEAD_OF_FEET = 0.6; // meter

// Penghindaran rekan
const SEPARATION_RADIUS = 4; // meter
const SEPARATION_STRENGTH = 0.8;

// Bola mati diletakkan sedikit di dalam garis.
const RESTART_INSET = 0.5;

function cloneStats(stats) {
  return {
    possessionTicks: { ...stats.possessionTicks },
    passes: Object.fromEntries(Object.entries(stats.passes).map(([id, p]) => [id, { ...p }])),
    turnovers: stats.turnovers,
    outOfPlay: stats.outOfPlay,
  };
}

function facingOf(player, attacksRight) {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > 0.5) return { x: player.vx / speed, y: player.vy / speed };
  return { x: attacksRight ? 1 : -1, y: 0 };
}

function ballAtFeet(player, attacksRight) {
  const facing = facingOf(player, attacksRight);
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

function decideHolder(holder, ball, players, teams) {
  const team = teams[holder.teamId];
  const opponents = players.filter((p) => p.teamId !== holder.teamId);
  const pressured = nearestDistance(holder, opponents) < PRESSURE_RADIUS;

  const ready = ball.heldTicks >= ball.holdTarget || (pressured && ball.heldTicks >= PRESSURED_MIN_TICKS);
  if (!ready) return null;

  const options = evaluatePassOptions({
    holder,
    origin: ball,
    teammates: players.filter((p) => p.teamId === holder.teamId),
    opponents,
    attacksRight: team.attacksRight,
    previousOwnerId: ball.previousOwnerId,
  });
  if (options.length === 0) return null;

  const best = options[0];
  const forced =
    ball.heldTicks >= FORCED_PASS_TICKS || (pressured && ball.heldTicks >= PRESSURED_FORCED_TICKS);
  return best.safe || forced ? best : null;
}

function kick(ball, holder, option) {
  const d = distance(ball, option.target);
  if (!(d > 0)) throw new Error(`kick: jarak operan nol dari ${holder.id}`);
  return {
    ...ball,
    vx: ((option.target.x - ball.x) / d) * option.speed,
    vy: ((option.target.y - ball.y) / d) * option.speed,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    previousOwnerId: holder.id,
    kickerId: holder.id,
    kickCooldown: KICK_COOLDOWN_TICKS,
    passTargetId: option.receiver.id,
    passTeamId: holder.teamId,
    lastTouchTeamId: holder.teamId,
    restartTeamId: null,
  };
}

function gainControl(ball, controller, teams, stats, rng) {
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
    ...ballAtFeet(controller, teams[controller.teamId].attacksRight),
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
    lastTouchTeamId: controller.teamId,
    restartTeamId: null,
  };
}

// Bola keluar: diberikan ke lawan dari tim yang terakhir menyentuh,
// diletakkan di titik keluarnya (versi sederhana lemparan ke dalam).
function restartFromOut(ball, outPoint, teamIds) {
  const restartTeamId = teamIds.find((id) => id !== ball.lastTouchTeamId) ?? teamIds[0];
  const spot = clampToPitch(outPoint, RESTART_INSET);
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
    restartTeamId,
  };
}

export function createSimulation(home, away, seed) {
  if (!Number.isInteger(seed)) throw new TypeError(`createSimulation: seed harus bilangan bulat, dapat ${seed}`);

  const rng = createRng(seed);
  let state = createMatchState(home, away);
  const teamIds = Object.keys(state.teams);

  function step() {
    const prev = state;
    const tick = prev.tick + 1;
    const stats = cloneStats(prev.stats);
    const teams = Object.fromEntries(teamIds.map((id) => [id, { ...prev.teams[id] }]));
    const byId = new Map(prev.players.map((p) => [p.id, p]));
    let ball = { ...prev.ball };

    // 1. Pemegang bola: oper atau terus menggiring.
    if (ball.ownerId !== null) {
      const holder = byId.get(ball.ownerId);
      if (!holder) throw new Error(`step: pemegang bola ${ball.ownerId} tidak ditemukan`);
      ball.heldTicks += 1;
      const pass = decideHolder(holder, ball, prev.players, teams);
      if (pass) {
        ball = kick(ball, holder, pass);
        stats.passes[holder.teamId].attempted += 1;
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
        if (owner.teamId !== id) pick = pickPresser(own, owner, team.attacksRight, team.chaserId);
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
    const possessingTeamId = owner ? owner.teamId : (ball.passTeamId ?? ball.restartTeamId ?? null);

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
        const presserId = teamIds.map((id) => teams[id].chaserId).find((id) => id && byId.get(id).teamId !== player.teamId);
        const presser = presserId ? byId.get(presserId) : null;
        const pressing = presser && distance(presser, player) < PRESSURE_RADIUS * 2 ? presser : null;
        target = dribbleTarget(player, team.attacksRight, pressing);
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

      target = clampToPitch(target);
      const moveTarget = task === 'shape' ? applySeparation(target, player, prev.players) : target;
      const body = stepBody(player, moveTarget, DT, moveOptions);
      return { ...player, ...body, target, task };
    });

    // 4. Bola.
    if (ball.ownerId !== null) {
      const holder = players.find((p) => p.id === ball.ownerId);
      ball = { ...ball, ...ballAtFeet(holder, teams[holder.teamId].attacksRight), vx: holder.vx, vy: holder.vy };
    } else {
      const from = { x: ball.x, y: ball.y };
      const rolled = ball.restartTeamId !== null ? { ...from, vx: 0, vy: 0 } : rollBall(ball, DT);
      const cooldown = Math.max(0, ball.kickCooldown - 1);

      const controller = findController(
        from,
        rolled,
        players,
        (p) =>
          !(p.id === ball.kickerId && ball.kickCooldown > 0) &&
          (ball.restartTeamId === null || p.teamId === ball.restartTeamId),
      );

      if (controller) {
        ball = gainControl(ball, controller, teams, stats, rng);
        // Tugas pemain mengikuti pergantian penguasaan di tick yang sama.
        for (let i = 0; i < players.length; i += 1) {
          const p = players[i];
          if (p.id === controller.id) players[i] = { ...p, task: 'hold' };
          else if (p.task !== 'shape') players[i] = { ...p, task: 'shape' };
        }
        for (const id of teamIds) teams[id].chaserId = null;
      } else if (!isInsidePitch(rolled.x, rolled.y)) {
        stats.outOfPlay += 1;
        ball = restartFromOut(ball, rolled, teamIds);
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
      holderTeamId ?? ball.passTeamId ?? ball.restartTeamId ?? ball.lastTouchTeamId ?? teamIds[0];
    stats.possessionTicks[creditTeamId] += 1;

    state = { ...prev, tick, teams, ball, players, stats };
    return state;
  }

  return {
    getState: () => state,
    step,
  };
}
