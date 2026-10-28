// State pertandingan: satu-satunya data yang dibaca renderer.
// Engine tidak tahu apa-apa soal canvas atau piksel.

import { PITCH, isInsidePitch } from './pitch.js';
import { getFormation } from './formations.js';
import { validateStats } from './stats.js';
import { deriveMovementProfile } from './movement.js';
import { HALF_TICKS, GAME_MINUTES_PER_HALF, PERIODS, KICKOFF_WAIT_TICKS, MAX_RETURN_TICKS, PAUSE_REASONS } from './constants.js';
import { CONDITION, validateCondition } from './condition.js';
import { validateAirBall } from './aerial.js';
import { validatePhilosophy } from './philosophy.js';
import { createOfficials, validateOfficials } from './officials.js';
import { createRng } from './rng.js';

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
//   di udara     : z > 0 atau vz > 0 (tidak dikuasai; crossTeamId = tim pengirim umpan silang)
// restartTeamId terisi = bola mati (kick-off / keluar lapangan),
// hanya tim itu yang boleh mengambilnya.
export function createInitialBall(kickOffTeamId) {
  return {
    x: PITCH.length / 2,
    y: PITCH.width / 2,
    vx: 0,
    vy: 0,
    // Tinggi (m) dan laju naik (m/s): bola lambung (percobaan 2, 28 Okt).
    z: 0,
    vz: 0,
    crossTeamId: null,
    // Jenis tembakan yang sedang berjalan: 'foot' | 'long' | 'header' | null.
    shotKind: null,
    ownerId: null,
    heldTicks: 0,
    holdTarget: 0,
    previousOwnerId: null,
    kickerId: null,
    kickCooldown: 0,
    passTargetId: null,
    passTeamId: null,
    shotTeamId: null,
    // Offside (tahap 7a): saat seorang pemain memainkan bola, rekan-rekannya yang
    // akan dibenderai hakim garis bila ikut bermain (flag) dan yang benar-benar
    // offside (true). Keduanya bisa berbeda: hakim garis bisa salah.
    offsideFlagIds: [],
    offsideTrueIds: [],
    offsideTeamId: null, // tim pemain yang ditandai
    lastTouchTeamId: kickOffTeamId,
    restartTeamId: kickOffTeamId,
    // Jenis bola mati: 'kickoff' | 'throwIn' | 'goalKick' | 'corner' | 'freeKick' | null.
    restartKind: 'kickoff',
    // Bola mati yang sedang dieksekusi pemegang bola (untuk pengecualian offside).
    setPieceKind: null,
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
    crosses: perTeam(() => ({ attempted: 0, won: 0 })),
    headers: perTeam(() => ({ shots: 0, goals: 0 })),
    longShots: perTeam(() => ({ shots: 0, goals: 0 })), // tembakan kaki dari luar kotak penalti
    aerialsWon: perTeam(() => 0),
    turnovers: 0,
    outOfPlay: 0,
    // Tick persiapan kick-off (jam berhenti, tidak dihitung sebagai penguasaan bola).
    pauseTicks: 0,
    // Keputusan offside yang salah (untuk diukur; tidak tampil): lolos & salah bendera.
    offsideMissed: perTeam(() => 0),
    offsideWrong: perTeam(() => 0),
  };
}

export function emptyTeamRoles() {
  return { chaserId: null, runnerId: null, runTarget: null, runTicks: 0 };
}

// Setelah gol dan di awal babak, permainan jeda: pemain kembali ke posisi kick-off.
// Panjang jeda tidak tetap — lihat KICKOFF_WAIT_TICKS & MAX_RETURN_TICKS di constants.js.
export function kickoffPause(reason) {
  if (!PAUSE_REASONS.includes(reason)) throw new RangeError(`kickoffPause: alasan tidak dikenal "${reason}"`);
  return { pauseTicks: KICKOFF_WAIT_TICKS, pauseReason: reason, pauseElapsed: 0 };
}

