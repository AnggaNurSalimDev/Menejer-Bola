// Filosofi pelatih (28 Okt): identitas gaya bermain sebuah tim.
//
// Filosofi TIDAK membuat tim lebih kuat. Ia memindahkan kekuatan:
// (Uji 28 Okt, 64 laga: menggeser stat "otak" — Passing, Keputusan, Visi — membuat
//  satu gaya jauh lebih unggul, jadi geseran dibatasi ke stat fisik, duel, dan olah bola.)
//   statBias       : geser stat setiap pemain; jumlahnya harus NOL (kelebihan dibayar kekurangan)
//   tempo          : pengali lama menahan bola sebelum mengoper (< 1 = lebih cepat melepas)
//   crossPreference: peluang memilih umpan silang saat ada sasaran di kotak
//
// Nanti, di layer manajer, filosofi inilah yang dipilih/diubah pelatih.

export const PHILOSOPHIES = Object.freeze({
  seimbang: Object.freeze({
    label: 'Seimbang',
    statBias: Object.freeze({}),
    tempo: 1,
    crossPreference: 0.5,
  }),
  cepat: Object.freeze({
    label: 'Cepat & mengalir',
    // Lari kencang dan operan tajam, tetapi kalah fisik dan di udara.
    statBias: Object.freeze({
      kecepatan: 1,
      akselerasi: 1,
      kekuatan: -1,
      duelUdara: -1,
    }),
    tempo: 0.6,
    crossPreference: 0.3,
  }),
  fisik: Object.freeze({
    label: 'Fisik & bola udara',
    // Kuat, jago udara, tahan lama, tetapi kurang lincah dan kurang halus mengolah bola.
    statBias: Object.freeze({
      kekuatan: 1,
      duelUdara: 2,
      stamina: 1,
      kelincahan: -1,
      dribbling: -1,
      finishing: -1,
      kontrol: -1,
    }),
    tempo: 1.3,
    crossPreference: 0.75,
  }),
});

export const TEMPO_RANGE = Object.freeze({ min: 0.5, max: 1.5 });

export function getPhilosophy(key) {
  const p = PHILOSOPHIES[key];
  if (!p) throw new RangeError(`getPhilosophy: filosofi tidak dikenal "${key}"`);
  return p;
}

// Invariant: filosofi hanya memindahkan kekuatan, tidak menambahnya.
export function validatePhilosophy(key) {
  const p = PHILOSOPHIES[key];
  if (!p) return [`filosofi tidak dikenal "${key}"`];
  const errors = [];
  const total = Object.values(p.statBias).reduce((sum, v) => sum + v, 0);
  if (total !== 0) errors.push(`${key}: jumlah geseran stat harus 0, dapat ${total}`);
  if (!(p.tempo >= TEMPO_RANGE.min && p.tempo <= TEMPO_RANGE.max)) errors.push(`${key}: tempo di luar rentang`);
  if (!(p.crossPreference >= 0 && p.crossPreference <= 1)) errors.push(`${key}: crossPreference di luar 0–1`);
  return errors;
}
