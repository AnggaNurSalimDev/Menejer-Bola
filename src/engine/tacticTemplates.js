// Template taktik gaya klub elit Eropa (15 Nov, keputusan pengguna: nama konsep, bukan nama pelatih;
// dari yang paling sederhana sampai paling rumit; saran pemain ⇄ template dua arah; tim perlu
// MEMAHAMI template — kalau terlalu rumit untuk pemahaman tim, rencana tidak jalan di lapangan).
//
//   TEMPLATE = { formasi dasar, perubahan taktik (2 fase, garis, tekanan, operan…), jalur per peran,
//                kelompok (trio), skema berbasis PERAN (diisi id pemain saat dipakai), kebutuhan stat }
//
//   kerumitan(taktik) 1–5 ★ ── dihitung dari ISI taktik (berlaku juga untuk taktik buatan sendiri)
//        └─▶ butuh pemahaman = 18% × ★
//   pemahaman efektif = keakraban tim dgn template × rata-rata pemain inti (kecerdasan × lama di klub)
//   kekurangan d = (butuh − efektif) / butuh, dijepit 0–1 ──▶ engine (simulation.js, UNDERSTANDING)
//
// Modul murni: tidak menyentuh state; pemanggil menerapkan hasil lewat simulation.setTactics.

import { mirrorGroups } from './tactics.js';
import { getFormation } from './formations.js';

export const TEMPLATE_KEYS = Object.freeze(['klasik442', 'blokRendah', 'sayap', 'gegenpress', 'tigaBek', 'bekKeTengah', 'posisional', 'pancingan']);
export const UNDERSTANDING_PER_STAR = 18; // % pemahaman yang dibutuhkan per ★ kerumitan
export const FAMILIARITY = Object.freeze({
  base: 30, // pengetahuan dasar sepak bola: setiap template mulai dari sini
  perMatch: 5, // + per laga memakai template (× kecepatan belajar): ★5 dari dasar ±12 laga, ±8 dengan latihan taktik
  perTraining: 3, // + per babak bila fokus latihan "taktik"
  decay: 0.3, // − per babak untuk template yang tidak dipakai (tidak turun di bawah dasar)
  tenureFull: 10, // babak sampai pemain baru paham sepenuhnya cara main tim
});

// Kebutuhan stat per kelompok peran (bobot). Peran: GK, CB, FB (bek sayap), WB (wing-back), DM, CM,
// W (sayap), ST. Template menambah/mengubah bobot lewat `needs`.
const BASE_NEEDS = {
  GK: { refleks: 3, penempatan: 2, tangkapan: 2 },
  CB: { tackling: 3, posisi: 3, duelUdara: 2, kekuatan: 2, antisipasi: 1 },
  FB: { kecepatan: 2, stamina: 2, tackling: 2, passing: 1, posisi: 1 },
  WB: { stamina: 3, kecepatan: 2, passing: 1, tackling: 1, dribbling: 1 },
  DM: { posisi: 2, tackling: 2, passing: 2, keputusan: 2, antisipasi: 1 },
  CM: { passing: 3, visi: 2, stamina: 1, keputusan: 2, kontrol: 1 },
  W: { kecepatan: 2, dribbling: 3, akselerasi: 2, passing: 1, finishing: 1 },
  ST: { finishing: 3, duelUdara: 1, kontrol: 1, akselerasi: 1, keputusan: 1 },
};
const ROLE_KIND = { GK: 'GK', CB: 'CB', RB: 'FB', LB: 'FB', RWB: 'WB', LWB: 'WB', DM: 'DM', CM: 'CM', AM: 'CM', RM: 'W', LM: 'W', RW: 'W', LW: 'W', ST: 'ST' };

const tk = (s) => s; // penanda teks untuk pemeriksa kamus (label dirender lewat t() di UI)