export function createMatchState(home, away) {
  if (!home || !away) throw new TypeError('createMatchState: home dan away wajib ada');
  if (home.id === away.id) throw new Error('createMatchState: id kedua tim tidak boleh sama');

  const state = {
    tick: 0,
    teams: {
      // chaserId: pemain yang sedang menjemput/menekan bola untuk tim ini.
      // runnerId/runTarget/runTicks: penyerang yang sedang berlari ke belakang garis bek.
      // philosophy: kunci filosofi pelatih (philosophy.js).
      [home.id]: { id: home.id, name: home.name, colors: home.colors, philosophy: home.philosophy ?? 'seimbang', attacksRight: true, ...emptyTeamRoles() },
      [away.id]: { id: away.id, name: away.name, colors: away.colors, philosophy: away.philosophy ?? 'seimbang', attacksRight: false, ...emptyTeamRoles() },
    },
    ball: createInitialBall(home.id),
    players: [...placeTeam(home, true), ...placeTeam(away, false)],
    stats: createStats([home.id, away.id]),
    // Persiapan kick-off: pauseTicks = tick tunggu tersisa SETELAH semua pemain sampai di posisi
    // (0 = bermain normal), pauseReason = 'kickoff' | 'goal' | null, pauseElapsed = tick jeda berjalan.
    ...kickoffPause('kickoff'),
    // Gol terakhir, untuk ditampilkan UI: { teamId, scorerId, tick } atau null.
    lastGoal: null,
    // Perangkat pertandingan (officials.js). Simulasi mengacaknya ulang dengan seed laga.
    officials: createOfficials(createRng(1)),
    // Peluit terakhir untuk UI: { tick, kind: 'kickoff' | 'offside', teamId?, playerId? } atau null.
    whistle: null,
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
  if ((state.pauseTicks > 0) !== (state.pauseReason !== null)) errors.push('pauseReason harus terisi tepat saat jeda');
  if (state.pauseReason !== null && !PAUSE_REASONS.includes(state.pauseReason)) errors.push(`pauseReason tidak dikenal "${state.pauseReason}"`);
  if (!Number.isInteger(state.pauseElapsed) || state.pauseElapsed < 0 || state.pauseElapsed > MAX_RETURN_TICKS + KICKOFF_WAIT_TICKS) {
    errors.push(`pauseElapsed tidak valid (${state.pauseElapsed})`);
  }
  if (state.pauseTicks === 0 && state.pauseElapsed !== 0) errors.push('pauseElapsed tersisa di luar jeda');
  if (state.pauseReason === 'goal' && state.lastGoal === null) errors.push('jeda gol tanpa catatan gol');
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
  errors.push(...validateAirBall(ball));
  for (const id of teamIds) for (const e of validatePhilosophy(state.teams[id].philosophy)) errors.push(`tim ${id}: ${e}`);
  if ((ball.shotKind === null) !== (ball.shotTeamId === null)) errors.push('shotKind harus terisi tepat saat ada tembakan');
  if (ball.shotKind !== null && !['foot', 'long', 'header'].includes(ball.shotKind)) errors.push(`shotKind tidak dikenal "${ball.shotKind}"`);
  if (ball.crossTeamId !== null && !teamIds.includes(ball.crossTeamId)) errors.push('crossTeamId tidak valid');
  if (ball.crossTeamId !== null && ball.passTargetId !== null) errors.push('umpan silang sekaligus operan tanah');
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
  // Offside: penanda hanya berlaku saat bola sedang bergerak bebas setelah dimainkan.
  for (const key of ['offsideFlagIds', 'offsideTrueIds']) {
    const ids = ball[key];
    if (!Array.isArray(ids)) {
      errors.push(`${key} bukan daftar`);
      continue;
    }
    if (ids.length > 0 && (ball.ownerId !== null || ball.restartTeamId !== null)) {
      errors.push(`${key} terisi padahal bola dikuasai / bola mati`);
    }
    for (const id of ids) {
      const p = byId.get(id);
      if (!p) errors.push(`${key}: pemain "${id}" tidak ada`);
      else if (p.teamId !== ball.offsideTeamId) errors.push(`${key}: ${id} bukan anggota tim yang ditandai (${ball.offsideTeamId})`);
    }
  }
  if (ball.offsideTeamId !== null && !teamIds.includes(ball.offsideTeamId)) errors.push('offsideTeamId tidak valid');
  for (const id of ball.offsideFlagIds ?? []) if (ball.offsideFlagIds.indexOf(id) !== ball.offsideFlagIds.lastIndexOf(id)) errors.push('offsideFlagIds ganda');
  const RESTART_KINDS = ['kickoff', 'throwIn', 'goalKick', 'corner', 'freeKick'];
  if ((ball.restartTeamId === null) !== (ball.restartKind === null)) errors.push('restartKind harus terisi tepat saat bola mati');
  if (ball.restartKind !== null && !RESTART_KINDS.includes(ball.restartKind)) errors.push(`restartKind tidak dikenal "${ball.restartKind}"`);
  if (ball.setPieceKind !== null && (ball.ownerId === null || !RESTART_KINDS.includes(ball.setPieceKind))) {
    errors.push('setPieceKind hanya untuk pemegang bola yang mengeksekusi bola mati');
  }
  for (const e of validateOfficials(state.officials)) errors.push(`perangkat: ${e}`);
  if (state.whistle !== null && !(Number.isInteger(state.whistle.tick) && ['kickoff', 'offside'].includes(state.whistle.kind))) {
    errors.push('catatan peluit tidak valid');
  }

  if (state.stats) {
    const possessionTotal = teamIds.reduce((sum, id) => sum + state.stats.possessionTicks[id], 0);
    if (possessionTotal + state.stats.pauseTicks !== state.tick) {
      errors.push(`total tick penguasaan ${possessionTotal} + jeda ${state.stats.pauseTicks} ≠ tick ${state.tick}`);
    }
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
      const crosses = state.stats.crosses[id];
      if (!(crosses.won >= 0 && crosses.won <= crosses.attempted)) errors.push(`tim ${id}: umpan silang dimenangkan > dicoba`);
      const headers = state.stats.headers[id];
      if (!(headers.goals >= 0 && headers.goals <= headers.shots)) errors.push(`tim ${id}: gol sundulan > sundulan`);
      if (!(headers.goals <= state.stats.goals[id])) errors.push(`tim ${id}: gol sundulan > total gol`);
      const longShots = state.stats.longShots[id];
      if (!(longShots.goals >= 0 && longShots.goals <= longShots.shots)) errors.push(`tim ${id}: gol jarak jauh > tembakan jarak jauh`);
      if (!(longShots.shots <= state.stats.shots[id].total)) errors.push(`tim ${id}: tembakan jarak jauh > total tembakan`);
      if (!(longShots.goals + headers.goals <= state.stats.goals[id])) errors.push(`tim ${id}: gol jarak jauh + sundulan > total gol`);
      if (!(state.stats.aerialsWon[id] >= 0)) errors.push(`tim ${id}: duel udara tidak valid`);
      if (!(state.stats.offsideMissed[id] >= 0 && state.stats.offsideWrong[id] >= 0)) errors.push(`tim ${id}: catatan salah offside tidak valid`);
      if (!(state.stats.offsideWrong[id] <= state.stats.offsides[id])) errors.push(`tim ${id}: offside salah bendera > offside dinyatakan`);
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
