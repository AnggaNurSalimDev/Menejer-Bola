// Rekaman suara penonton (16 Nov): taruh berkas di src/audio/samples/ dengan nama
//   ambience.(mp3|ogg|wav)  — dengung stadion, diputar berulang (sebaiknya ≥ 20 dtk)
//   goal.(mp3|ogg|wav)      — sorak gol (4–10 dtk)
//   ooh.(mp3|ogg|wav)       — "uuuh" peluang gagal (opsional)
// Hanya rekaman berlisensi bebas (CC0 / setara) yang boleh dimasukkan; catat sumbernya di SUMBER.md.
// Tanpa berkas, penonton diam (peluit tetap ada, disintesis).

const found = import.meta.glob('./samples/*.{mp3,ogg,wav}', { eager: true, query: '?url', import: 'default' });

export const SAMPLE_NAMES = Object.freeze(['ambience', 'goal', 'ooh']);

export const sampleUrls = Object.fromEntries(
  SAMPLE_NAMES.map((n) => [n, Object.entries(found).find(([path]) => path.split('/').pop().split('.')[0] === n)?.[1] ?? null]),
);

// data: URI diurai sendiri (tanpa fetch): halaman artifact/itch bisa punya Content-Security-Policy
// yang melarang fetch ke data: — di situ rekaman diam-diam gagal dimuat (bug 16 Nov).
export function dataUriBytes(uri) {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri);
  if (!m) throw new RangeError('dataUriBytes: bukan data URI');
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2])).buffer;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function bytesOf(url) {
  if (url.startsWith('data:')) return dataUriBytes(url);
  return (await fetch(url)).arrayBuffer();
}

// → { ambience: AudioBuffer|null, goal, ooh }. Berkas rusak dilewati (bukan menggagalkan semua).
export async function loadSamples(ctx) {
  if (!ctx || typeof ctx.decodeAudioData !== 'function') throw new TypeError('loadSamples: AudioContext tidak valid');
  const out = {};
  for (const n of SAMPLE_NAMES) {
    const url = sampleUrls[n];
    out[n] = null;
    if (!url) continue;
    try {
      out[n] = await ctx.decodeAudioData(await bytesOf(url));
    } catch (e) {
      out[n] = null;
      if (typeof console !== 'undefined') console.warn(`[suara] rekaman ${n} gagal dimuat:`, e?.message ?? e);
    }
  }
  return out;
}
