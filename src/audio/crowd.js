// Suara stadion (16 Nov, revisi setelah masukan pengguna: peluit terdengar seperti klakson, penonton
// sintesis terdengar mengganggu).
//
//   peluit  : disintesis ulang meniru peluit wasit berbola (pea whistle). Klakson = dua nada tetap
//             yang dibunyikan bersamaan; peluit = SATU nada ±3,2 kHz yang bergetar cepat naik-turun
//             (bola kecil di dalamnya memotong aliran udara ±25×/dtk) + desis napas.
//   penonton: hanya dari REKAMAN (samples.js). Tanpa rekaman: diam. Derau sintesis tidak dipakai lagi.
//
//   createCrowd(ctx, out, samples)
//     setActive(on) · setVolume(v) · setExcitement(0–1) · celebrate(s) · ooh() · groan() · applause()
//     whistle('short' | 'long')

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Satu tiupan peluit mulai di t selama dur detik.
export function whistleBlow(ctx, out, t, dur, { level = 0.22 } = {}) {
  if (!(dur > 0.05)) throw new RangeError(`whistleBlow: durasi ${dur}`);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(level, t + 0.012);
  env.gain.setValueAtTime(level, t + dur - 0.07);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  env.connect(out);

  // Nada pokok: naik cepat ke ±3,2 kHz saat tiupan mulai, lalu bergetar (FM) oleh "bola" peluit.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2700, t);
  osc.frequency.exponentialRampToValueAtTime(3200, t + 0.045);
  const rattle = ctx.createOscillator();
  rattle.type = 'sine';
  rattle.frequency.setValueAtTime(23, t);
  rattle.frequency.linearRampToValueAtTime(27, t + dur);
  const rattleDepth = ctx.createGain();
  rattleDepth.gain.value = 260;
  rattle.connect(rattleDepth).connect(osc.frequency);
  // Getar yang sama sedikit mengubah kekerasan (tiupan tidak rata).
  const trem = ctx.createGain();
  trem.gain.value = 0.75;
  const tremDepth = ctx.createGain();
  tremDepth.gain.value = 0.25;
  rattle.connect(tremDepth).connect(trem.gain);
  osc.connect(trem).connect(env);

  // Harmonik kedua tipis (peluit logam tidak murni sinus).
  const h2 = ctx.createOscillator();
  h2.type = 'sine';
  h2.frequency.setValueAtTime(5400, t);
  h2.frequency.exponentialRampToValueAtTime(6400, t + 0.045);
  const h2Depth = ctx.createGain();
  h2Depth.gain.value = 520;
  rattle.connect(h2Depth).connect(h2.frequency);
  const h2Gain = ctx.createGain();
  h2Gain.gain.value = 0.07;
  h2.connect(h2Gain).connect(env);

  // Desis napas di sekitar nada.
  const n = ctx.createBufferSource();
  n.buffer = noiseBuffer(ctx);
  n.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 3300;
  bp.Q.value = 3;
  const nGain = ctx.createGain();
  nGain.gain.value = 0.35;
  n.connect(bp).connect(nGain).connect(env);

  for (const node of [osc, rattle, h2, n]) {
    node.start(t);
    node.stop(t + dur + 0.05);
  }
}

const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 4242;
  for (let i = 0; i < d.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

export function createCrowd(ctx, out, samples = {}) {
  if (!ctx || typeof ctx.createBufferSource !== 'function') throw new TypeError('createCrowd: AudioContext tidak valid');
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(out);
  let volume = 0.8;
  let active = false;
  let bed = null; // { src, gain }
  let level = 0;

  function startBed() {
    if (bed || !samples.ambience) return;
    const src = ctx.createBufferSource();
    src.buffer = samples.ambience;
    src.loop = true;
    // mp3 punya jeda kecil di awal/akhir (encoder): putaran memakai bagian tengahnya saja.
    if (samples.ambience.duration > 1) {
      src.loopStart = 0.06;
      src.loopEnd = samples.ambience.duration - 0.06;
    }
    const gain = ctx.createGain();
    gain.gain.value = 0.45;
    src.connect(gain).connect(master);
    src.start(ctx.currentTime, 0.06 + Math.random() * Math.max(0, samples.ambience.duration - 1.2));
    bed = { src, gain };
  }

  function play(buffer, gain = 1, rate = 1) {
    if (!buffer) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(master);
    src.start();
    return true;
  }

  return {
    hasRecordings: () => Boolean(samples.ambience || samples.goal),
    setSamples(next) {
      samples = { ...next };
      if (bed) {
        bed.src.stop();
        bed = null;
      }
      if (active) startBed();
    },
    setActive(on) {
      active = Boolean(on);
      if (active) startBed();
      master.gain.setTargetAtTime(active ? volume : 0, ctx.currentTime, active ? 0.4 : 0.8);
    },
    setVolume(v) {
      if (!(v >= 0 && v <= 1)) throw new RangeError(`crowd.setVolume: ${v} di luar 0–1`);
      volume = v;
      if (active) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
    },
    // Rekaman dengung dikeraskan saat serangan berbahaya (naik cepat, turun pelan).
    setExcitement(x) {
      const e = clamp(x, 0, 1);
      if (!bed || Math.abs(e - level) < 0.02) return;
      const tc = e > level ? 0.25 : 1.2;
      level = e;
      bed.gain.gain.setTargetAtTime(0.45 + e * e * 0.9, ctx.currentTime, tc);
    },
    celebrate(strength = 1) {
      const s = clamp(strength, 0.2, 1);
      play(samples.goal, 1.1 * s);
    },
    ooh() {
      if (!play(samples.ooh, 0.8)) play(samples.goal, 0.25, 0.92); // tanpa rekaman "uuuh": sorak kecil
    },
    groan() {
      /* tanpa rekaman khusus: diam */
    },
    applause() {
      /* bagian dari rekaman gol / dengung */
    },
    whistle(kind = 'short') {
      if (!['short', 'long'].includes(kind)) throw new RangeError(`whistle: jenis ${kind}`);
      whistleBlow(ctx, out, ctx.currentTime + 0.01, kind === 'short' ? 0.32 : 1.3);
    },
  };
}
