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

export function defaultLogo(club) {
  const primary = HEX.test(club?.colors?.shirt ?? '') ? club.colors.shirt.toLowerCase() : '#1f4fbf';
  const secondary = HEX.test(club?.colors?.number ?? '') ? club.colors.number.toLowerCase() : '#ffffff';
  const logo = { shape: 'perisai', pattern: 'tengah', primary, secondary, text: initials(club?.name) };
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
