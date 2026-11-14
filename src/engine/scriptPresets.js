// Pustaka skema siap pakai untuk "Strategi detil" (15 Nov, masukan pengguna setelah mencoba: membuat
// skema sendiri sama memusingkannya dengan taktik lapis luar bagi pemain baru).
//
//   preset = { kunci, label, ide, tingkat ★1–3, jenis zona (lawan/sendiri), pembangun langkah }
//   buildPreset(kunci, sisi, pemainTim) ──▶ skema biasa (bisa diubah di editor) | { error }
//
// Pemain dipilih menurut PERAN & sisi (jalur slot), jadi skema jalan siapa pun pemainnya. Versi kanan =
// cermin versi kiri (y → 68 − y, peran kiri ⇄ kanan). Titik di bingkai tim: meter, menyerang ke kanan,
// y kecil = sisi kiri.

const W = 68;
const tk = (s) => s; // penanda teks untuk pemeriksa kamus

export const SIDES = Object.freeze(['kiri', 'kanan']);
const SIDE_ROLES = {
  kiri: { wide: ['LW', 'LM', 'LWB'], fb: ['LB', 'LWB'] },
  kanan: { wide: ['RW', 'RM', 'RWB'], fb: ['RB', 'RWB'] },
};
const other = (side) => (side === 'kiri' ? 'kanan' : 'kiri');

function picker(players) {
  const field = players.filter((p) => p.role !== 'GK');
  const byLane = (list, side) => [...list].sort((a, b) => (side === 'kiri' ? a.slot.lane - b.slot.lane : b.slot.lane - a.slot.lane) || a.id.localeCompare(b.id));
  const onSide = (p, side) => (side === 'kiri' ? p.slot.lane <= 0.5 : p.slot.lane >= 0.5);
  return {
    wide: (side) => byLane(field.filter((p) => SIDE_ROLES[side].wide.includes(p.role)), side)[0] ?? null,
    fb: (side) => byLane(field.filter((p) => SIDE_ROLES[side].fb.includes(p.role)), side)[0] ?? null,
    mid: (side) => byLane(field.filter((p) => ['CM', 'AM', 'DM'].includes(p.role) && onSide(p, side)), side)[0] ?? byLane(field.filter((p) => ['CM', 'AM', 'DM'].includes(p.role)), side)[0] ?? null,
    dm: (side) => byLane(field.filter((p) => p.role === 'DM'), side)[0] ?? byLane(field.filter((p) => p.role === 'CM'), side)[0] ?? null,
    cb: (side) => byLane(field.filter((p) => p.role === 'CB'), side)[0] ?? null,
    st: () => [...field.filter((p) => p.role === 'ST')].sort((a, b) => Math.abs(a.slot.lane - 0.5) - Math.abs(b.slot.lane - 0.5) || a.id.localeCompare(b.id))[0] ?? null,
  };
}

// Kebutuhan peran yang tidak ada → pesan untuk UI (kunci teks).
const NEED = {
  wide: tk('pemain sayap di sisi ini (LW/LM atau RW/RM)'),
  wideOpp: tk('pemain sayap di sisi seberang'),
  fb: tk('bek sayap di sisi ini (LB/RB atau wing-back)'),
  mid: tk('gelandang (CM/AM/DM)'),
  dm: tk('gelandang bertahan / tengah'),
  cb: tk('bek tengah'),
  st: tk('penyerang (ST)'),
};