export const TEMPLATES = Object.freeze({
  klasik442: {
    label: tk('4-4-2 Klasik'),
    idea: tk('Dua lini empat yang rapat dan dua penyerang. Tidak ada instruksi khusus — titik awal paling mudah dipahami.'),
    formation: '4-4-2',
    tactics: {},
    needs: {},
  },
  blokRendah: {
    label: tk('Blok Rendah & Serangan Balik'),
    idea: tk('Bertahan dalam 4-5-1 dekat gawang sendiri, menutup tengah, lalu menyerang cepat dengan bola langsung begitu merebut bola.'),
    formation: '4-4-2',
    tactics: {
      inPossession: { tempo: 'cepat', passing: 'langsung' },
      outOfPossession: { formation: '4-5-1', line: 'rendah', press: 'rendah', protect: 'tengah' },
      onLoss: 'mundur',
      onWin: 'seranganBalik',
    },
    needs: { CB: { posisi: 2, antisipasi: 2 }, DM: { posisi: 2 }, CM: { stamina: 1, tackling: 1 }, ST: { kecepatan: 3, akselerasi: 2 }, W: { kecepatan: 2 } },
  },
  sayap: {
    label: tk('Sayap & Umpan Silang'),
    idea: tk('Gelandang sayap melebar sampai garis, umpan silang sering ke dua penyerang yang menunggu di kotak.'),
    formation: '4-4-2',
    tactics: { inPossession: { width: 'lebar', cross: 'sering' }, outOfPossession: { protect: 'sayap' } },
    lanes: { LM: 'melebar', RM: 'melebar', ST: 'kotak' },
    needs: { W: { kecepatan: 2, passing: 2, stamina: 1 }, ST: { duelUdara: 3, kekuatan: 1 }, FB: { stamina: 1 } },
  },
  gegenpress: {
    label: tk('Gegenpress'),
    idea: tk('Garis tinggi, menekan di mana saja, dan langsung merebut balik bola sesaat setelah kehilangan. Melelahkan: butuh stamina & kecepatan di seluruh tim.'),
    formation: '4-3-3',
    tactics: {
      inPossession: { tempo: 'cepat' },
      outOfPossession: { line: 'tinggi', press: 'tinggi' },
      onLoss: 'counterPress',
      onWin: 'seranganBalik',
    },
    lanes: { RB: 'melebar', LB: 'melebar' },
    needs: { ALL: { stamina: 2, akselerasi: 1, kecepatan: 1 }, CM: { tackling: 1 }, CB: { kecepatan: 2 } },
  },
  tigaBek: {
    label: tk('Tiga Bek & Wing-back'),
    idea: tk('Tiga bek tengah; wing-back menjaga lebar sendirian — mundur jadi lima saat bertahan, maju jadi lima di depan saat menyerang. Sayap masuk ke half-space.'),
    formation: '3-4-3',
    tactics: {
      inPossession: { width: 'lebar', tempo: 'normal' },
      outOfPossession: { formation: '5-4-1', line: 'normal', press: 'sedang' },
      onWin: 'seranganBalik',
    },
    lanes: { RM: 'melebar', LM: 'melebar', RW: 'halfSpace', LW: 'halfSpace' },
    roleKind: { RM: 'WB', LM: 'WB' },
    needs: { WB: { stamina: 2 }, CB: { passing: 1 } },
  },
  bekKeTengah: {
    label: tk('Bek Sayap ke Tengah (3-2-5)'),
    idea: tk('Saat menguasai bola, bek sayap masuk ke lini tengah membentuk 3-2-5: dua gelandang bertahan melindungi, lima pemain mengisi lebar & half-space. Trio kecil di sisi lawan.'),
    formation: '4-3-3',
    tactics: {
      inPossession: { formation: '3-2-5', width: 'lebar', passing: 'pendek' },
      outOfPossession: { line: 'tinggi', press: 'tinggi' },
      onLoss: 'counterPress',
      onWin: 'bangunUlang',
    },
    groups: 'trio',
    needs: { FB: { passing: 2, keputusan: 2, kontrol: 1 }, DM: { passing: 1 }, CM: { kontrol: 1 } },
  },
  posisional: {
    label: tk('Penguasaan Posisional'),
    idea: tk('Operan pendek & sabar, tiap zona terisi (lebar, half-space, tengah). Trio di sisi lawan dan skema "pemain ketiga": gelandang → penyerang turun → sayap lari di belakang bek.'),
    formation: '4-3-3',
    tactics: {
      inPossession: { formation: '3-2-5', width: 'lebar', tempo: 'lambat', passing: 'pendek', cross: 'jarang' },
      outOfPossession: { line: 'tinggi', press: 'tinggi' },
      onLoss: 'counterPress',
      onWin: 'bangunUlang',
    },
    lanes: { CM: 'halfSpace' },
    groups: 'trio',
    scripts: 'pemainKetiga',
    needs: { ALL: { passing: 2, kontrol: 1, keputusan: 1 }, CM: { visi: 2 }, ST: { kontrol: 2, passing: 1 }, CB: { passing: 2 } },
  },
  pancingan: {
    label: tk('Umpan Pancingan'),
    idea: tk('Membangun serangan dari belakang dengan sengaja memancing tekanan lawan ke bek, lalu operan vertikal cepat melewati garis tekanan ke penyerang yang turun, dan sayap berlari.'),
    formation: '4-2-3-1',
    tactics: {
      inPossession: { formation: '3-2-5', tempo: 'lambat', passing: 'pendek' },
      outOfPossession: { line: 'tinggi', press: 'sedang' },
      onLoss: 'counterPress',
      onWin: 'bangunUlang',
    },
    groups: 'trio',
    scripts: 'pancing',
    needs: { CB: { passing: 3, kontrol: 2 }, GK: { penempatan: 1 }, DM: { passing: 2, kontrol: 2, keputusan: 1 }, ST: { kontrol: 2, passing: 2 }, W: { akselerasi: 2 } },
  },
});

