// State pertandingan: satu-satunya data yang dibaca renderer.
// Engine tidak tahu apa-apa soal canvas atau piksel.

import { PITCH, isInsidePitch } from './pitch.js';
import { getFormation } from './formations.js';
import { validateStats } from './stats.js';
import { deriveMovementProfile } from './movement.js';
import { HALF_TICKS, GAME_MINUTES_PER_HALF, PERIODS } from './constants.js';
import { CONDITION, validateCondition } from './condition.js';

const SPEED_TOLERANCE = 1e-6;
const OWNED_BALL_MAX_DISTANCE = 1.5; // meter
const MAX_REACTION_TICKS = 10; // 1 detik; reaksi terburuk di skill.js 0,55 detik

// Ubah slot formasi (relatif, menyerang ke kanan) menjadi koordinat meter.
// Tim yang menyerang ke kiri dicerminkan pada kedua sumbu, supaya
// sayap kanan tetap berada di sisi kanan arah serangnya.
export function slotToPitch(slot, attacksRight) {
  const x = slot.depth * PITCH.length;
  const y = slot.lane * PITCH.width;
  if (attacksRight) return { x, y };
  return { x: PITCH.length - x, y: PITCH.width - y };
}

function placeTeam(team, attacksRight) {
  const slots = getFormation(team.formation);
  const slotByNumber = new Map(slots.map((slot) => [slot.number, slot]));

  return team.players.map((player) => {
    const slot = slotByNumber.get(player.number);
    if (!slot) {
      throw new Error(`placeTeam: pemain #${player.number} tidak punya slot di ${team.formation}`);
    }
    const { x, y } = slotToPitch(slot, attacksRight);
    return {
      id: player.id,
      teamId: team.id,
      attacksRight,
      number: player.number,
      role: player.role,
      shortName: player.shortName,
      slot: { depth: slot.depth, lane: slot.lane },
      profile: deriveMovementProfile(player.stats),
      // Salinan stat 1–20, dipakai untuk duel (tekel) dan nanti untuk noise.
      skills: { ...player.stats },
      x,
      y,
      vx: 0,
      vy: 0,
      target: { x, y },
      // shape | hold | chase | receive | press
      task: 'shape',
      // Tick tersisa sebelum boleh mencoba tekel lagi.
      tackleCooldown: 0,
      // Tick tersisa sebelum pemain bereaksi terhadap bola yang baru dilepas (stat Antisipasi).
      reactionDelay: 0,
      // Tick tersisa sebelum boleh berlari ke belakang garis bek lagi.
      runCooldown: 0,
      // Kondisi (tahap 6). Form hari ini diacak oleh simulasi saat dibuat.
      condition: { energy: 1, confidence: CONDITION.startConfidence, form: 0, blunders: 0 },
    };
  });
}

export const TASKS = Object.freeze(['shape', 'hold', 'chase', 'receive', 'press', 'run']);

// Bola punya empat keadaan:
//   dikuasai     : ownerId terisi, bola menempel di kaki pemegangnya
//   dalam operan : ownerId kosong, passTargetId terisi
//   tembakan     : ownerId kosong, shotTeamId terisi
//   bebas        : semuanya kosong
// restartTeamId terisi = bola mati (kick-off / keluar lapangan),
// hanya tim itu yang boleh mengambilnya.
export function createInitialBall(kickOffTeamId) {
  return {
    x: PITCH.length / 2,
    y: PITCH.width / 2,
    vx: 0,
    vy: 0,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    previousOwnerId: null,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    // Penerima operan yang sudah offside saat bola dimainkan (atau null).
    offsideReceiverId: null,
    lastTouchTeamId: kickOffTeamId,
    restartTeamId: kickOffTeamId,
  };
}

function createStats(teamIds) {
  const perTeam = (make) => Object.fromEntries(teamIds.map((id) => [id, make()]));
  return {
    possessionTicks: perTeam(() => 0),
    passes: perTeam(() => ({ attempted: 0, completed: 0 })),
    shots: perTeam(() => ({ total: 0, onTarget: 0 })),
    goals: perTeam(() => 0),
    tackles: perTeam(() => ({ attempted: 0, won: 0 })),
    saves: perTeam(() => ({ caught: 0, parried: 0 })),
    heavyTouches: perTeam(() => 0),
    blocks: perTeam(() => 0),
    offsides: perTeam(() => 0),
    clearances: perTeam(() => 0),
    turnovers: 0,
    outOfPlay: 0,
  };
}

