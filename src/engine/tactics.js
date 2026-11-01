// Taktik empat kotak (31 Okt, layer manajer). Menggantikan "mentalitas" (yang dulu mencampur
// semua fase jadi satu pilihan).
//
//   DENGAN BOLA     : formasi, lebar (sempit/normal/lebar), tempo, umpan silang
//   TANPA BOLA      : formasi, garis bek (rendah/normal/tinggi), tekanan (rendah/sedang/tinggi)
//   KEHILANGAN BOLA : counter-press / seimbang / mundur ke posisi
//   MEREBUT BOLA    : serangan balik / seimbang / bangun ulang
//
// Tiap pemain punya DUA slot: slotIn (dengan bola) & slotOut (tanpa bola). Bentuk tim bergeser mulus
// di antara keduanya saat bola berpindah tim (team.shapeBlend 0 → 1). Pengaturan BAWAAN menghasilkan
// permainan yang sama dengan sebelum taktik empat kotak (kalibrasi tidak berubah).
//
// Harga setiap pilihan (supaya tidak ada yang selalu menang):
//   garis tinggi   : merebut bola lebih di depan, tetapi ruang di belakang bek terbuka
//   garis rendah   : rapat & menutup tembakan, tetapi lawan bebas membangun serangan
//   tekanan tinggi : menekan di mana saja, menguras tenaga
//   counter-press  : 2 pemain tambahan menekan ±5 dtk setelah kehilangan bola, menguras tenaga,
//                    bentuk bertahan terlambat terbentuk
//   mundur         : bentuk bertahan cepat, tidak menekan sampai lawan masuk separuh sendiri
//   serangan balik : setelah merebut bola, langsung ke depan (berisiko kehilangan lagi)
//   bangun ulang   : setelah merebut bola, aman & sabar (serangan lebih lambat)
//
// Filosofi pelatih TIDAK bisa diubah di tengah laga: ia identitas tim (geseran stat dari latihan).
// Perintah taktik berlaku SEKETIKA — pelatih berteriak dari pinggir lapangan.

import { FORMATIONS, getFormation } from './formations.js';
import { PITCH, distance } from './pitch.js';

export const TEMPO_OPTIONS = Object.freeze({ lambat: 1.25, normal: 1, cepat: 0.8 });
export const CROSS_OPTIONS = Object.freeze({ jarang: 0.5, normal: 1, sering: 1.5 });
export const WIDTH_OPTIONS = Object.freeze({ sempit: 1.15, normal: 1.35, lebar: 1.5 });
export const LINE_OPTIONS = Object.freeze({
  rendah: Object.freeze({ shift: -4, compact: 0.8, coverRange: 36 }),
  normal: Object.freeze({ shift: 0, compact: 1, coverRange: 0 }),
  tinggi: Object.freeze({ shift: 5, compact: 1, coverRange: 0 }),
});
export const PRESS_OPTIONS = Object.freeze({
  rendah: Object.freeze({ zone: 0.45, drain: 0.94 }), // menekan hanya di ±45% lapangan dekat gawang sendiri
  sedang: Object.freeze({ zone: 0.7, drain: 0.97 }),
  tinggi: Object.freeze({ zone: 1, drain: 1 }), // menekan di mana saja (bawaan)
});
export const ON_LOSS = Object.freeze(['counterPress', 'seimbang', 'mundur']);
export const ON_WIN = Object.freeze(['seranganBalik', 'seimbang', 'bangunUlang']);
export const TRANSITION = Object.freeze({
  windowTicks: 50, // ±5 dtk setelah bola berpindah tim
  counterPressers: 2, // pemain tambahan yang ikut menekan
  counterRadius: 20, // meter dari bola: hanya yang sedekat ini ikut counter-press
  counterDrain: 1.08, // pengali tenaga tim yang memakai counter-press
  regroupZone: 0.4, // "mundur": hanya menekan bila bola ≤ 40% lapangan dari gawang sendiri
  counter: Object.freeze({ directness: 1.6, tempo: 0.7, runScale: 2 }), // serangan balik
  buildUp: Object.freeze({ directness: 0.75, tempo: 1.2, runScale: 0.3 }), // bangun ulang
  blendRate: 1 / 15, // bentuk berpindah dalam ±1,5 dtk
  blendRateFast: 1 / 7, // mundur / serangan balik: lebih cepat
  blendRateSlow: 1 / 40, // counter-press: tetap di bentuk menyerang lebih lama
});
// Taktik 5 jalur (1 Nov): lapangan dibagi kiri / half-space kiri / tengah / half-space kanan / kanan.
// "Kiri" = sisi kiri tim saat menghadap gawang lawan (jalur 0 di bingkai tim; LW ada di 0,08).
//   fokus serangan (dengan bola): seluruh bentuk bergeser ke satu sisi, atau merapat ke tengah
//   lindungi (tanpa bola)       : tengah = blok sempit (lawan dipaksa ke sayap); sayap = blok lebar
//   instruksi pemain (dengan bola): tetap di jalurnya / masuk half-space / melebar / naik ke kotak
export const FOCUS_OPTIONS = Object.freeze({
  seimbang: Object.freeze({ shift: 0, squeeze: 1 }),
  kiri: Object.freeze({ shift: -3, squeeze: 1 }), // meter di bingkai tim
  tengah: Object.freeze({ shift: 0, squeeze: 0.85 }),
  kanan: Object.freeze({ shift: 3, squeeze: 1 }),
});
export const PROTECT_OPTIONS = Object.freeze({ seimbang: 1, tengah: 0.85, sayap: 1.15 });
export const LANE_INSTRUCTIONS = Object.freeze(['tetap', 'halfSpace', 'melebar', 'kotak']);
export const LANES = Object.freeze({ halfSpace: 0.32, wide: 0.08, boxDepth: 0.45, boxNarrow: 0.4 });