export const PRESETS = Object.freeze({
  satuDua: {
    label: tk('Satu-dua'),
    idea: tk('Gelandang mengoper ke penyerang lalu berlari; penyerang mengembalikan bola ke ruang di depannya. Paling sederhana.'),
    level: 1,
    area: 'lawan',
    build: (pk, side) => {
      const mid = pk.mid(side);
      const st = pk.st();
      if (!mid || !st) return { need: [!mid && 'mid', !st && 'st'] };
      return {
        holder: mid,
        first: st,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: st.id }, { type: 'lari', playerId: mid.id, point: { x: 84, y: 22 } }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: mid.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'giring', point: { x: 93, y: 27 } }] },
        ],
      };
    },
  },
  terobosan: {
    label: tk('Umpan terobosan'),
    idea: tk('Penyerang berlari ke belakang garis bek, satu detik kemudian gelandang mengirim bola ke larinya, lalu menembak.'),
    level: 1,
    area: 'lawan',
    build: (pk, side) => {
      const mid = pk.mid(side);
      const st = pk.st();
      if (!mid || !st) return { need: [!mid && 'mid', !st && 'st'] };
      return {
        holder: mid,
        first: st,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'lari', playerId: st.id, point: { x: 93, y: 30 } }] },
          { trigger: { type: 'waktu', detik: 1 }, actions: [{ type: 'oper', to: st.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'tembak' }] },
        ],
      };
    },
  },
  pindahSisi: {
    label: tk('Pindah sisi'),
    idea: tk('Lawan menumpuk di sisi bola; gelandang mengirim bola jauh ke sayap seberang yang lebih bebas, lalu sayap menggiring ke depan.'),
    level: 1,
    area: 'lawan',
    build: (pk, side) => {
      const mid = pk.mid(side);
      const wide = pk.wide(other(side));
      if (!mid || !wide) return { need: [!mid && 'mid', !wide && 'wideOpp'] };
      return {
        holder: mid,
        first: wide,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: wide.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'giring', point: { x: 90, y: 58 } }] },
        ],
      };
    },
  },
  bangunSayap: {
    label: tk('Keluar lewat bek sayap'),
    idea: tk('Bek tengah membangun serangan: bek sayap turun melebar menjemput bola, lalu meneruskan ke pemain sayap di depannya.'),
    level: 1,
    area: 'sendiri',
    build: (pk, side) => {
      const cb = pk.cb(side);
      const fb = pk.fb(side);
      const wide = pk.wide(side);
      if (!cb || !fb || !wide) return { need: [!cb && 'cb', !fb && 'fb', !wide && 'wide'] };
      return {
        holder: cb,
        first: fb,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'lari', playerId: fb.id, point: { x: 36, y: 5 } }] },
          { trigger: { type: 'waktu', detik: 1 }, actions: [{ type: 'oper', to: fb.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: wide.id }] },
        ],
      };
    },
  },
  overlap: {
    label: tk('Overlap bek sayap'),
    idea: tk('Bek sayap berlari melewati pemain sayap di pinggir, menerima bola, lalu mengirim umpan silang.'),
    level: 2,
    area: 'lawan',
    build: (pk, side) => {
      const wide = pk.wide(side);
      const fb = pk.fb(side);
      if (!wide || !fb) return { need: [!wide && 'wide', !fb && 'fb'] };
      return {
        holder: wide,
        first: fb,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'lari', playerId: fb.id, point: { x: 92, y: 4 } }] },
          { trigger: { type: 'waktu', detik: 1.5 }, actions: [{ type: 'oper', to: fb.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'umpanSilang', point: { x: 98, y: 32 } }] },
        ],
      };
    },
  },
  pemainKetiga: {
    label: tk('Pemain ketiga'),
    idea: tk('Gelandang → penyerang yang turun menjemput → sayap yang sudah berlari di belakang bek → umpan silang. Butuh tiga pemain bergerak serempak.'),
    level: 3,
    area: 'lawan',
    build: (pk, side) => {
      const mid = pk.mid(side);
      const st = pk.st();
      const wide = pk.wide(side);
      if (!mid || !st || !wide) return { need: [!mid && 'mid', !st && 'st', !wide && 'wide'] };
      return {
        holder: mid,
        first: st,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: st.id }, { type: 'lari', playerId: wide.id, point: { x: 90, y: 8 } }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: wide.id }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'umpanSilang', point: { x: 98, y: 30 } }] },
        ],
      };
    },
  },
  pancingan: {
    label: tk('Pancingan dari belakang'),
    idea: tk('Bek tengah memancing tekanan, oper ke gelandang bertahan, penyerang turun menerima operan vertikal, lalu sayap yang berlari menerima bola.'),
    level: 3,
    area: 'sendiri',
    build: (pk, side) => {
      const cb = pk.cb(side);
      const dm = pk.dm(side);
      const st = pk.st();
      const wide = pk.wide(side);
      if (!cb || !dm || !st || !wide) return { need: [!cb && 'cb', !dm && 'dm', !st && 'st', !wide && 'wide'] };
      return {
        holder: cb,
        first: dm,
        steps: [
          { trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: dm.id }, { type: 'lari', playerId: st.id, point: { x: 58, y: 30 } }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: st.id }, { type: 'lari', playerId: wide.id, point: { x: 80, y: 10 } }] },
          { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: wide.id }] },
        ],
      };
    },
  },
});
export const PRESET_KEYS = Object.freeze(Object.keys(PRESETS));
export const presetNeeds = () => Object.values(NEED);