export function emptyTeamRoles() {
  return { chaserId: null, runnerId: null, runTarget: null, runTicks: 0 };
}

// Setelah gol, permainan jeda sejenak: pemain kembali ke posisi kick-off.
export const GOAL_PAUSE_TICKS = 40;

export function createMatchState(home, away) {
  if (!home || !away) throw new TypeError('createMatchState: home dan away wajib ada');
  if (home.id === away.id) throw new Error('createMatchState: id kedua tim tidak boleh sama');

  const state = {
    tick: 0,
    teams: {
      // chaserId: pemain yang sedang menjemput/menekan bola untuk tim ini.
      // runnerId/runTarget/runTicks: penyerang yang sedang berlari ke belakang garis bek.
      [home.id]: { id: home.id, name: home.name, colors: home.colors, attacksRight: true, ...emptyTeamRoles() },
      [away.id]: { id: away.id, name: away.name, colors: away.colors, attacksRight: false, ...emptyTeamRoles() },
    },
    ball: createInitialBall(home.id),
    players: [...placeTeam(home, true), ...placeTeam(away, false)],
    stats: createStats([home.id, away.id]),
    // Tick tersisa dari jeda setelah gol (0 = bermain normal).
    pauseTicks: 0,
    // Gol terakhir, untuk ditampilkan UI: { teamId, scorerId, tick } atau null.
    lastGoal: null,
    // Babak: first | halftime | second | fulltime. periodTick = tick di babak berjalan.
    period: 'first',
    periodTick: 0,
    // Tim yang melakukan kick-off babak pertama; tim lawannya kick-off di babak kedua.
    firstKickOffTeamId: home.id,
  };

  const errors = validateMatchState(state, [home, away]);
  if (errors.length > 0) {
    throw new Error(`State pertandingan tidak valid:\n- ${errors.join('\n- ')}`);
  }
  return state;
}

// Jam yang ditampilkan: 45 menit per babak, walau satu babak hanya 5 menit nyata.
export function gameClock(state) {
  if (!PERIODS.includes(state.period)) throw new RangeError(`gameClock: babak tidak dikenal "${state.period}"`);
  const fraction = Math.min(1, state.periodTick / HALF_TICKS);
  const half = state.period === 'first' ? 0 : state.period === 'halftime' ? 0 : 1;
  const elapsedInHalf = state.period === 'halftime' || state.period === 'fulltime' ? 1 : fraction;
  const totalSeconds = Math.floor((half + elapsedInHalf) * GAME_MINUTES_PER_HALF * 60);
  return { minute: Math.floor(totalSeconds / 60), second: totalSeconds % 60 };
}

