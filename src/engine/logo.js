// Logo klub (14 Nov, permintaan pengguna: edit logo tim). Data murni + validasi; gambar SVG ada di
// components/ClubLogo.jsx.
//
//   LOGO = { shape, pattern, primary, secondary, text }
//     shape    perisai | bulat | kotak | berlian | bintang
//     pattern  polos | tengah | diagonal | setengah | garis | cincin
//     primary / secondary  warna '#rrggbb'
//     text     1–3 huruf/angka (huruf besar), boleh kosong bila pola sudah cukup

export const LOGO_SHAPES = Object.freeze(['perisai', 'bulat', 'kotak', 'berlian', 'bintang']);
export const LOGO_PATTERNS = Object.freeze(['polos', 'tengah', 'diagonal', 'setengah', 'garis', 'cincin']);
export const LOGO_TEXT_MAX = 3;

const HEX = /^#[0-9a-f]{6}$/i;

export function logoErrors(logo) {
  const e = [];
  if (!logo || typeof logo !== 'object') return ['logo bukan objek'];
  if (!LOGO_SHAPES.includes(logo.shape)) e.push(`bentuk logo tidak dikenal: ${logo.shape}`);
  if (!LOGO_PATTERNS.includes(logo.pattern)) e.push(`pola logo tidak dikenal: ${logo.pattern}`);
  if (!HEX.test(logo.primary ?? '')) e.push('warna utama logo tidak valid');
  if (!HEX.test(logo.secondary ?? '')) e.push('warna kedua logo tidak valid');
  if (typeof logo.text !== 'string' || logo.text.length > LOGO_TEXT_MAX || !/^[A-Z0-9]*$/.test(logo.text)) e.push('teks logo harus 0–3 huruf/angka besar');
  return e;
}

// Bersihkan masukan teks logo: huruf besar, hanya A–Z/0–9, paling banyak 3.
export function cleanLogoText(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, LOGO_TEXT_MAX);
}

// Inisial dari nama klub: huruf pertama tiap kata (maks 3), mis. "Persada Bandung" → "PB".
export function initials(name) {
  const words = String(name ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  return cleanLogoText(words.map((w) => w[0]).join('')) || 'FC';
}

// Logo bawaan klub liga (14 Nov, masukan pengguna: lawan masih tampil warna polos). Warna tetap dari
// jersey klub; preset hanya memilih bentuk, pola, dan (kadang) warna kedua. Klub tanpa preset
// (mis. tim laga persahabatan) mendapat bentuk & pola dari hash namanya — selalu sama untuk nama sama.
const LOGO_PRESETS = Object.freeze({
  persada: { shape: 'perisai', pattern: 'tengah' },
  garuda: { shape: 'perisai', pattern: 'diagonal', secondary: '#ffd43b' },
  bintang: { shape: 'bintang', pattern: 'polos' },
  rajawali: { shape: 'berlian', pattern: 'setengah' },
  benteng: { shape: 'kotak', pattern: 'garis' },
  angin: { shape: 'bulat', pattern: 'diagonal' },
  elang: { shape: 'perisai', pattern: 'cincin', secondary: '#ffd43b' },
  ombak: { shape: 'bulat', pattern: 'garis', secondary: '#ffffff' },
  batu: { shape: 'kotak', pattern: 'tengah', secondary: '#fab005' },
  api: { shape: 'berlian', pattern: 'polos', secondary: '#ffd43b' },
});

function hashText(text) {
  let h = 2166136261;
  for (const ch of String(text ?? '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export function defaultLogo(club) {
  const primary = HEX.test(club?.colors?.shirt ?? '') ? club.colors.shirt.toLowerCase() : '#1f4fbf';
  const number = HEX.test(club?.colors?.number ?? '') ? club.colors.number.toLowerCase() : '#ffffff';
  const h = hashText(club?.name);
  const preset = LOGO_PRESETS[club?.id] ?? { shape: LOGO_SHAPES[h % LOGO_SHAPES.length], pattern: LOGO_PATTERNS[1 + ((h >>> 8) % (LOGO_PATTERNS.length - 1))] };
  const logo = { shape: preset.shape, pattern: preset.pattern, primary, secondary: (preset.secondary ?? number).toLowerCase(), text: initials(club?.name) };
  const e = logoErrors(logo);
  if (e.length) throw new Error(`defaultLogo: ${e[0]}`);
  return logo;
}

// Warna teks/nomor yang terbaca di atas warna dasar (hitam atau putih, dari kecerahan relatif).
export function contrastColor(hex) {
  if (!HEX.test(hex ?? '')) throw new RangeError(`contrastColor: warna tidak valid ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.45 ? '#111111' : '#ffffff';
}
