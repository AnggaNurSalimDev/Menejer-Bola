// Klub karangan untuk 3 kasta (15 Nov, keputusan pengguna: 3 kasta × 20 klub seperti Liga Inggris,
// semua nama karangan). Kualitas = rata-rata stat dasar (1–20); gaya dari clubStyles.js.
//
//   Liga 1: 10 klub lama + 10 klub baru, kualitas 10–15
//   Liga 2: 20 klub, kualitas 9–12
//   Liga 3: 20 klub, kualitas 7–10
//   Tamu (tidak disimpan, dibuat dari seed saat dibutuhkan):
//     12 klub luar negeri untuk Kejuaraan Elite (kualitas 13–16), 4 klub amatir untuk Piala Nasional (6–7)

export const USER_CLUB = 'persada';
export const TIERS = Object.freeze([1, 2, 3]);
export const CLUBS_PER_TIER = 20;

const STYLES = ['seimbang', 'penguasaan', 'pressing', 'seranganBalik', 'bertahan', 'sayap'];
const SHIRTS = ['#1f4fbf', '#c92a2a', '#0b7285', '#5f3dc4', '#495057', '#f59f00', '#2b8a3e', '#74c0fc', '#212529', '#e8590c', '#a61e4d', '#087f5b', '#364fc7', '#862e9c', '#d9480f', '#f1f3f5', '#5c940d', '#1864ab', '#e64980', '#fab005'];
const KEEPERS = ['#2f9e44', '#f08c00', '#e67700', '#1c7ed6', '#c2255c', '#e03131', '#fab005', '#1971c2'];

const contrast = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1b1b1b' : '#ffffff';
};

// 10 klub awal (data lama; id tetap supaya simpanan v3 bisa dimigrasi).
const ORIGINAL = [
  { id: USER_CLUB, name: 'Persada Bandung', colors: { shirt: '#1f4fbf', number: '#ffffff', goalkeeper: '#2f9e44' }, style: 'seimbang', quality: 12 },
  { id: 'garuda', name: 'Garuda Merah', colors: { shirt: '#c92a2a', number: '#ffffff', goalkeeper: '#f08c00' }, style: 'penguasaan', quality: 13 },
  { id: 'bintang', name: 'Bintang Samudra', colors: { shirt: '#0b7285', number: '#ffffff', goalkeeper: '#e67700' }, style: 'pressing', quality: 14 },
  { id: 'rajawali', name: 'Rajawali Timur', colors: { shirt: '#5f3dc4', number: '#ffffff', goalkeeper: '#2b8a3e' }, style: 'seranganBalik', quality: 12 },
  { id: 'benteng', name: 'Benteng Kota', colors: { shirt: '#495057', number: '#ffd43b', goalkeeper: '#e8590c' }, style: 'bertahan', quality: 11 },
  { id: 'angin', name: 'Angin Selatan', colors: { shirt: '#f59f00', number: '#212529', goalkeeper: '#1c7ed6' }, style: 'sayap', quality: 12 },
  { id: 'elang', name: 'Elang Utara', colors: { shirt: '#2b8a3e', number: '#ffffff', goalkeeper: '#c2255c' }, style: 'seimbang', quality: 13 },
  { id: 'ombak', name: 'Ombak Biru', colors: { shirt: '#74c0fc', number: '#1b1b1b', goalkeeper: '#e03131' }, style: 'sayap', quality: 10 },
  { id: 'batu', name: 'Batu Hitam', colors: { shirt: '#212529', number: '#ffffff', goalkeeper: '#fab005' }, style: 'bertahan', quality: 10 },
  { id: 'api', name: 'Api Nusantara', colors: { shirt: '#e8590c', number: '#ffffff', goalkeeper: '#1971c2' }, style: 'pressing', quality: 11 },
];

