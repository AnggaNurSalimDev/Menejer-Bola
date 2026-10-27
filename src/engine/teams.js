// Pembuat tim fiktif. Semua nama pemain dan klub karangan,
// sesuai batasan di docs/dokumen-arah-game.md bagian 2.

import { createRng } from './rng.js';
import { getFormation } from './formations.js';
import {
  TECHNICAL_STATS,
  GOALKEEPER_STATS,
  PSYCHOLOGICAL_STATS,
  STAT_MIN,
  STAT_MAX,
  clampStat,
} from './stats.js';

const FIRST_NAMES = [
  'Adi', 'Bayu', 'Cahyo', 'Dimas', 'Eko', 'Fajar', 'Galih', 'Hendra', 'Irfan', 'Joko',
  'Krisna', 'Lutfi', 'Mahesa', 'Nanda', 'Oki', 'Panji', 'Raka', 'Satria', 'Teguh', 'Umar',
  'Wahyu', 'Yoga', 'Zaki', 'Arif', 'Bima', 'Danu', 'Gilang', 'Ilham', 'Rizal', 'Yusuf',
];

const LAST_NAMES = [
  'Saputra', 'Pratama', 'Wibowo', 'Nugroho', 'Santoso', 'Hidayat', 'Kurniawan', 'Setiawan',
  'Permana', 'Gunawan', 'Ramadhan', 'Siregar', 'Lubis', 'Hutapea', 'Simatupang', 'Wijaya',
  'Purnomo', 'Firmansyah', 'Maulana', 'Sembiring', 'Tanjung', 'Rahman', 'Utomo', 'Halim',
  'Sitompul', 'Nasution', 'Prasetyo', 'Susanto', 'Hakim', 'Fauzi', 'Syahputra', 'Iskandar',
  'Pangaribuan', 'Wirawan', 'Suryadi', 'Ardiansyah', 'Matondang', 'Batubara', 'Kusuma', 'Darmawan',
];

// Kecenderungan stat per peran, ditambahkan ke kualitas dasar tim.
const ROLE_BIAS = {
  GK: { posisi: 2, antisipasi: 2, ketenangan: 1 },
  CB: { tackling: 3, kekuatan: 3, posisi: 2, dribbling: -2, finishing: -3 },
  RB: { kecepatan: 2, stamina: 2, tackling: 1 },
  LB: { kecepatan: 2, stamina: 2, tackling: 1 },
  DM: { tackling: 2, posisi: 2, passing: 1, finishing: -2 },
  CM: { passing: 2, visi: 2, stamina: 1 },
  RM: { kecepatan: 2, dribbling: 2, stamina: 1 },
  LM: { kecepatan: 2, dribbling: 2, stamina: 1 },
  RW: { kecepatan: 3, dribbling: 3, tackling: -2 },
  LW: { kecepatan: 3, dribbling: 3, tackling: -2 },
  ST: { finishing: 3, kekuatan: 1, tackling: -3, egoisme: 2 },
};

function generateStats(rng, quality, role) {
  const bias = ROLE_BIAS[role] ?? {};
  const keys = [
    ...TECHNICAL_STATS,
    ...PSYCHOLOGICAL_STATS,
    ...(role === 'GK' ? GOALKEEPER_STATS : []),
  ];

  const stats = {};
  for (const key of keys) {
    stats[key] = clampStat(quality + (bias[key] ?? 0) + rng.range(-3, 3));
  }
  return stats;
}

// Nama punggung (nama belakang) harus unik di seluruh pertandingan,
// supaya setiap jersey di lapangan bisa dibedakan dari namanya.
function generateUniqueName(rng, usedShortNames) {
  const available = LAST_NAMES.filter((last) => !usedShortNames.has(last));
  if (available.length === 0) {
    throw new Error('generateUniqueName: nama belakang habis, tambah daftar LAST_NAMES');
  }
  const last = rng.pick(available);
  const first = rng.pick(FIRST_NAMES);
  usedShortNames.add(last);
  return { fullName: `${first} ${last}`, shortName: last };
}

export function createTeam({
  id,
  name,
  colors,
  formation,
  quality,
  seed,
  usedShortNames = new Set(),
}) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('createTeam: id wajib diisi');
  if (typeof name !== 'string' || name.length === 0) throw new TypeError('createTeam: name wajib diisi');
  if (!colors || typeof colors.shirt !== 'string' || typeof colors.number !== 'string') {
    throw new TypeError('createTeam: colors.shirt dan colors.number wajib diisi');
  }
  if (!Number.isFinite(quality) || quality < STAT_MIN || quality > STAT_MAX) {
    throw new RangeError(`createTeam: quality harus ${STAT_MIN}–${STAT_MAX}, dapat ${quality}`);
  }

  const slots = getFormation(formation);
  const rng = createRng(seed);

  const players = slots.map((slot) => {
    const { fullName, shortName } = generateUniqueName(rng, usedShortNames);
    return {
      id: `${id}-${slot.number}`,
      number: slot.number,
      role: slot.role,
      fullName,
      shortName,
      stats: generateStats(rng, quality, slot.role),
    };
  });

  return { id, name, colors, formation, players };
}

// Dua tim contoh untuk tahap awal. Kualitas (1–20) bisa diatur untuk
// menguji apakah tim yang lebih bagus memang lebih sering menang.
export function createDemoTeams(seed = 2026, { homeQuality = 12, awayQuality = 12 } = {}) {
  const usedShortNames = new Set();

  const home = createTeam({
    usedShortNames,
    id: 'home',
    name: 'Persada Bandung',
    colors: { shirt: '#1f4fbf', number: '#ffffff', goalkeeper: '#2f9e44' },
    formation: '4-4-2',
    quality: homeQuality,
    seed,
  });

  const away = createTeam({
    usedShortNames,
    id: 'away',
    name: 'Garuda Merah',
    colors: { shirt: '#c92a2a', number: '#ffffff', goalkeeper: '#f08c00' },
    formation: '4-3-3',
    quality: awayQuality,
    seed: seed + 1,
  });

  return { home, away };
}