// Slot dengan bola setelah instruksi pemain. slot = { depth, lane } (bingkai tim, lane 0 = kiri).
export function laneSlot(slot, instruction = 'tetap') {
  if (!slot || !Number.isFinite(slot.lane) || !Number.isFinite(slot.depth)) throw new TypeError('laneSlot: slot tidak valid');
  if (!LANE_INSTRUCTIONS.includes(instruction)) throw new RangeError(`laneSlot: instruksi tidak dikenal ${instruction}`);
  const left = slot.lane < 0.5;
  const center = Math.abs(slot.lane - 0.5) < 0.05;
  switch (instruction) {
    case 'halfSpace':
      return center ? slot : { ...slot, lane: left ? LANES.halfSpace : 1 - LANES.halfSpace };
    case 'melebar':
      return center ? slot : { ...slot, lane: left ? LANES.wide : 1 - LANES.wide };
    case 'kotak':
      return { depth: Math.max(slot.depth, LANES.boxDepth), lane: 0.5 + (slot.lane - 0.5) * LANES.boxNarrow };
    default:
      return slot;
  }
}

// Layer posisi (1 Nov, ide pengguna): pemain diseret di gambar taktik → titik patokan pribadi per
// pemain, satu untuk DENGAN BOLA (customIn) dan satu untuk TANPA BOLA (customOut). Disimpan sebagai slot
// di bingkai tim ({ depth, lane }, lane 0 = kiri) sehingga engine memakainya persis seperti slot formasi:
// tetap bergeser mengikuti bola, menjaga lawan, berlari — titik ini bobot besar, bukan rel kaku.
// Prioritas slot dengan bola: posisi pribadi > instruksi jalur > formasi.
export const CUSTOM_SLOT = Object.freeze({ depthMin: 0.17, depthMax: 0.55, laneMin: 0.03, laneMax: 0.97 });
export const MARKING_OPTIONS = Object.freeze(['zona', 'tempel']);
const PLAYER_MAPS = Object.freeze(['playerLanes', 'customIn', 'customOut', 'marking']);

export function validCustomSlot(slot) {
  return (
    slot !== null &&
    typeof slot === 'object' &&
    Number.isFinite(slot.depth) &&
    Number.isFinite(slot.lane) &&
    slot.depth >= CUSTOM_SLOT.depthMin - 1e-9 &&
    slot.depth <= CUSTOM_SLOT.depthMax + 1e-9 &&
    slot.lane >= CUSTOM_SLOT.laneMin - 1e-9 &&
    slot.lane <= CUSTOM_SLOT.laneMax + 1e-9
  );
}

export function clampCustomSlot(slot) {
  if (!slot || !Number.isFinite(slot.depth) || !Number.isFinite(slot.lane)) throw new TypeError('clampCustomSlot: slot tidak valid');
  return {
    depth: Math.min(CUSTOM_SLOT.depthMax, Math.max(CUSTOM_SLOT.depthMin, slot.depth)),
    lane: Math.min(CUSTOM_SLOT.laneMax, Math.max(CUSTOM_SLOT.laneMin, slot.lane)),
  };
}