export function getTemplate(key) {
  const t = TEMPLATES[key];
  if (!t) throw new RangeError(`getTemplate: template tidak dikenal "${key}"`);
  return t;
}

// ---------------------------------------------------------------- kerumitan (dari isi taktik)

export function complexityOf(tactics) {
  if (!tactics || !tactics.inPossession || !tactics.outOfPossession) throw new TypeError('complexityOf: taktik tidak lengkap');
  let c = 1;
  const ip = tactics.inPossession;
  const op = tactics.outOfPossession;
  if (ip.formation !== op.formation) c += 0.5; // dua bentuk
  if (op.press === 'tinggi' && op.line === 'tinggi') c += 0.5; // pressing tinggi butuh koordinasi
  if (tactics.onLoss === 'counterPress') c += 0.5;
  if (ip.passing === 'pendek' && ip.tempo === 'lambat') c += 0.5; // sabar membangun
  const n = (o) => Object.keys(o ?? {}).length;
  if (n(tactics.playerLanes) > 0) c += 0.5;
  if (n(tactics.customIn) + n(tactics.customOut) > 0) c += 0.5;
  if (Object.values(tactics.marking ?? {}).includes('tempel')) c += 0.5;
  const zones = (z) => Object.values(z ?? {}).filter((m) => Object.keys(m).length > 0).length;
  if (zones(tactics.zoneIn) + zones(tactics.zoneOut) > 0) c += 0.5;
  if ((tactics.groups ?? []).length > 0) c += 1;
  const sc = (tactics.scripts ?? []).length;
  if (sc > 0) c += 1 + 0.25 * Math.min(4, sc - 1);
  return Math.min(5, Math.round(c * 2) / 2);
}

export const requiredUnderstanding = (complexity) => Math.min(100, UNDERSTANDING_PER_STAR * complexity);

