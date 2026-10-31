// Pergantian pemain (29 Okt, layer manajer 8a).
//
// Aturan (disepakati 29 Okt):
//   - maksimal 5 pergantian per tim; pemain yang sudah diganti tidak bisa masuk lagi
//   - pelatih MENGANTRIKAN pergantian kapan saja (simulasi tetap berjalan)
//   - antrian di babak 1 → dijalankan saat babak 2 dimulai
//   - antrian di babak 2 → dijalankan pada bola mati berikutnya (seperti aturan nyata)
//   - pemain masuk mengambil slot & peran yang ditinggalkan, masuk dari garis samping dekat garis tengah;
//     pemain keluar berjalan ke pinggir lapangan lalu hilang
//   - AI pelatih (tim lawan): mulai menit 55, saat bola mati, mengganti pemain lapangan yang paling lelah
//
// Semua fungsi murni: menerima state, mengembalikan state baru.

import { PITCH, clampToPitch } from './pitch.js';
import { deriveMovementProfile } from './movement.js';
import { initialDiscipline } from './fouls.js';
import { CONDITION } from './condition.js';
import { exitSpot } from './sendoff.js';

export const SUBS = Object.freeze({
  max: 5,
  aiFromMinute: 55,
  aiEnergyBelow: 0.62, // AI mengganti pemain lapangan dengan tenaga di bawah ini
  aiMaxPerStop: 1, // AI paling banyak satu pergantian per bola mati
  noticeTicks: 60, // pemberitahuan di layar (6 dtk)
});

const LINE_OF = (role) =>
  role === 'GK' ? 'GK' : ['CB', 'RB', 'LB'].includes(role) ? 'DEF' : ['DM', 'CM', 'RM', 'LM'].includes(role) ? 'MID' : 'FW';
export const roleLine = LINE_OF;

// Ubah data cadangan (dari teams.js) menjadi entri bangku cadangan di state.
export function benchEntry(teamId, p) {
  return { id: p.id, teamId, number: p.number, role: p.role, naturalRole: p.role, shortName: p.shortName, skills: { ...p.stats } };
}

// Validasi permintaan pergantian. Mengembalikan daftar pesan (kosong = sah).
export function substitutionErrors(state, teamId, outId, inId) {
  const team = state.teams[teamId];
  if (!team) return [`tim ${teamId} tidak ada`];
  const errors = [];
  const out = state.players.find((p) => p.id === outId);
  if (!out || out.teamId !== teamId) errors.push('pemain keluar tidak sedang bermain untuk tim ini');
  if (!team.bench.some((p) => p.id === inId)) errors.push('pemain masuk tidak ada di bangku cadangan');
  if (team.subQueue.some((q) => q.outId === outId)) errors.push('pemain ini sudah diantrikan keluar');
  if (team.subQueue.some((q) => q.inId === inId)) errors.push('pemain cadangan ini sudah diantrikan masuk');
  if (team.subsUsed + team.subQueue.length >= SUBS.max) errors.push(`jatah pergantian habis (maksimal ${SUBS.max})`);
  if (out && out.role === 'GK' && team.bench.find((p) => p.id === inId)?.role !== 'GK') {
    errors.push('kiper hanya bisa diganti kiper');
  }
  if (state.period === 'fulltime') errors.push('pertandingan sudah selesai');
  return errors;
}

export function queueSubstitution(state, teamId, outId, inId) {
  const errors = substitutionErrors(state, teamId, outId, inId);
  if (errors.length > 0) throw new Error(`queueSubstitution: ${errors.join('; ')}`);
  const team = state.teams[teamId];
  return {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, subQueue: [...team.subQueue, { outId, inId, queuedTick: state.tick }] } },
  };
}

export function cancelSubstitution(state, teamId, index) {
  const team = state.teams[teamId];
  if (!team || !(index >= 0 && index < team.subQueue.length)) throw new RangeError('cancelSubstitution: antrian tidak ada');
  return {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, subQueue: team.subQueue.filter((_, i) => i !== index) } },
  };
}

// Titik masuk: garis samping atas dekat garis tengah.
export function entrySpot() {
  return clampToPitch({ x: PITCH.length / 2, y: 0.5 }, 0.5);
}