// Slot efektif satu pemain lapangan di satu fase ('in' | 'out').
export function effectiveSlot(player, tactics, phase) {
  if (phase !== 'in' && phase !== 'out') throw new RangeError(`effectiveSlot: fase tidak dikenal ${phase}`);
  if (phase === 'out') return tactics?.customOut?.[player.id] ?? player.slotOut ?? player.slot;
  const custom = tactics?.customIn?.[player.id];
  if (custom) return custom;
  return laneSlot(player.slotIn ?? player.slot, tactics?.playerLanes?.[player.id] ?? 'tetap');
}

export const MAX_CROSS_CHANCE = 0.95;
// Skema bola mati (29 Okt):
//   sepak pojok      : campur / tiangDekat / tiangJauh / pendek
//   tendangan bebas  : otomatis / tembak / lambung / pendek
export const CORNER_SCHEMES = Object.freeze(['campur', 'tiangDekat', 'tiangJauh', 'pendek']);
export const FREE_KICK_SCHEMES = Object.freeze(['otomatis', 'tembak', 'lambung', 'pendek']);

export function defaultTactics(formation) {
  return {
    baseFormation: formation, // layer 1 (2 Nov): formasi dasar, acuan bayangan di gambar taktik
    inPossession: { formation, width: 'normal', tempo: 'normal', cross: 'normal', focus: 'seimbang' },
    outOfPossession: { formation, line: 'normal', press: 'tinggi', protect: 'seimbang' },
    playerLanes: {}, // id pemain → instruksi jalur dengan bola (tanpa entri = 'tetap')
    customIn: {}, // id pemain → { depth, lane } titik patokan pribadi dengan bola
    customOut: {}, // id pemain → { depth, lane } titik patokan pribadi tanpa bola
    marking: {}, // id pemain → 'zona' | 'tempel' (tanpa entri = 'zona')
    onLoss: 'seimbang',
    onWin: 'seimbang',
    corner: 'campur',
    freeKick: 'otomatis',
  };
}

// Gaya efektif satu tim di tick ini: dari taktik + jendela transisi yang sedang berjalan.
//   sinceLoss / sinceWin: tick sejak kehilangan / merebut bola (Infinity bila tidak relevan)
export function teamStyle(tactics, sinceLoss = Infinity, sinceWin = Infinity) {
  const line = LINE_OPTIONS[tactics.outOfPossession.line];
  const press = PRESS_OPTIONS[tactics.outOfPossession.press];
  const inWin = sinceWin <= TRANSITION.windowTicks;
  const inLoss = sinceLoss <= TRANSITION.windowTicks;
  const winMod =
    inWin && tactics.onWin === 'seranganBalik' ? TRANSITION.counter : inWin && tactics.onWin === 'bangunUlang' ? TRANSITION.buildUp : null;
  let pressZone = press.zone;
  if (inLoss && tactics.onLoss === 'mundur') pressZone = Math.min(pressZone, TRANSITION.regroupZone);
  return {
    blockShift: line.shift, // hanya saat tanpa bola (attackOnly ditangani di bawah)
    attackOnly: false,
    defendOnly: true,
    compact: line.compact,
    coverRange: line.coverRange,
    pressZone,
    widthAttack: WIDTH_OPTIONS[tactics.inPossession.width] * FOCUS_OPTIONS[tactics.inPossession.focus ?? 'seimbang'].squeeze,
    focusShift: FOCUS_OPTIONS[tactics.inPossession.focus ?? 'seimbang'].shift,
    protectWidth: PROTECT_OPTIONS[tactics.outOfPossession.protect ?? 'seimbang'],
    tempo: TEMPO_OPTIONS[tactics.inPossession.tempo] * (winMod?.tempo ?? 1),
    crossScale: CROSS_OPTIONS[tactics.inPossession.cross],
    directness: winMod?.directness ?? 1,
    runScale: winMod?.runScale ?? 1,
    energyDrain: press.drain * (tactics.onLoss === 'counterPress' ? TRANSITION.counterDrain : 1),
    counterPress: inLoss && tactics.onLoss === 'counterPress',
  };
}

// Boleh menekan pemegang bola di posisi ini?
export function pressAllowedAt(style, holder, defendingAttacksRight) {
  if (style.pressZone >= 1) return true;
  const ownGoal = { x: defendingAttacksRight ? 0 : PITCH.length, y: PITCH.width / 2 };
  return Math.abs(holder.x - ownGoal.x) <= style.pressZone * PITCH.length || distance(holder, ownGoal) <= style.pressZone * PITCH.length;
}