// Invariant yang harus selalu benar di setiap tick.
export function validateMatchState(state, teams = []) {
  const errors = [];

  if (!Number.isInteger(state.tick) || state.tick < 0) errors.push(`tick tidak valid: ${state.tick}`);
  if (!PERIODS.includes(state.period)) errors.push(`babak tidak dikenal: ${state.period}`);
  if (!Number.isInteger(state.periodTick) || state.periodTick < 0 || state.periodTick > HALF_TICKS) {
    errors.push(`periodTick tidak valid: ${state.periodTick}`);
  }
  const [firstTeam, secondTeam] = Object.values(state.teams);
  if (firstTeam && secondTeam && firstTeam.attacksRight === secondTeam.attacksRight) {
    errors.push('kedua tim menyerang ke arah yang sama');
  }
  if (state.players.length !== 22) errors.push(`jumlah pemain ${state.players.length}, harus 22`);

  const ids = state.players.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push('ada id pemain ganda');

  const shortNames = state.players.map((p) => p.shortName);
  if (new Set(shortNames).size !== shortNames.length) errors.push('ada nama punggung ganda');

  for (const teamId of Object.keys(state.teams)) {
    const own = state.players.filter((p) => p.teamId === teamId);
    if (own.length !== 11) errors.push(`tim ${teamId}: ${own.length} pemain, harus 11`);

    const numbers = own.map((p) => p.number);
    if (new Set(numbers).size !== numbers.length) errors.push(`tim ${teamId}: nomor punggung ganda`);

    const keepers = own.filter((p) => p.role === 'GK').length;
    if (keepers !== 1) errors.push(`tim ${teamId}: ${keepers} kiper, harus 1`);
  }

  for (const p of state.players) {
    if (!isInsidePitch(p.x, p.y)) errors.push(`pemain ${p.id} di luar lapangan (${p.x}, ${p.y})`);
    if (!Number.isFinite(p.vx) || !Number.isFinite(p.vy)) {
      errors.push(`pemain ${p.id}: kecepatan bukan angka`);
    } else if (Math.hypot(p.vx, p.vy) > p.profile.maxSpeed + SPEED_TOLERANCE) {
      errors.push(`pemain ${p.id}: melebihi kecepatan maksimal`);
    }
    if (!p.target || !isInsidePitch(p.target.x, p.target.y)) {
      errors.push(`pemain ${p.id}: target di luar lapangan`);
    }
    if (!TASKS.includes(p.task)) errors.push(`pemain ${p.id}: tugas tidak dikenal "${p.task}"`);
    if (!Number.isInteger(p.tackleCooldown) || p.tackleCooldown < 0) {
      errors.push(`pemain ${p.id}: tackleCooldown tidak valid`);
    }
    if (!Number.isInteger(p.reactionDelay) || p.reactionDelay < 0 || p.reactionDelay > MAX_REACTION_TICKS) {
      errors.push(`pemain ${p.id}: reactionDelay tidak valid (${p.reactionDelay})`);
    }
    if (p.attacksRight !== state.teams[p.teamId]?.attacksRight) {
      errors.push(`pemain ${p.id}: arah serang tidak sama dengan timnya`);
    }
  }

  const byId = new Map(state.players.map((p) => [p.id, p]));
  const teamIds = Object.keys(state.teams);
  const { ball } = state;

  if (!isInsidePitch(ball.x, ball.y)) errors.push('bola di luar lapangan');
  if (!Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) errors.push('kecepatan bola bukan angka');
  if (!Number.isInteger(ball.kickCooldown) || ball.kickCooldown < 0) errors.push('kickCooldown bola tidak valid');
  if (!Number.isInteger(ball.heldTicks) || ball.heldTicks < 0) errors.push('heldTicks bola tidak valid');

  // Status bola harus tepat salah satu keadaan.
  if (ball.ownerId !== null) {
    const owner = byId.get(ball.ownerId);
    if (!owner) {
      errors.push(`pemegang bola "${ball.ownerId}" tidak ada`);
    } else if (Math.hypot(owner.x - ball.x, owner.y - ball.y) > OWNED_BALL_MAX_DISTANCE) {
      errors.push(`bola terlalu jauh dari pemegangnya ${owner.id}`);
    }
    if (ball.passTargetId !== null) errors.push('bola dikuasai sekaligus sedang dioper');
    if (ball.shotTeamId !== null) errors.push('bola dikuasai sekaligus sedang ditembakkan');
    if (ball.restartTeamId !== null) errors.push('bola dikuasai sekaligus bola mati');
  }
  if (ball.shotTeamId !== null) {
    if (!teamIds.includes(ball.shotTeamId)) errors.push('shotTeamId tidak valid');
    if (ball.passTargetId !== null) errors.push('bola dioper sekaligus ditembakkan');
  }

  // Jeda setelah gol: bola diam di titik tengah, menunggu kick-off.
  if (!Number.isInteger(state.pauseTicks) || state.pauseTicks < 0) errors.push('pauseTicks tidak valid');
  if (state.pauseTicks > 0) {
    if (ball.restartTeamId === null) errors.push('jeda gol tanpa tim kick-off');
    if (ball.x !== PITCH.length / 2 || ball.y !== PITCH.width / 2) errors.push('jeda gol tetapi bola tidak di tengah');
    if (state.players.some((p) => p.task !== 'shape')) errors.push('jeda gol tetapi ada pemain mengurus bola');
  }
  if (ball.passTargetId !== null) {
    const receiver = byId.get(ball.passTargetId);
    if (!receiver) errors.push(`penerima operan "${ball.passTargetId}" tidak ada`);
    else if (receiver.teamId !== ball.passTeamId) errors.push('penerima operan bukan rekan pengoper');
  }
  if ((ball.passTargetId === null) !== (ball.passTeamId === null)) {
    errors.push('passTargetId dan passTeamId harus terisi atau kosong bersamaan');
  }
  if (ball.restartTeamId !== null) {
    if (!teamIds.includes(ball.restartTeamId)) errors.push('restartTeamId tidak valid');
    if (ball.vx !== 0 || ball.vy !== 0) errors.push('bola mati tetapi bergerak');
  }
  if (ball.lastTouchTeamId !== null && !teamIds.includes(ball.lastTouchTeamId)) {
    errors.push('lastTouchTeamId tidak valid');
  }

  // Tugas pemain harus cocok dengan status bola.
  const holders = state.players.filter((p) => p.task === 'hold');
  if (holders.length > 1) errors.push(`${holders.length} pemain memegang bola sekaligus`);
  if ((holders[0]?.id ?? null) !== ball.ownerId) errors.push('tugas "hold" tidak cocok dengan pemegang bola');

  for (const teamId of teamIds) {
    const busy = state.players.filter(
      (p) => p.teamId === teamId && (p.task === 'chase' || p.task === 'receive' || p.task === 'press'),
    );
    if (busy.length > 1) errors.push(`tim ${teamId}: ${busy.length} pemain menjemput bola sekaligus`);
    const chaserId = state.teams[teamId].chaserId;
    if ((busy[0]?.id ?? null) !== chaserId) errors.push(`tim ${teamId}: chaserId tidak cocok dengan tugas pemain`);
  }

  // Statistik harus konsisten dengan waktu dan dengan dirinya sendiri.
  // Pelari ke belakang garis bek: paling banyak satu per tim, dan cocok dengan tugasnya.
  for (const teamId of teamIds) {
    const team = state.teams[teamId];
    const runners = state.players.filter((p) => p.teamId === teamId && p.task === 'run');
    if (runners.length > 1) errors.push(`tim ${teamId}: ${runners.length} pelari sekaligus`);
    if ((runners[0]?.id ?? null) !== team.runnerId) errors.push(`tim ${teamId}: runnerId tidak cocok dengan tugas pemain`);
    if (team.runnerId !== null && (!team.runTarget || !isInsidePitch(team.runTarget.x, team.runTarget.y))) {
      errors.push(`tim ${teamId}: target lari tidak valid`);
    }
  }
  for (const p of state.players) {
    if (!Number.isInteger(p.runCooldown) || p.runCooldown < 0) errors.push(`pemain ${p.id}: runCooldown tidak valid`);
    for (const e of validateCondition(p.condition)) errors.push(`pemain ${p.id}: kondisi — ${e}`);
  }
  if (ball.offsideReceiverId !== null && ball.offsideReceiverId !== ball.passTargetId) {
    errors.push('penanda offside bukan penerima operan yang sedang berjalan');
  }

  if (state.stats) {
    const possessionTotal = teamIds.reduce((sum, id) => sum + state.stats.possessionTicks[id], 0);
    if (possessionTotal !== state.tick) errors.push(`total tick penguasaan ${possessionTotal} ≠ tick ${state.tick}`);
    for (const id of teamIds) {
      const { attempted, completed } = state.stats.passes[id];
      if (!(completed >= 0 && completed <= attempted)) errors.push(`tim ${id}: operan sukses > operan dicoba`);
      const shots = state.stats.shots[id];
      if (!(shots.onTarget >= 0 && shots.onTarget <= shots.total)) errors.push(`tim ${id}: tembakan tepat > total`);
      const tackles = state.stats.tackles[id];
      if (!(tackles.won >= 0 && tackles.won <= tackles.attempted)) errors.push(`tim ${id}: tekel sukses > dicoba`);
      if (!Number.isInteger(state.stats.goals[id]) || state.stats.goals[id] < 0) errors.push(`tim ${id}: gol tidak valid`);
      const saves = state.stats.saves[id];
      if (!(saves.caught >= 0 && saves.parried >= 0)) errors.push(`tim ${id}: penyelamatan tidak valid`);
      if (!(state.stats.heavyTouches[id] >= 0)) errors.push(`tim ${id}: sentuhan buruk tidak valid`);
      if (!(state.stats.blocks[id] >= 0)) errors.push(`tim ${id}: blok tidak valid`);
      if (!(state.stats.offsides[id] >= 0)) errors.push(`tim ${id}: offside tidak valid`);
      if (!(state.stats.clearances[id] >= 0)) errors.push(`tim ${id}: sapuan tidak valid`);
    }
  } else {
    errors.push('stats tidak ada');
  }

  for (const team of teams) {
    for (const player of team.players) {
      for (const msg of validateStats(player.stats, player.role === 'GK')) {
        errors.push(`${player.id}: ${msg}`);
      }
    }
  }

  return errors;
}
