// Gaya klub AI (7 Nov, disetujui pengguna): AI lawan memakai ALAT YANG SAMA dengan pengguna —
// isian taktik (tactics.js) + filosofi pelatih (philosophy.js) — hanya resepnya berbeda.
//
//   GAYA KLUB = { formasi, filosofi, perubahan taktik, (opsional) jalur pemain & kelompok }
//   Penyesuaian saat laga (unggul / tertinggal di menit akhir) ada di coachTactics (tactics.js).
//
// Modul murni: menghasilkan perubahan taktik untuk applyTactics; tidak menyentuh state.

import { mirrorGroups } from './tactics.js';
import { PHILOSOPHIES } from './philosophy.js';
import { FORMATIONS } from './formations.js';

export const CLUB_STYLES = Object.freeze({
  seimbang: Object.freeze({
    label: 'Seimbang',
    formation: '4-4-2',
    philosophy: 'seimbang',
    tactics: Object.freeze({}),
  }),
  penguasaan: Object.freeze({
    label: 'Penguasaan bola',
    formation: '4-3-3',
    philosophy: 'seimbang',
    tactics: Object.freeze({
      inPossession: { formation: '3-2-5', width: 'lebar', tempo: 'lambat', cross: 'jarang' },
      outOfPossession: { line: 'tinggi', press: 'tinggi' },
      onLoss: 'counterPress',
      onWin: 'bangunUlang',
    }),
    groups: 'trioLawan',
  }),
  pressing: Object.freeze({
    label: 'Pressing tinggi',
    formation: '4-3-3',
    philosophy: 'cepat',
    tactics: Object.freeze({
      inPossession: { tempo: 'cepat' },
      outOfPossession: { line: 'tinggi', press: 'tinggi' },
      onLoss: 'counterPress',
      onWin: 'seranganBalik',
    }),
  }),
  seranganBalik: Object.freeze({
    label: 'Serangan balik',
    formation: '4-4-2',
    philosophy: 'cepat',
    tactics: Object.freeze({
      inPossession: { tempo: 'cepat' },
      outOfPossession: { formation: '4-5-1', line: 'rendah', press: 'rendah', protect: 'tengah' },
      onLoss: 'mundur',
      onWin: 'seranganBalik',
    }),
  }),
  bertahan: Object.freeze({
    label: 'Bertahan dalam',
    formation: '5-4-1',
    philosophy: 'fisik',
    tactics: Object.freeze({
      outOfPossession: { line: 'rendah', press: 'rendah', protect: 'tengah' },
      onLoss: 'mundur',
      onWin: 'seimbang',
    }),
  }),
  sayap: Object.freeze({
    label: 'Sayap & umpan silang',
    formation: '4-4-2',
    philosophy: 'fisik',
    tactics: Object.freeze({
      inPossession: { width: 'lebar', cross: 'sering' },
      outOfPossession: { protect: 'sayap' },
    }),
    lanes: Object.freeze({ LM: 'melebar', RM: 'melebar', LW: 'melebar', RW: 'melebar', ST: 'kotak' }),
  }),
});

export const STYLE_KEYS = Object.freeze(Object.keys(CLUB_STYLES));

export function styleErrors() {
  const errors = [];
  for (const [key, s] of Object.entries(CLUB_STYLES)) {
    if (!FORMATIONS[s.formation]) errors.push(`${key}: formasi ${s.formation} tidak dikenal`);
    if (!PHILOSOPHIES[s.philosophy]) errors.push(`${key}: filosofi ${s.philosophy} tidak dikenal`);
    for (const f of [s.tactics.inPossession?.formation, s.tactics.outOfPossession?.formation]) if (f && !FORMATIONS[f]) errors.push(`${key}: formasi fase ${f} tidak dikenal`);
  }
  return errors;
}

export function getStyle(key) {
  const s = CLUB_STYLES[key];
  if (!s) throw new RangeError(`getStyle: gaya klub tidak dikenal "${key}"`);
  return s;
}

// Gaya acak dari rng() ∈ [0, 1).
export function randomStyle(rng) {
  const r = rng();
  if (!(r >= 0 && r < 1)) throw new RangeError('randomStyle: rng harus memberi [0, 1)');
  return STYLE_KEYS[Math.floor(r * STYLE_KEYS.length)];
}

// Trio di zona lawan kiri: 3 pemain lapangan paling kiri di antara gelandang/penyerang (depth ≥ 0,28,
// bingkai tim, lane kecil = kiri); lalu dicerminkan ke kanan dengan pasangan pemainnya.
function trioGroups(players, tactics) {
  const pool = players.filter((p) => p.role !== 'GK' && p.slot.depth >= 0.28).sort((a, b) => a.slot.lane - b.slot.lane);
  if (pool.length < 3) return [];
  const left = [{ id: 'ai-lk', zone: 'lawanKiri', memberIds: pool.slice(0, 3).map((p) => p.id) }];
  return mirrorGroups(players, { ...tactics, groups: left }, 'lawanKiri', (i) => `ai-lka${i}`).groups;
}

// Perubahan taktik lengkap untuk satu gaya. players = pemain tim di state (dengan slot & role),
// tactics = taktik tim saat ini (untuk cermin kelompok).
export function styleTactics(key, players, tactics) {
  const s = getStyle(key);
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('styleTactics: pemain kosong');
  const changes = {
    baseFormation: s.formation,
    ...s.tactics,
    inPossession: { formation: s.formation, ...(s.tactics.inPossession ?? {}) },
    outOfPossession: { formation: s.formation, ...(s.tactics.outOfPossession ?? {}) },
  };
  if (s.lanes) {
    const lanes = {};
    for (const p of players) if (s.lanes[p.role]) lanes[p.id] = s.lanes[p.role];
    changes.playerLanes = lanes;
  }
  if (s.groups === 'trioLawan') changes.groups = trioGroups(players, tactics);
  return changes;
}
