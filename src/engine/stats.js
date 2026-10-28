// Daftar statistik pemain, sesuai docs/dokumen-arah-game.md bagian 5.
// Skala semua stat: 1–20.

export const STAT_MIN = 1;
export const STAT_MAX = 20;

export const TECHNICAL_STATS = Object.freeze([
  // Fisik
  'kecepatan',
  'akselerasi',
  'kelincahan',
  'stamina',
  'kekuatan',
  'duelUdara', // menang bola udara & ketepatan sundulan (ditambahkan 28 Okt)
  // Olah bola
  'passing',
  'kontrol',
  'dribbling',
  'finishing',
  'tackling',
  // Membaca permainan
  'visi',
  'keputusan',
  'posisi',
  'antisipasi',
]);

export const GOALKEEPER_STATS = Object.freeze(['refleks', 'penempatan', 'tangkapan']);

export const PSYCHOLOGICAL_STATS = Object.freeze([
  'ketenangan',
  'stabilitasMental',
  'konsistensi',
  'temperamen',
  'determinasi',
  'egoisme',
  'instingGol', // dorongan menembak yang naik makin dekat gawang lawan (ditambahkan 28 Okt)
]);

export function clampStat(value) {
  if (!Number.isFinite(value)) throw new TypeError(`clampStat: nilai tidak valid ${value}`);
  return Math.min(STAT_MAX, Math.max(STAT_MIN, Math.round(value)));
}

// Mengembalikan daftar pesan kesalahan. Daftar kosong berarti valid.
export function validateStats(stats, isGoalkeeper) {
  const errors = [];
  if (stats === null || typeof stats !== 'object') {
    return ['stats bukan objek'];
  }

  const required = [
    ...TECHNICAL_STATS,
    ...PSYCHOLOGICAL_STATS,
    ...(isGoalkeeper ? GOALKEEPER_STATS : []),
  ];

  for (const key of required) {
    const value = stats[key];
    if (!Number.isInteger(value)) {
      errors.push(`stat "${key}" tidak ada atau bukan bilangan bulat`);
    } else if (value < STAT_MIN || value > STAT_MAX) {
      errors.push(`stat "${key}" = ${value} di luar rentang ${STAT_MIN}–${STAT_MAX}`);
    }
  }

  return errors;
}