// ---------------------------------------------------------------- pemahaman

const norm = (v) => (Math.min(20, Math.max(1, v ?? 10)) - 1) / 19;
export const iqOf = (p) => (norm(p.stats.keputusan) + norm(p.stats.visi) + norm(p.stats.posisi) + norm(p.stats.antisipasi)) / 4;

// Kecepatan belajar tim (pemain inti): 0,6 (lamban) – 1,4 (cerdas).
export function learnRate(starters) {
  if (!starters.length) return 1;
  return 0.6 + 0.8 * (starters.reduce((a, p) => a + iqOf(p), 0) / starters.length);
}

// Pemahaman efektif 0–100: keakraban × rata-rata pemain inti (kecerdasan, lama di klub).
export function effectiveUnderstanding(familiarity, starters) {
  if (!(familiarity >= 0 && familiarity <= 100)) throw new RangeError(`effectiveUnderstanding: keakraban ${familiarity}`);
  if (!starters.length) return familiarity;
  const f = starters.reduce((a, p) => a + (0.85 + 0.3 * iqOf(p)) * (0.5 + 0.5 * Math.min(1, (p.ten ?? FAMILIARITY.tenureFull) / FAMILIARITY.tenureFull)), 0) / starters.length;
  return Math.min(100, familiarity * f);
}

export function understandingGap(complexity, understanding) {
  const need = requiredUnderstanding(complexity);
  return Math.min(1, Math.max(0, (need - understanding) / need));
}

// ---------------------------------------------------------------- menerapkan template

const tidLeft = (players) => [...players].sort((a, b) => a.slot.lane - b.slot.lane || a.id.localeCompare(b.id));
const byRole = (players, role) => tidLeft(players.filter((p) => p.role === role));

function trioGroups(players, tactics, key) {
  const pool = players.filter((p) => p.role !== 'GK' && p.slot.depth >= 0.28).sort((a, b) => a.slot.lane - b.slot.lane);
  if (pool.length < 3) return [];
  const left = [{ id: `${key}-lk`, zone: 'lawanKiri', memberIds: pool.slice(0, 3).map((p) => p.id) }];
  return mirrorGroups(players, { ...tactics, groups: left }, 'lawanKiri', (i) => `${key}-lka${i}`).groups;
}

// Skema berbasis peran. Titik di bingkai tim (meter; menyerang ke kanan; y kecil = kiri).
const W = 68;
const mirrorY = (pt) => ({ x: pt.x, y: W - pt.y });
function pemainKetiga(players) {
  const cms = byRole(players, 'CM');
  const st = byRole(players, 'ST')[0];
  const lw = byRole(players, 'LW')[0];
  const rw = byRole(players, 'RW')[0];
  if (cms.length < 2 || !st || !lw || !rw) return [];
  const make = (id, name, zone, holder, wing, flip) => {
    const f = flip ? mirrorY : (p) => p;
    return {
      id,
      name,
      zone,
      holderId: holder.id,
      playerIds: [st.id],
      steps: [
        { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: st.id }, { type: 'lari', playerId: wing.id, point: f({ x: 90, y: 8 }) }] },
        { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: wing.id }] },
        { trigger: { type: 'operanDiterima' }, actions: [{ type: 'umpanSilang', point: f({ x: 98, y: 30 }) }] },
      ],
    };
  };
  return [make('tpl-pk-kiri', 'Pemain ketiga · kiri', 'lawanKiri', cms[0], lw, false), make('tpl-pk-kanan', 'Pemain ketiga · kanan', 'lawanKanan', cms[cms.length - 1], rw, true)];
}
function pancing(players) {
  const cbs = byRole(players, 'CB');
  const dms = byRole(players, 'DM');
  const st = byRole(players, 'ST')[0];
  const lw = byRole(players, 'LW')[0];
  const rw = byRole(players, 'RW')[0];
  if (cbs.length < 2 || dms.length < 1 || !st || !lw || !rw) return [];
  const make = (id, name, zone, cb, dm, wing, flip) => {
    const f = flip ? mirrorY : (p) => p;
    return {
      id,
      name,
      zone,
      holderId: cb.id,
      playerIds: [dm.id],
      steps: [
        { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: dm.id }, { type: 'lari', playerId: st.id, point: f({ x: 58, y: 30 }) }] },
        { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: st.id }, { type: 'lari', playerId: wing.id, point: f({ x: 80, y: 10 }) }] },
        { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: wing.id }] },
      ],
    };
  };
  return [make('tpl-pc-kiri', 'Pancingan · kiri', 'sendiriKiri', cbs[0], dms[0], lw, false), make('tpl-pc-kanan', 'Pancingan · kanan', 'sendiriKanan', cbs[cbs.length - 1], dms[dms.length - 1], rw, true)];
}

