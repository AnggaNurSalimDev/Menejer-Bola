// Suara stadion (16 Nov): penonton, peluit wasit, sorakan gol. Semua disintesis Web Audio dari derau &
// osilator — tanpa rekaman, bebas hak cipta.
//
//   createCrowd(ctx, out)
//     bed      : derau berulang → bandpass → gain; setExcitement(0–1) menaikkan keras & kecerahan
//     roar(s)  : gelombang sorak (gol), s = 0–1 (pendukung tuan rumah lebih keras)
//     ooh()    : "uuuh" peluang gagal  · groan(): kecewa · applause(): tepuk tangan
//     whistle(kind): 'short' | 'long' | 'end' (tiga tiupan)
//   setActive(false) memudarkan semua bunyi latar (laga dijeda / bukan di layar laga).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function makeNoise(ctx, seconds = 3, brown = false) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 987654;
  let last = 0;
  for (let i = 0; i < d.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const w = (seed / 0x7fffffff) * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  // Ujung disilangkan supaya putaran ulang tidak berbunyi "klik".
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade;
    d[i] = d[i] * k + d[d.length - fade + i] * (1 - k);
  }
  return b;
}

export function createCrowd(ctx, out) {
  if (!ctx || typeof ctx.createBufferSource !== 'function') throw new TypeError('createCrowd: AudioContext tidak valid');
  const white = makeNoise(ctx, 3, false);
  const brown = makeNoise(ctx, 4, true);
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(out);

  // Lapisan dasar: gemuruh (derau coklat) + riuh suara (derau putih di pita suara manusia).
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0.2;
  const rumble = ctx.createBufferSource();
  rumble.buffer = brown;
  rumble.loop = true;
  const rumbleLp = ctx.createBiquadFilter();
  rumbleLp.type = 'lowpass';
  rumbleLp.frequency.value = 500;
  rumble.connect(rumbleLp).connect(bedGain);
  const chatter = ctx.createBufferSource();
  chatter.buffer = white;
  chatter.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 700;
  band.Q.value = 0.7;
  const chatterGain = ctx.createGain();
  chatterGain.gain.value = 0.35;
  chatter.connect(band).connect(chatterGain).connect(bedGain);
  bedGain.connect(master);
  rumble.start();
  chatter.start();

  let volume = 0.6;
  let active = false;
  let excitement = 0;

  function setActive(on) {
    active = Boolean(on);
    master.gain.setTargetAtTime(active ? volume : 0, ctx.currentTime, active ? 0.4 : 0.8);
  }
  function setVolume(v) {
    if (!(v >= 0 && v <= 1)) throw new RangeError(`crowd.setVolume: ${v} di luar 0–1`);
    volume = v;
    if (active) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.1);
  }
  function setExcitement(x) {
    const e = clamp(x, 0, 1);
    if (Math.abs(e - excitement) < 0.02) return;
    excitement = e;
    bedGain.gain.setTargetAtTime(0.2 + e * 0.4, ctx.currentTime, 0.6);
    band.frequency.setTargetAtTime(650 + e * 600, ctx.currentTime, 0.6);
  }

  // Satu "gelombang" derau yang naik lalu turun.
  function swell({ peak, attack, hold, release, freq, freqEnd = freq, q = 0.8, buffer = white }) {
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.linearRampToValueAtTime(freqEnd, t + attack + hold + release);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 2);
    s.stop(t + attack + hold + release + 0.1);
  }

  return {
    setActive,
    setVolume,
    setExcitement,
    roar(strength = 1) {
      const s = clamp(strength, 0.1, 1);
      swell({ peak: 0.9 * s, attack: 0.25, hold: 1.6, release: 3.5, freq: 900, freqEnd: 650, q: 0.6 });
      swell({ peak: 0.5 * s, attack: 0.3, hold: 1.4, release: 3, freq: 300, freqEnd: 220, q: 0.7, buffer: brown });
    },
    ooh() {
      swell({ peak: 0.5, attack: 0.25, hold: 0.25, release: 1.1, freq: 520, freqEnd: 300, q: 2.5 });
    },
    groan() {
      swell({ peak: 0.35, attack: 0.3, hold: 0.3, release: 1.6, freq: 380, freqEnd: 240, q: 2 });
    },
    applause(seconds = 2.5) {
      // Tepukan = banyak letupan derau pendek pita tinggi.
      const t0 = ctx.currentTime;
      const n = Math.round(seconds * 40);
      for (let i = 0; i < n; i += 1) {
        const t = t0 + Math.random() * seconds;
        const s = ctx.createBufferSource();
        s.buffer = white;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1500 + Math.random() * 2500;
        f.Q.value = 1.2;
        const g = ctx.createGain();
        const fadeOut = 1 - (t - t0) / seconds;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * (0.4 + fadeOut), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        s.connect(f).connect(g).connect(master);
        s.start(t, Math.random() * 2);
        s.stop(t + 0.06);
      }
    },
    whistle(kind = 'short') {
      if (!['short', 'long', 'end'].includes(kind)) throw new RangeError(`whistle: jenis ${kind}`);
      const blows = kind === 'end' ? [0, 0.45, 0.9] : [0];
      const len = kind === 'short' ? 0.3 : kind === 'long' ? 0.9 : 0.35;
      for (const off of blows) {
        const t = ctx.currentTime + off;
        const dur = kind === 'end' && off === 0.9 ? 1.1 : len;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.setValueAtTime(0.12, t + dur - 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        // Getar bola kecil di dalam peluit = modulasi amplitudo ±30 Hz.
        const trem = ctx.createOscillator();
        trem.frequency.value = 32;
        const tremGain = ctx.createGain();
        tremGain.gain.value = 0.05;
        trem.connect(tremGain).connect(g.gain);
        for (const f of [2750, 3150]) {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = f;
          o.connect(g);
          o.start(t);
          o.stop(t + dur + 0.05);
        }
        trem.start(t);
        trem.stop(t + dur + 0.05);
        g.connect(out); // peluit tidak ikut dipudarkan dengan penonton
      }
    },
  };
}
