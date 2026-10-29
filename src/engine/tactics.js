// Taktik yang bisa diubah pelatih di tab Tim (29 Okt, layer manajer 8b).
//
//   formasi    : 4-4-2, 4-3-3, 4-2-3-1, 4-5-1, 3-5-2 — pemain di lapangan dipindah ke slot formasi
//                baru (yang paling cocok lini & jalurnya). Kalau tim kurang orang, slot paling depan
//                yang dikorbankan.
//   mentalitas : otomatis (AI pelatih) / bertahan / seimbang / menyerang (mentality.js)
//   tempo      : lambat / normal / cepat — pengali lama menahan bola (di atas tempo filosofi)
//   umpan silang: jarang / normal / sering — pengali kecenderungan umpan silang filosofi
//
// Filosofi pelatih TIDAK bisa diubah di tengah laga: ia identitas tim (geseran stat dari latihan).
// Perintah taktik berlaku SEKETIKA — pelatih berteriak dari pinggir lapangan, tidak perlu bola mati.

import { FORMATIONS, getFormation } from './formations.js';
import { MENTALITIES } from './mentality.js';

export const TEMPO_OPTIONS = Object.freeze({ lambat: 1.25, normal: 1, cepat: 0.8 });
export const CROSS_OPTIONS = Object.freeze({ jarang: 0.5, normal: 1, sering: 1.5 });
export const MENTALITY_MODES = Object.freeze(['otomatis', ...Object.keys(MENTALITIES)]);
export const MAX_CROSS_CHANCE = 0.95;

export function defaultTactics(formation) {
  return { formation, mentalityMode: 'otomatis', tempo: 'normal', cross: 'normal' };
}

const lineOfDepth = (depth) => (depth <= 0.24 ? 0 : depth <= 0.4 ? 1 : 2);

// Slot formasi untuk sejumlah pemain lapangan (kurang orang → buang slot paling depan, lalu paling lebar).
export function outfieldSlots(formation, count) {
  const slots = getFormation(formation).filter((s) => s.role !== 'GK');
  if (!(count >= 1 && count <= slots.length)) throw new RangeError(`outfieldSlots: jumlah ${count} tidak valid`);
  const sorted = [...slots].sort((a, b) => b.depth - a.depth || Math.abs(b.lane - 0.5) - Math.abs(a.lane - 0.5) || a.number - b.number);
  const dropped = new Set(sorted.slice(0, slots.length - count));
  return slots.filter((s) => !dropped.has(s));
}

// Pindahkan pemain lapangan satu tim ke formasi baru. Mengembalikan Map id → { slot, role }.
// Penugasan rakus pada biaya (beda lini × 10 + beda jalur): pemain tetap di lini & sisi yang mirip.
export function reshape(teamPlayers, formation) {
  const outfield = teamPlayers.filter((p) => p.role !== 'GK');
  const slots = outfieldSlots(formation, outfield.length);
  const pairs = [];
  for (const p of outfield) {
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i];
      const cost = Math.abs(lineOfDepth(p.slot.depth) - lineOfDepth(s.depth)) * 10 + Math.abs(p.slot.lane - s.lane);
      pairs.push({ p, i, cost });
    }
  }
  pairs.sort((a, b) => a.cost - b.cost || a.p.id.localeCompare(b.p.id) || a.i - b.i);
  const usedPlayers = new Set();
  const usedSlots = new Set();
  const result = new Map();
  for (const { p, i } of pairs) {
    if (usedPlayers.has(p.id) || usedSlots.has(i)) continue;
    usedPlayers.add(p.id);
    usedSlots.add(i);
    result.set(p.id, { slot: { depth: slots[i].depth, lane: slots[i].lane }, role: slots[i].role });
  }
  if (result.size !== outfield.length) throw new Error('reshape: ada pemain tanpa slot');
  return result;
}

export function tacticsErrors(changes) {
  const errors = [];
  if (changes.formation !== undefined && !FORMATIONS[changes.formation]) errors.push(`formasi tidak dikenal: ${changes.formation}`);
  if (changes.mentalityMode !== undefined && !MENTALITY_MODES.includes(changes.mentalityMode))
    errors.push(`mentalitas tidak dikenal: ${changes.mentalityMode}`);
  if (changes.tempo !== undefined && !(changes.tempo in TEMPO_OPTIONS)) errors.push(`tempo tidak dikenal: ${changes.tempo}`);
  if (changes.cross !== undefined && !(changes.cross in CROSS_OPTIONS)) errors.push(`umpan silang tidak dikenal: ${changes.cross}`);
  return errors;
}

// Terapkan perubahan taktik ke state (murni).
export function applyTactics(state, teamId, changes) {
  const team = state.teams[teamId];
  if (!team) throw new Error(`applyTactics: tim ${teamId} tidak ada`);
  const errors = tacticsErrors(changes);
  if (errors.length > 0) throw new RangeError(`applyTactics: ${errors.join('; ')}`);
  const tactics = { ...team.tactics, ...changes };
  let players = state.players;
  if (changes.formation !== undefined && changes.formation !== team.tactics.formation) {
    const moves = reshape(
      players.filter((p) => p.teamId === teamId),
      changes.formation,
    );
    players = players.map((p) => (moves.has(p.id) ? { ...p, ...moves.get(p.id) } : p));
  }
  // Mentalitas pilihan pelatih langsung berlaku (otomatis: diputuskan AI pelatih di tick berikutnya).
  const mentality = tactics.mentalityMode !== 'otomatis' ? tactics.mentalityMode : team.mentality;
  return { ...state, players, teams: { ...state.teams, [teamId]: { ...team, tactics, mentality } } };
}

export function validateTactics(tactics) {
  if (!tactics) return ['taktik tidak ada'];
  return tacticsErrors(tactics);
}