// Laju perpindahan bentuk menuju sasaran (1 = bentuk dengan bola, 0 = tanpa bola).
export function blendStep(blend, target, tactics) {
  if (!(blend >= 0 && blend <= 1)) throw new RangeError(`blendStep: blend tidak valid ${blend}`);
  if (blend === target) return blend;
  let rate = TRANSITION.blendRate;
  if (target === 0 && tactics.onLoss === 'counterPress') rate = TRANSITION.blendRateSlow;
  if (target === 0 && tactics.onLoss === 'mundur') rate = TRANSITION.blendRateFast;
  if (target === 1 && tactics.onWin === 'seranganBalik') rate = TRANSITION.blendRateFast;
  return target > blend ? Math.min(target, blend + rate) : Math.max(target, blend - rate);
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
// 2 Nov: penugasan OPTIMAL (algoritma Hungaria) yang meminimalkan jumlah kuadrat jarak lari (meter, sesuai
// rentangan lapangan saat bermain). Dulu rakus (pasangan termurah dulu): 4-4-2 → 3-2-5 mengirim bek
// tengah menjadi penyerang (lari ±45 m) alih-alih menggeser berantai bek → gelandang → penyerang.
// Kuadrat jarak membuat satu lari jauh lebih mahal daripada beberapa geseran pendek.
const RESHAPE_DEPTH_METERS = PITCH.length * 1.4; // = rentangan lini saat bermain (shape.js LINE_STRETCH)

export function reshape(teamPlayers, formation) {
  const outfield = teamPlayers.filter((p) => p.role !== 'GK').sort((a, b) => a.id.localeCompare(b.id));
  const slots = outfieldSlots(formation, outfield.length);
  if (slots.length !== outfield.length) throw new Error('reshape: jumlah slot tidak sama dengan jumlah pemain');
  const cost = outfield.map((p) =>
    slots.map((s) => {
      const dx = (p.slot.depth - s.depth) * RESHAPE_DEPTH_METERS;
      const dy = (p.slot.lane - s.lane) * PITCH.width;
      return dx * dx + dy * dy;
    }),
  );
  const assignment = minCostAssignment(cost);
  const result = new Map();
  outfield.forEach((p, i) => {
    const s = slots[assignment[i]];
    result.set(p.id, { slot: { depth: s.depth, lane: s.lane }, role: s.role });
  });
  if (result.size !== outfield.length || new Set(assignment).size !== outfield.length) throw new Error('reshape: ada pemain tanpa slot');
  return result;
}

// Penugasan biaya minimum untuk matriks n×n (algoritma Hungaria, O(n³)). Mengembalikan
// assignment[baris] = kolom. Deterministik untuk masukan yang sama.
export function minCostAssignment(cost) {
  const n = cost.length;
  if (n === 0) return [];
  if (!cost.every((row) => row.length === n && row.every(Number.isFinite))) throw new RangeError('minCostAssignment: matriks harus persegi & berhingga');
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0); // p[kolom] = baris (1-based)
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const assignment = new Array(n);
  for (let j = 1; j <= n; j += 1) assignment[p[j] - 1] = j - 1;
  return assignment;
}

// Susun ulang KEDUA slot (dengan & tanpa bola) satu tim dari taktiknya. Dipakai setelah ubah
// formasi, kartu merah (kurang orang), dan kiper darurat. Mengembalikan pemain baru (semua tim).
export function reslotTeam(players, teamId, tactics, blend) {
  const mine = players.filter((p) => p.teamId === teamId);
  const outMoves = reshape(
    mine.map((p) => ({ ...p, slot: p.slotOut ?? p.slot, role: p.role === 'GK' ? 'GK' : (p.roleOut ?? p.role) })),
    tactics.outOfPossession.formation,
  );
  const inMoves = reshape(
    mine.map((p) => ({ ...p, slot: p.slotIn ?? p.slot, role: p.role === 'GK' ? 'GK' : (p.roleIn ?? p.role) })),
    tactics.inPossession.formation,
  );
  return players.map((p) => {
    if (p.teamId !== teamId) return p;
    if (p.role === 'GK') return { ...p, slotIn: p.slot, slotOut: p.slot, roleIn: 'GK', roleOut: 'GK' };
    const o = outMoves.get(p.id);
    const i = inMoves.get(p.id);
    const active = blend >= 0.5 ? i : o;
    return { ...p, slotOut: o.slot, roleOut: o.role, slotIn: i.slot, roleIn: i.role, slot: active.slot, role: active.role };
  });
}

