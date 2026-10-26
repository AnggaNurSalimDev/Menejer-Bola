// Formasi ditulis dari sudut pandang tim yang menyerang ke kanan.
//
// depth: 0 = garis gawang sendiri, 1 = garis gawang lawan
// lane:  0 = garis samping atas, 1 = garis samping bawah
//
// Ini adalah posisi saat kick-off, jadi semua slot berada di separuh
// lapangan sendiri (depth < 0.5). Di tahap 2, posisi ini menjadi
// "jangkar" yang bergeser mengikuti bola.

export const FORMATIONS = Object.freeze({
  '4-4-2': [
    { role: 'GK', number: 1, depth: 0.04, lane: 0.5 },
    { role: 'RB', number: 2, depth: 0.2, lane: 0.85 },
    { role: 'CB', number: 4, depth: 0.17, lane: 0.62 },
    { role: 'CB', number: 5, depth: 0.17, lane: 0.38 },
    { role: 'LB', number: 3, depth: 0.2, lane: 0.15 },
    { role: 'RM', number: 7, depth: 0.33, lane: 0.85 },
    { role: 'CM', number: 8, depth: 0.31, lane: 0.6 },
    { role: 'CM', number: 6, depth: 0.31, lane: 0.4 },
    { role: 'LM', number: 11, depth: 0.33, lane: 0.15 },
    { role: 'ST', number: 9, depth: 0.45, lane: 0.6 },
    { role: 'ST', number: 10, depth: 0.45, lane: 0.4 },
  ],
  '4-3-3': [
    { role: 'GK', number: 1, depth: 0.04, lane: 0.5 },
    { role: 'RB', number: 2, depth: 0.2, lane: 0.85 },
    { role: 'CB', number: 4, depth: 0.17, lane: 0.62 },
    { role: 'CB', number: 5, depth: 0.17, lane: 0.38 },
    { role: 'LB', number: 3, depth: 0.2, lane: 0.15 },
    { role: 'DM', number: 6, depth: 0.28, lane: 0.5 },
    { role: 'CM', number: 8, depth: 0.34, lane: 0.68 },
    { role: 'CM', number: 10, depth: 0.34, lane: 0.32 },
    { role: 'RW', number: 7, depth: 0.44, lane: 0.82 },
    { role: 'ST', number: 9, depth: 0.47, lane: 0.5 },
    { role: 'LW', number: 11, depth: 0.44, lane: 0.18 },
  ],
});

export function getFormation(name) {
  const formation = FORMATIONS[name];
  if (!formation) {
    throw new RangeError(
      `Formasi "${name}" tidak dikenal. Pilihan: ${Object.keys(FORMATIONS).join(', ')}`,
    );
  }
  return formation;
}

// Invariant setiap formasi: 11 slot, tepat 1 kiper, nomor unik,
// dan semua koordinat relatif berada di rentang 0–1.
export function validateFormation(name) {
  const errors = [];
  const formation = FORMATIONS[name];
  if (!formation) return [`formasi "${name}" tidak ada`];

  if (formation.length !== 11) errors.push(`${name}: jumlah slot ${formation.length}, harus 11`);

  const keepers = formation.filter((slot) => slot.role === 'GK').length;
  if (keepers !== 1) errors.push(`${name}: jumlah kiper ${keepers}, harus 1`);

  const numbers = formation.map((slot) => slot.number);
  if (new Set(numbers).size !== numbers.length) errors.push(`${name}: nomor punggung ganda`);

  for (const slot of formation) {
    if (!(slot.depth >= 0 && slot.depth <= 1) || !(slot.lane >= 0 && slot.lane <= 1)) {
      errors.push(`${name}: slot ${slot.role} #${slot.number} di luar rentang 0–1`);
    }
  }

  return errors;
}