// 50 klub baru: [id, nama, kasta, kualitas]. Kualitas disebar supaya tiap kasta punya papan atas,
// tengah, dan calon degradasi.
const NEW = [
  // Liga 1 (10)
  ['harimau-medan', 'Harimau Medan', 1, 15],
  ['naga-surabaya', 'Naga Surabaya', 1, 15],
  ['badai-makassar', 'Badai Makassar', 1, 14],
  ['laskar-semarang', 'Laskar Semarang', 1, 13],
  ['banteng-malang', 'Banteng Malang', 1, 13],
  ['persatuan-palembang', 'Persatuan Palembang', 1, 12],
  ['komodo-denpasar', 'Komodo Denpasar', 1, 12],
  ['putra-yogyakarta', 'Putra Yogyakarta', 1, 11],
  ['cendrawasih-jayapura', 'Cendrawasih Jayapura', 1, 11],
  ['karang-manado', 'Karang Manado', 1, 10],
  // Liga 2 (20)
  ['badak-pontianak', 'Badak Pontianak', 2, 12],
  ['petir-padang', 'Petir Padang', 2, 12],
  ['laskar-solo', 'Laskar Solo', 2, 12],
  ['harimau-bogor', 'Harimau Bogor', 2, 11],
  ['persatuan-balikpapan', 'Persatuan Balikpapan', 2, 11],
  ['naga-samarinda', 'Naga Samarinda', 2, 11],
  ['merpati-cirebon', 'Merpati Cirebon', 2, 11],
  ['banteng-banjarmasin', 'Banteng Banjarmasin', 2, 10],
  ['putra-pekanbaru', 'Putra Pekanbaru', 2, 10],
  ['gunung-lampung', 'Gunung Lampung', 2, 10],
  ['buaya-jambi', 'Buaya Jambi', 2, 10],
  ['karang-ambon', 'Karang Ambon', 2, 10],
  ['badai-kupang', 'Badai Kupang', 2, 10],
  ['kancil-tasikmalaya', 'Kancil Tasikmalaya', 2, 10],
  ['laskar-mataram', 'Laskar Mataram', 2, 9],
  ['persatuan-kendari', 'Persatuan Kendari', 2, 9],
  ['petir-palu', 'Petir Palu', 2, 9],
  ['merpati-batam', 'Merpati Batam', 2, 9],
  ['naga-serang', 'Naga Serang', 2, 9],
  ['gunung-bengkulu', 'Gunung Bengkulu', 2, 9],
  // Liga 3 (20)
  ['putra-kediri', 'Putra Kediri', 3, 10],
  ['harimau-jember', 'Harimau Jember', 3, 10],
  ['banteng-tegal', 'Banteng Tegal', 3, 10],
  ['laskar-ternate', 'Laskar Ternate', 3, 9],
  ['badak-madiun', 'Badak Madiun', 3, 9],
  ['merpati-garut', 'Merpati Garut', 3, 9],
  ['karang-bangka', 'Karang Bangka', 3, 9],
  ['persatuan-sukabumi', 'Persatuan Sukabumi', 3, 9],
  ['petir-purwokerto', 'Petir Purwokerto', 3, 8],
  ['buaya-gorontalo', 'Buaya Gorontalo', 3, 8],
  ['kancil-magelang', 'Kancil Magelang', 3, 8],
  ['gunung-blitar', 'Gunung Blitar', 3, 8],
  ['badai-sorong', 'Badai Sorong', 3, 8],
  ['naga-probolinggo', 'Naga Probolinggo', 3, 8],
  ['putra-bima', 'Putra Bima', 3, 8],
  ['laskar-merauke', 'Laskar Merauke', 3, 7],
  ['harimau-sumbawa', 'Harimau Sumbawa', 3, 7],
  ['merpati-cilacap', 'Merpati Cilacap', 3, 7],
  ['banteng-pati', 'Banteng Pati', 3, 7],
  ['karang-kudus', 'Karang Kudus', 3, 7],
];