// Jalankan semua antrian (semua tim). placeAt(player) → titik awal pemain masuk.
// Mengembalikan state baru; pergantian yang tidak lagi sah (mis. pemain sudah dikartu merah)
// dibatalkan dan dicatat di pemberitahuan.
export function applySubstitutions(state, tick, placeAt = () => entrySpot()) {
  let players = state.players;
  let subbedOff = state.subbedOff ?? [];
  const teams = { ...state.teams };
  const notices = [...(state.subNotices ?? [])];
  const stats = { ...state.stats, subs: { ...state.stats.subs } };
  let changed = false;
  for (const teamId of Object.keys(teams)) {
    const team = teams[teamId];
    if (team.subQueue.length === 0) continue;
    changed = true;
    let bench = team.bench;
    let subsUsed = team.subsUsed;
    for (const q of team.subQueue) {
      const out = players.find((p) => p.id === q.outId);
      const incoming = bench.find((p) => p.id === q.inId);
      if (!out || !incoming || subsUsed >= SUBS.max) {
        notices.push({ tick, teamId, outId: q.outId, inId: q.inId, status: 'dibatalkan' });
        continue;
      }
      const spot = placeAt(out);
      const skills = incoming.skills;
      const fresh = {
        id: incoming.id,
        teamId,
        attacksRight: out.attacksRight,
        number: incoming.number,
        role: out.role, // mengambil peran posisi yang ditinggalkan
        naturalRole: incoming.naturalRole,
        shortName: incoming.shortName,
        slot: out.slot,
        slotIn: out.slotIn ?? out.slot,
        slotOut: out.slotOut ?? out.slot,
        roleIn: out.roleIn ?? out.role,
        roleOut: out.roleOut ?? out.role,
        profile: deriveMovementProfile(skills),
        skills,
        x: spot.x,
        y: spot.y,
        vx: 0,
        vy: 0,
        target: { x: spot.x, y: spot.y },
        task: 'shape',
        tackleCooldown: 0,
        reactionDelay: 0,
        runCooldown: 0,
        condition: { energy: 1, confidence: CONDITION.startConfidence, form: 0, blunders: 0 },
        discipline: initialDiscipline(),
        subbedOn: tick,
      };
      players = players.map((p) => (p.id === out.id ? fresh : p));
      subbedOff = [
        ...subbedOff,
        {
          id: out.id,
          teamId,
          number: out.number,
          shortName: out.shortName,
          role: out.role,
          skills: out.skills,
          profile: out.profile,
          discipline: out.discipline,
          x: out.x,
          y: out.y,
          vx: out.vx,
          vy: out.vy,
          tick,
          walking: true,
          exit: exitSpot(out),
        },
      ];
      bench = bench.filter((p) => p.id !== incoming.id);
      subsUsed += 1;
      stats.subs[teamId] += 1;
      notices.push({ tick, teamId, outId: out.id, inId: incoming.id, status: 'masuk' });
    }
    teams[teamId] = { ...team, bench, subsUsed, subQueue: [] };
  }
  if (!changed) return state;
  return { ...state, players, subbedOff, teams, stats, subNotices: notices.filter((n) => tick - n.tick <= SUBS.noticeTicks) };
}

// AI pelatih: antrikan pergantian untuk pemain lapangan paling lelah (satu per bola mati).
export function aiSubstitutions(state, teamId, minute) {
  const team = state.teams[teamId];
  if (minute < SUBS.aiFromMinute || team.subsUsed + team.subQueue.length >= SUBS.max) return state;
  const tired = state.players
    .filter((p) => p.teamId === teamId && p.role !== 'GK' && !team.subQueue.some((q) => q.outId === p.id))
    .filter((p) => p.condition.energy < SUBS.aiEnergyBelow)
    .sort((a, b) => a.condition.energy - b.condition.energy || a.id.localeCompare(b.id));
  let next = state;
  let made = 0;
  for (const out of tired) {
    if (made >= SUBS.aiMaxPerStop) break;
    const benchNow = next.teams[teamId].bench.filter((p) => p.role !== 'GK' && !next.teams[teamId].subQueue.some((q) => q.inId === p.id));
    const sameLine = benchNow.find((p) => LINE_OF(p.role) === LINE_OF(out.role));
    const incoming = sameLine ?? benchNow[0];
    if (!incoming || substitutionErrors(next, teamId, out.id, incoming.id).length > 0) continue;
    next = queueSubstitution(next, teamId, out.id, incoming.id);
    made += 1;
  }
  return next;
}

export function validateSubstitutions(state) {
  const errors = [];
  for (const [teamId, team] of Object.entries(state.teams)) {
    if (!Array.isArray(team.bench) || !Array.isArray(team.subQueue)) {
      errors.push(`tim ${teamId}: data bangku cadangan tidak valid`);
      continue;
    }
    if (!(team.subsUsed >= 0 && team.subsUsed <= SUBS.max)) errors.push(`tim ${teamId}: pergantian ${team.subsUsed} di luar 0–${SUBS.max}`);
    if (team.subsUsed + team.subQueue.length > SUBS.max) errors.push(`tim ${teamId}: antrian melebihi jatah`);
    if (state.stats && state.stats.subs[teamId] !== team.subsUsed) errors.push(`tim ${teamId}: statistik pergantian tidak cocok`);
    const offCount = (state.subbedOff ?? []).filter((p) => p.teamId === teamId).length;
    if (offCount !== team.subsUsed) errors.push(`tim ${teamId}: pemain keluar ${offCount} ≠ pergantian ${team.subsUsed}`);
    const onPitch = new Set(state.players.map((p) => p.id));
    for (const p of team.bench) if (onPitch.has(p.id)) errors.push(`${p.id} di bangku cadangan sekaligus bermain`);
  }
  for (const p of state.subbedOff ?? []) {
    if (state.players.some((q) => q.id === p.id)) errors.push(`${p.id} sudah diganti tetapi masih bermain`);
  }
  return errors;
}
