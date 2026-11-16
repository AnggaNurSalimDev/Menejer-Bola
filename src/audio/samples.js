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

// → { ambience: AudioBuffer|null, goal, ooh }. Berkas rusak dilewati (bukan menggagalkan semua).
export async function loadSamples(ctx) {
  if (!ctx || typeof ctx.decodeAudioData !== 'function') throw new TypeError('loadSamples: AudioContext tidak valid');
  const out = {};
  for (const n of SAMPLE_NAMES) {
    const url = sampleUrls[n];
    out[n] = null;
    if (!url) continue;
    try {
      const buf = await (await fetch(url)).arrayBuffer();
      out[n] = await ctx.decodeAudioData(buf);
    } catch {
      out[n] = null;
    }
  }
  return out;
}