// Langkah 1: perubahan formasi & instruksi tim (pemain belum perlu diketahui).
export function templateBase(key) {
  const t = getTemplate(key);
  return {
    baseFormation: t.formation,
    ...t.tactics,
    inPossession: { formation: t.formation, width: 'normal', tempo: 'normal', cross: 'normal', focus: 'seimbang', passing: 'campur', ...(t.tactics.inPossession ?? {}) },
    outOfPossession: { formation: t.formation, line: 'normal', press: 'tinggi', protect: 'seimbang', ...(t.tactics.outOfPossession ?? {}) },
    onLoss: t.tactics.onLoss ?? 'seimbang',
    onWin: t.tactics.onWin ?? 'seimbang',
    playerLanes: {},
    customIn: {},
    customOut: {},
    marking: {},
    zoneIn: {},
    zoneOut: {},
    groups: [],
    scripts: [],
  };
}

// Langkah 2: jalur, kelompok, skema — butuh pemain tim SETELAH formasi dasar template terpasang.
export function templateDetails(key, players, tactics) {
  const t = getTemplate(key);
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('templateDetails: pemain kosong');
  const changes = {};
  if (t.lanes) {
    const lanes = {};
    for (const p of players) if (t.lanes[p.role]) lanes[p.id] = t.lanes[p.role];
    changes.playerLanes = lanes;
  }
  if (t.groups === 'trio') changes.groups = trioGroups(players, tactics, key);
  if (t.scripts === 'pemainKetiga') changes.scripts = pemainKetiga(players);
  if (t.scripts === 'pancing') changes.scripts = pancing(players);
  return changes;
}

// Kerumitan template (taktik lengkapnya, tanpa perlu pemain nyata untuk jalur/skema).
export function templateComplexity(key) {
  const t = getTemplate(key);
  const base = templateBase(key);
  const fake = {
    ...base,
    playerLanes: t.lanes ? { x: 'melebar' } : {},
    groups: t.groups ? [{}] : [],
    scripts: t.scripts ? [{}, {}] : [],
  };
  return complexityOf(fake);
}

// ---------------------------------------------------------------- kecocokan skuad

const roleKindOf = (t, role) => t.roleKind?.[role] ?? ROLE_KIND[role] ?? 'CM';
export function needsFor(key, role) {
  const t = getTemplate(key);
  const kind = roleKindOf(t, role);
  const out = { ...BASE_NEEDS[kind] };
  if (kind !== 'GK') for (const [k, w] of Object.entries(t.needs.ALL ?? {})) out[k] = (out[k] ?? 0) + w;
  for (const [k, w] of Object.entries(t.needs[kind] ?? {})) out[k] = (out[k] ?? 0) + w;
  return out;
}

