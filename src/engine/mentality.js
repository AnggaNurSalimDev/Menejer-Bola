// Mentalitas tim (29 Okt, bagian awal layer manajer).
//
// Filosofi = gaya bermain (siapa pemainnya, tempo). Mentalitas = SIKAP saat ini:
//   bertahan  : blok mundur & rapat (hanya saat lawan memegang bola), hanya menekan di separuh sendiri, jarang berlari ke
//               belakang garis bek → lawan dibiarkan memegang bola di separuhnya
//   seimbang  : seperti sebelumnya
//   menyerang : blok maju, menekan di mana saja, lebih sering berlari ke belakang garis bek
//
// AI pelatih (coachMentality): tim yang kalah jumlah pemain otomatis bertahan — di dunia
// nyata turunnya penguasaan bola tim 10 orang sebagian besar adalah PILIHAN pelatih, bukan
// semata kalah fisik. Kalau tertinggal di menit akhir, ia kembali seimbang untuk mengejar.
// Nanti di layer manajer, pengguna bisa mengubahnya sendiri.

import { PITCH, distance } from './pitch.js';

export const MENTALITIES = Object.freeze({
  bertahan: Object.freeze({
    label: 'Bertahan',
    blockShift: -3, // meter: blok mundur ke arah gawang sendiri (saat lawan memegang bola)
    compact: 0.78, // pengali lebar saat bertahan (rapat di tengah)
    pressZone: 1, // pengali zona tekan (1 = menekan di mana saja)
    // Uji pemisahan 29 Okt (100 laga): bentuk saja → kebobolan 0,70 (kontrol 0,98); bentuk + main
    // langsung + jarang berlari → 1,05. Tim yang mundur lalu buru-buru melepas bola terus diserang
    // lagi. Jadi "bertahan" = BENTUK (mundur, rapat, menutup tembakan dari jauh), cara main normal.
    runScale: 1,
    directness: 1,
    tempo: 1,
    energyDrain: 0.92, // lebih sedikit berlari
    coverRange: 36, // meter dari gawang sendiri: mulai menutup jalur tembak (roles.js pickCover)
  }),
  seimbang: Object.freeze({
    label: 'Seimbang',
    blockShift: 0,
    compact: 1,
    pressZone: 1,
    runScale: 1,
    directness: 1,
    tempo: 1,
    energyDrain: 1,
    coverRange: 0, // tanpa penutup tembakan (kalibrasi 29 Okt: semua tim menutup → 0–0 16%)
  }),
  menyerang: Object.freeze({
    label: 'Menyerang',
    // Uji 29 Okt: blok maju juga saat bertahan membuat "menyerang" lebih tajam SEKALIGUS lebih aman
    // (kebobolan 0,63 vs 0,83). Kini maju hanya saat menguasai bola, dan lebih menguras tenaga.
    blockShift: 6,
    attackOnly: true,
    compact: 1,
    pressZone: 1,
    runScale: 1.4,
    directness: 1.15,
    tempo: 0.95,
    energyDrain: 1.2,
    coverRange: 0,
  }),
});

export const COACH = Object.freeze({
  chaseMinute: 75, // tertinggal di menit ini atau lebih → tidak lagi bertahan
});

export function getMentality(key) {
  const m = MENTALITIES[key];
  if (!m) throw new RangeError(`Mentalitas "${key}" tidak dikenal. Pilihan: ${Object.keys(MENTALITIES).join(', ')}`);
  return m;
}

// Keputusan AI pelatih untuk satu tim. Murni.
//   ctx: { own, opponents (jumlah pemain), goalsFor, goalsAgainst, minute, base }
export function coachMentality({ own, opponents, goalsFor, goalsAgainst, minute, base = 'seimbang' }) {
  if (!(own > 0 && opponents > 0)) throw new RangeError('coachMentality: jumlah pemain tidak valid');
  if (own < opponents) {
    const chasing = goalsFor < goalsAgainst && minute >= COACH.chaseMinute;
    return chasing ? 'seimbang' : 'bertahan';
  }
  return base;
}

// Boleh menekan pemegang bola di posisi ini? (mentalitas bertahan tidak menekan tinggi)
export function pressAllowed(mentality, holder, defendingAttacksRight) {
  const m = getMentality(mentality);
  if (m.pressZone >= 1) return true;
  const ownGoal = {
    x: defendingAttacksRight ? 0 : PITCH.length,
    y: PITCH.width / 2,
  };
  const depth = Math.abs(holder.x - ownGoal.x);
  return depth <= m.pressZone * PITCH.length || distance(holder, ownGoal) <= m.pressZone * PITCH.length;
}

export function validateMentality(key) {
  return MENTALITIES[key] ? [] : [`mentalitas tidak dikenal: ${key}`];
}