// Hasil uji (15 Nov): 16 laga tim demo vs AI, kedua sisi dipasang. "Selesai" = semua langkah jalan
// tanpa bola hilang — bukan berarti gol. Ditampilkan apa adanya supaya pemain tahu peluangnya.
// (Umpan tarik sempat dicoba: ≤4% dalam 3 percobaan perbaikan, jadi tidak dimasukkan.)
export const PRESET_MEASURED = Object.freeze({ satuDua: 0.24, terobosan: 0.2, pindahSisi: 0.24, bangunSayap: 0.44, overlap: 0.19, pemainKetiga: 0.28, pancingan: 0.04 });

export const zoneFor = (area, side) => `${area === 'lawan' ? 'lawan' : 'sendiri'}${side === 'kiri' ? 'Kiri' : 'Kanan'}`;
export const zoneArea = (zone) => (zone.startsWith('lawan') ? 'lawan' : 'sendiri');
export const zoneSide = (zone) => (zone.endsWith('Kiri') ? 'kiri' : 'kanan');

const mirrorPoint = (p) => ({ x: p.x, y: W - p.y });
function mirrorSteps(steps) {
  return steps.map((st) => ({ ...st, actions: st.actions.map((a) => (a.point ? { ...a, point: mirrorPoint(a.point) } : a)) }));
}

// Skema dari preset untuk satu sisi. players: pemain tim di lapangan (role & slot.lane dari formasi dasar).
//   → { script } atau { error: [kunci kebutuhan…] }
export function buildPreset(key, side, players, { id = null, name = null } = {}) {
  const preset = PRESETS[key];
  if (!preset) throw new RangeError(`buildPreset: preset tidak dikenal "${key}"`);
  if (!SIDES.includes(side)) throw new RangeError(`buildPreset: sisi tidak dikenal "${side}"`);
  if (!Array.isArray(players) || players.length === 0) throw new TypeError('buildPreset: pemain kosong');
  const pk = picker(players);
  const r = preset.build(pk, side);
  if (r.need) return { error: r.need.filter(Boolean).map((k) => NEED[k]) };
  const steps = side === 'kiri' ? r.steps : mirrorSteps(r.steps);
  return {
    script: {
      id: id ?? `pre-${key}-${side}`,
      name: name ?? `${preset.label} · ${side}`,
      zone: zoneFor(preset.area, side),
      holderId: r.holder.id,
      playerIds: [r.first.id],
      steps,
      preset: key,
    },
  };
}

// Id unik di antara skema yang sudah ada.
export function uniqueScriptId(base, scripts) {
  const ids = new Set((scripts ?? []).map((s) => s.id));
  if (!ids.has(base)) return base;
  for (let n = 2; n < 100; n += 1) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error('uniqueScriptId: terlalu banyak skema dengan nama sama');
}