const PHASE_KEYS = Object.freeze({
  inPossession: Object.freeze({
    formation: (v) => Boolean(FORMATIONS[v]),
    width: (v) => v in WIDTH_OPTIONS,
    tempo: (v) => v in TEMPO_OPTIONS,
    cross: (v) => v in CROSS_OPTIONS,
    focus: (v) => v in FOCUS_OPTIONS,
  }),
  outOfPossession: Object.freeze({
    formation: (v) => Boolean(FORMATIONS[v]),
    line: (v) => v in LINE_OPTIONS,
    press: (v) => v in PRESS_OPTIONS,
    protect: (v) => v in PROTECT_OPTIONS,
  }),
});

export function tacticsErrors(changes) {
  const errors = [];
  for (const [phase, keys] of Object.entries(PHASE_KEYS)) {
    const part = changes[phase];
    if (part === undefined) continue;
    if (typeof part !== 'object' || part === null) {
      errors.push(`${phase} harus objek`);
      continue;
    }
    for (const [k, v] of Object.entries(part)) {
      if (!keys[k]) errors.push(`${phase}.${k} tidak dikenal`);
      else if (!keys[k](v)) errors.push(`${phase}.${k} tidak valid: ${v}`);
    }
  }
  if (changes.onLoss !== undefined && !ON_LOSS.includes(changes.onLoss)) errors.push(`kehilangan bola tidak dikenal: ${changes.onLoss}`);
  if (changes.onWin !== undefined && !ON_WIN.includes(changes.onWin)) errors.push(`merebut bola tidak dikenal: ${changes.onWin}`);
  if (changes.corner !== undefined && !CORNER_SCHEMES.includes(changes.corner)) errors.push(`skema pojok tidak dikenal: ${changes.corner}`);
  if (changes.freeKick !== undefined && !FREE_KICK_SCHEMES.includes(changes.freeKick))
    errors.push(`skema tendangan bebas tidak dikenal: ${changes.freeKick}`);
  // Peta per pemain: nilai null = hapus entri (kembali ke bawaan).
  const checkMap = (key, ok, what) => {
    if (changes[key] === undefined) return;
    if (typeof changes[key] !== 'object' || changes[key] === null) {
      errors.push(`${key} harus objek`);
      return;
    }
    for (const [id, v] of Object.entries(changes[key])) if (v !== null && !ok(v)) errors.push(`${what} ${id} tidak valid: ${JSON.stringify(v)}`);
  };
  if (changes.baseFormation !== undefined && !FORMATIONS[changes.baseFormation]) errors.push(`formasi dasar tidak dikenal: ${changes.baseFormation}`);
  checkMap('playerLanes', (v) => LANE_INSTRUCTIONS.includes(v), 'instruksi jalur');
  checkMap('customIn', validCustomSlot, 'posisi dengan bola');
  checkMap('customOut', validCustomSlot, 'posisi tanpa bola');
  checkMap('marking', (v) => MARKING_OPTIONS.includes(v), 'penjagaan');
  const known = new Set(['baseFormation', 'inPossession', 'outOfPossession', 'onLoss', 'onWin', 'corner', 'freeKick', ...PLAYER_MAPS]);
  for (const k of Object.keys(changes)) if (!known.has(k)) errors.push(`pengaturan taktik tidak dikenal: ${k}`);
  return errors;
}

export function mergeTactics(tactics, changes) {
  return {
    ...tactics,
    ...changes,
    inPossession: { ...tactics.inPossession, ...(changes.inPossession ?? {}) },
    outOfPossession: { ...tactics.outOfPossession, ...(changes.outOfPossession ?? {}) },
    ...Object.fromEntries(PLAYER_MAPS.map((k) => [k, mergeMap(tactics[k], changes[k])])),
  };
}

function mergeMap(base = {}, change) {
  if (change === undefined) return { ...base };
  const out = { ...base };
  for (const [id, v] of Object.entries(change)) {
    if (v === null) delete out[id];
    else out[id] = v;
  }
  return out;
}

// Pemain masuk mewarisi semua instruksi pribadi pemain yang ia gantikan (jalur, posisi, penjagaan).
export function transferLaneInstruction(tactics, outId, inId) {
  const next = { ...tactics };
  for (const k of PLAYER_MAPS) {
    const map = { ...(tactics[k] ?? {}) };
    if (map[outId] !== undefined) map[inId] = map[outId];
    delete map[outId];
    next[k] = map;
  }
  return next;
}