// Posisi asli pemain cocok dengan peran template? (bek sayap ≈ wing-back, gelandang bertahan ≈ tengah)
export function roleCompatible(key, playerRole, slotRole) {
  const kindP = ROLE_KIND[playerRole] ?? 'CM';
  const kindR = roleKindOf(getTemplate(key), slotRole);
  return kindP === kindR || (['FB', 'WB'].includes(kindP) && ['FB', 'WB'].includes(kindR)) || (['DM', 'CM'].includes(kindP) && ['DM', 'CM'].includes(kindR));
}

// Kecocokan satu pemain untuk satu peran template: rata-rata berbobot stat / 20 → 0–1.
// Pemain di luar posisi aslinya (mis. bek di posisi penyerang) dikurangi.
export function playerFit(key, role, player) {
  const needs = needsFor(key, role);
  let sum = 0;
  let w = 0;
  for (const [k, wt] of Object.entries(needs)) {
    sum += (player.stats[k] ?? 8) * wt;
    w += wt;
  }
  const same = roleCompatible(key, player.role, role);
  const gkMismatch = (player.role === 'GK') !== (role === 'GK');
  return (sum / w / 20) * (gkMismatch ? 0.3 : same ? 1 : 0.85);
}

// Susunan terbaik skuad untuk template (serakah: posisi yang paling sulit diisi dulu) + kecocokan.
//   players: pemain yang bisa main (absen sudah disaring pemanggil)
export function squadFit(key, players) {
  const slots = getFormation(getTemplate(key).formation);
  if (players.length < 11) return { fit: 0, slots: [] };
  const pool = new Set(players.map((p) => p.uid ?? p.id));
  const byId = new Map(players.map((p) => [p.uid ?? p.id, p]));
  const scored = slots.map((s) => ({ s, best: Math.max(...players.map((p) => playerFit(key, s.role, p))) }));
  scored.sort((a, b) => a.best - b.best || a.s.number - b.s.number);
  const out = [];
  for (const { s } of scored) {
    let pick = null;
    let pf = -1;
    for (const id of pool) {
      const f = playerFit(key, s.role, byId.get(id));
      if (f > pf || (f === pf && id < pick)) {
        pf = f;
        pick = id;
      }
    }
    pool.delete(pick);
    out.push({ number: s.number, role: s.role, id: pick, fit: pf });
  }
  out.sort((a, b) => a.number - b.number);
  const fit = out.reduce((a, x) => a + x.fit, 0) / out.length;
  return { fit, slots: out };
}

// Template diurutkan menurut kecocokan dengan skuad.
export function rankTemplates(players) {
  return TEMPLATE_KEYS.map((key) => ({ key, fit: squadFit(key, players).fit, complexity: templateComplexity(key) })).sort((a, b) => b.fit - a.fit || a.complexity - b.complexity);
}

// Posisi terlemah untuk template (n terendah) + kandidat (skuad & daftar lain, mis. bursa).
export function weakSpots(key, players, candidates = [], n = 3) {
  const { slots, fit } = squadFit(key, players);
  return slots
    .filter((x) => x.fit < fit)
    .sort((a, b) => a.fit - b.fit)
    .slice(0, n)
    .map((x) => ({
      ...x,
      // Saran hanya dari pemain yang posisi aslinya cocok (bukan bek untuk posisi gelandang).
      better: candidates
        .filter((c) => roleCompatible(key, c.role, x.role))
        .map((c) => ({ c, fit: playerFit(key, x.role, c) }))
        .filter((o) => o.fit > x.fit + 0.02)
        .sort((a, b) => b.fit - a.fit)
        .slice(0, 2),
    }));
}

export function templateErrors() {
  const errors = [];
  for (const key of TEMPLATE_KEYS) {
    const t = TEMPLATES[key];
    if (!t) errors.push(`${key}: tidak ada`);
    else {
      try {
        getFormation(t.formation);
        for (const f of [t.tactics.inPossession?.formation, t.tactics.outOfPossession?.formation]) if (f) getFormation(f);
      } catch (e) {
        errors.push(`${key}: ${e.message}`);
      }
    }
  }
  return errors;
}
