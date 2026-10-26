// State pertandingan: satu-satunya data yang dibaca renderer.
// Engine tidak tahu apa-apa soal canvas atau piksel.

import { PITCH, isInsidePitch } from './pitch.js';
import { getFormation } from './formations.js';
import { validateStats } from './stats.js';

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
      number: player.number,
      role: player.role,
      shortName: player.shortName,
      x,
      y,
      vx: 0,
      vy: 0,
    };
  });
}

export function createMatchState(home, away) {
  if (!home || !away) throw new TypeError('createMatchState: home dan away wajib ada');
  if (home.id === away.id) throw new Error('createMatchState: id kedua tim tidak boleh sama');

  const state = {
    tick: 0,
    teams: {
      [home.id]: { id: home.id, name: home.name, colors: home.colors, attacksRight: true },
      [away.id]: { id: away.id, name: away.name, colors: away.colors, attacksRight: false },
    },
    ball: { x: PITCH.length / 2, y: PITCH.width / 2, vx: 0, vy: 0 },
    players: [...placeTeam(home, true), ...placeTeam(away, false)],
  };

  const errors = validateMatchState(state, [home, away]);
  if (errors.length > 0) {
    throw new Error(`State pertandingan tidak valid:\n- ${errors.join('\n- ')}`);
  }
  return state;
}

// Invariant yang harus selalu benar di setiap tick.
export function validateMatchState(state, teams = []) {
  const errors = [];

  if (!Number.isInteger(state.tick) || state.tick < 0) errors.push(`tick tidak valid: ${state.tick}`);
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
  }

  if (!isInsidePitch(state.ball.x, state.ball.y)) errors.push('bola di luar lapangan');

  for (const team of teams) {
    for (const player of team.players) {
      for (const msg of validateStats(player.stats, player.role === 'GK')) {
        errors.push(`${player.id}: ${msg}`);
      }
    }
  }

  return errors;
}