function newDef([id, name, tier, quality], i) {
  const shirt = SHIRTS[(i * 7) % SHIRTS.length];
  return { id, name, tier, quality, style: STYLES[(i * 5 + tier) % STYLES.length], colors: { shirt, number: contrast(shirt), goalkeeper: KEEPERS[i % KEEPERS.length] } };
}

export const CLUB_DEFS = Object.freeze([...ORIGINAL.map((d) => ({ ...d, tier: 1 })), ...NEW.map(newDef)].map((d) => Object.freeze(d)));

// Klub tamu: tidak masuk liga, tidak disimpan. Kejuaraan Elite & Piala Nasional (babak 64).
const FOREIGN = [
  ['real-montebello', 'Real Montebello', 16],
  ['sporting-lusano', 'Sporting Lusano', 15],
  ['dinamo-varka', 'Dinamo Varka', 15],
  ['atletico-serrano', 'Atlético Serrano', 15],
  ['fk-nordhavn', 'FK Nordhavn', 14],
  ['olympique-tarnac', 'Olympique Tarnac', 14],
  ['inter-valdoria', 'Inter Valdoria', 14],
  ['ac-castelmare', 'AC Castelmare', 14],
  ['union-brevik', 'Union Brevik', 13],
  ['racing-aldera', 'Racing Aldera', 13],
  ['hapoel-merin', 'Hapoel Merin', 13],
  ['kesir-spor', 'Kesir Spor', 13],
];
const AMATEUR = [
  ['tunas-pesisir', 'Tunas Pesisir', 7],
  ['porda-cianjur', 'Porda Cianjur', 6],
  ['ps-sukamaju', 'PS Sukamaju', 6],
  ['bintang-kampung', 'Bintang Kampung', 6],
];
export const GUEST_DEFS = Object.freeze(
  [...FOREIGN.map((x) => [...x, 'luar']), ...AMATEUR.map((x) => [...x, 'amatir'])].map(([id, name, quality, kind], i) => {
    const shirt = SHIRTS[(i * 3 + 5) % SHIRTS.length];
    return Object.freeze({ id, name, quality, kind, tier: 0, style: STYLES[(i * 2 + 1) % STYLES.length], colors: { shirt, number: contrast(shirt), goalkeeper: KEEPERS[(i + 3) % KEEPERS.length] } });
  }),
);
export const FOREIGN_IDS = Object.freeze(GUEST_DEFS.filter((d) => d.kind === 'luar').map((d) => d.id));
export const AMATEUR_IDS = Object.freeze(GUEST_DEFS.filter((d) => d.kind === 'amatir').map((d) => d.id));
export const isGuestId = (id) => GUEST_DEFS.some((d) => d.id === id);

// Pemeriksaan data sekali saat modul dimuat (data karangan diketik tangan).
(function checkDefs() {
  const ids = [...CLUB_DEFS, ...GUEST_DEFS].map((d) => d.id);
  if (new Set(ids).size !== ids.length) throw new Error('clubs.js: id klub ganda');
  const names = [...CLUB_DEFS, ...GUEST_DEFS].map((d) => d.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('clubs.js: nama klub ganda');
  for (const tier of TIERS) {
    const n = CLUB_DEFS.filter((d) => d.tier === tier).length;
    if (n !== CLUBS_PER_TIER) throw new Error(`clubs.js: Liga ${tier} punya ${n} klub, harus ${CLUBS_PER_TIER}`);
  }
  for (const d of [...CLUB_DEFS, ...GUEST_DEFS]) {
    if (!STYLES.includes(d.style)) throw new Error(`clubs.js: gaya ${d.style} tidak dikenal`);
    if (!(d.quality >= 5 && d.quality <= 17)) throw new Error(`clubs.js: kualitas ${d.id} di luar 5–17`);
    if (d.name.length > 28) throw new Error(`clubs.js: nama ${d.name} terlalu panjang`);
  }
})();