// Terapkan perubahan taktik ke state (murni). changes boleh sebagian, mis. { outOfPossession: { line: 'tinggi' } }.
export function applyTactics(state, teamId, changes) {
  const team = state.teams[teamId];
  if (!team) throw new Error(`applyTactics: tim ${teamId} tidak ada`);
  const errors = tacticsErrors(changes);
  if (errors.length > 0) throw new RangeError(`applyTactics: ${errors.join('; ')}`);
  for (const k of PLAYER_MAPS) {
    for (const [id, v] of Object.entries(changes[k] ?? {})) {
      if (v === null) continue; // menghapus selalu boleh
      const p = state.players.find((q) => q.id === id);
      if (!p || p.teamId !== teamId) throw new RangeError(`applyTactics: ${id} tidak sedang bermain untuk tim ${teamId}`);
      if (p.role === 'GK') throw new RangeError(`applyTactics: kiper ${id} tidak diberi instruksi pribadi`);
    }
  }
  let tactics = mergeTactics(team.tactics, changes);
  // Ganti formasi di satu layer → posisi pribadi layer itu dihapus (titiknya milik formasi lama).
  if (tactics.inPossession.formation !== team.tactics.inPossession.formation && changes.customIn === undefined) tactics = { ...tactics, customIn: {} };
  if (tactics.outOfPossession.formation !== team.tactics.outOfPossession.formation && changes.customOut === undefined) tactics = { ...tactics, customOut: {} };
  const formationChanged =
    tactics.inPossession.formation !== team.tactics.inPossession.formation ||
    tactics.outOfPossession.formation !== team.tactics.outOfPossession.formation;
  const players = formationChanged ? reslotTeam(state.players, teamId, tactics, team.shapeBlend ?? 0) : state.players;
  // Taktik aktif langsung ikut (tim AI menyesuaikannya lagi di tick berikutnya bila perlu).
  return { ...state, players, teams: { ...state.teams, [teamId]: { ...team, tactics, baseTactics: tactics, activeTactics: tactics } } };
}

// AI pelatih (untuk tim yang diatur AI): kalah jumlah → garis rendah (rapat, menutup tembakan; dulu
// "mentalitas bertahan" — uji 29 Okt: menambah main langsung justru membuat tim lebih bocor);
// tertinggal di menit ≥ 75 → kembali ke taktik dasarnya untuk mengejar. Mengembalikan taktik yang dipakai.
export const COACH = Object.freeze({ chaseMinute: 75 });

export function coachTactics(base, { own, opponents, goalsFor, goalsAgainst, minute }) {
  if (!(own > 0 && opponents > 0)) throw new RangeError('coachTactics: jumlah pemain tidak valid');
  if (own >= opponents) return base;
  if (goalsFor < goalsAgainst && minute >= COACH.chaseMinute) return base;
  return mergeTactics(base, { outOfPossession: { line: 'rendah' } });
}

export function isDefensiveShape(tactics) {
  return tactics.outOfPossession.line === 'rendah';
}

export function validateTactics(tactics) {
  if (!tactics || !tactics.inPossession || !tactics.outOfPossession) return ['taktik tidak lengkap'];
  return tacticsErrors(tactics);
}

// Posisi formasi dasar per pemain (2 Nov, bayangan di gambar taktik): pemain lapangan dipasangkan ke
// slot formasi dasar dengan aturan yang sama seperti ganti formasi (reshape), mulai dari slot tanpa bola.
// Mengembalikan Map id → slot. Kiper memakai slotnya sendiri.
export function baseSlots(players, tactics) {
  const formation = tactics?.baseFormation ?? tactics?.outOfPossession?.formation;
  if (!FORMATIONS[formation]) throw new RangeError(`baseSlots: formasi dasar tidak dikenal ${formation}`);
  const result = new Map();
  for (const p of players) if (p.role === 'GK') result.set(p.id, p.slot);
  const outfield = players.filter((p) => p.role !== 'GK');
  if (outfield.length === 0) return result;
  const moves = reshape(
    players.map((p) => ({ ...p, slot: p.slotOut ?? p.slot, role: p.role === 'GK' ? 'GK' : (p.roleOut ?? p.role) })),
    formation,
  );
  for (const [id, m] of moves) result.set(id, m.slot);
  return result;
}
