// Musik latar orisinal (16 Nov, permintaan pengguna: lagu tanpa hak cipta). Tidak ada rekaman: semua
// nada disintesis Web Audio dari pola di bawah (komposisi sendiri untuk game ini), jadi bebas lisensi
// dan tidak menambah ukuran berkas.
//
//   TRACKS[i] = { name, bpm, chords[bar], bass[16], lead[bar][16], drums{kick,snare,hat}[16] }
//   createMusic(ctx) ─▶ { play(trackIndex), stop(), setVolume(0–1), current() }
//      penjadwal: tiap 25 ms, jadwalkan langkah 1/16 yang jatuh dalam 120 ms ke depan (anti-tersendat)
//      playlist : tiap lagu diputar LOOPS putaran, lalu lanjut ke lagu berikutnya
//
// Fungsi `renderNotes` dipakai juga oleh OfflineAudioContext untuk uji (tidak senyap, tidak pecah).

const LOOPS = 2;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

// Nada MIDI → Hz.
export const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Akor sebagai nada MIDI (oktaf 4). Progresi akor bukan objek hak cipta; melodi di bawah karangan sendiri.
const CH = {
  C: [60, 64, 67],
  Dm: [62, 65, 69],
  Em: [64, 67, 71],
  F: [65, 69, 72],
  G: [67, 71, 74],
  Am: [69, 72, 76],
  Bb: [70, 74, 77],
  A: [69, 73, 76],
  D: [62, 66, 69],
  Gm: [67, 70, 74],
};

// Langkah melodi: angka = nada MIDI, 0 = diam, -1 = sambung nada sebelumnya.
const _ = 0;
const S = -1;

export const TRACKS = Object.freeze([
  {
    name: 'Peluit Pertama',
    bpm: 122,
    chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'],
    bassOct: -24,
    lead: [
      [72, S, 74, 76, S, _, 76, 77, 79, S, 77, 76, 74, S, _, _],
      [74, S, 71, 74, S, _, 79, S, 77, 76, 74, S, 71, S, _, _],
      [76, S, 72, 76, S, _, 79, 81, 79, S, 76, 74, 72, S, _, _],
      [77, S, 76, 74, S, 72, 74, S, 76, S, 77, S, 72, S, _, _],
      [72, S, 74, 76, S, _, 76, 77, 79, S, 81, 79, 76, S, _, _],
      [79, S, 77, 74, S, 71, 74, S, 79, S, 83, 81, 79, S, _, _],
      [81, S, 79, 77, S, 76, 77, S, 81, S, 79, 77, 76, S, 74, S],
      [74, S, 76, 77, S, 79, S, _, 79, 77, 76, 74, 71, S, S, _],
    ],
    drums: { kick: '1000001010000000', snare: '0000100000001000', hat: '1010101010101011' },
  },
  {
    name: 'Ruang Ganti',
    bpm: 90,
    chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'Em'],
    bassOct: -24,
    arp: true,
    lead: [
      [76, S, S, _, 72, S, 74, S, 76, S, S, _, 79, S, 76, _],
      [77, S, S, _, 76, S, 74, S, 72, S, S, _, _, _, _, _],
      [72, S, S, _, 74, S, 76, S, 79, S, S, _, 76, S, 74, _],
      [74, S, S, S, S, _, _, _, 71, S, 74, S, 79, S, S, _],
      [76, S, S, _, 72, S, 74, S, 76, S, S, _, 81, S, 79, _],
      [77, S, S, _, 79, S, 77, S, 76, S, S, _, 72, S, S, _],
      [74, S, S, _, 77, S, 81, S, 79, S, 77, S, 76, S, 74, _],
      [76, S, S, S, S, S, S, _, _, _, _, _, _, _, _, _],
    ],
    drums: { kick: '1000000010000000', snare: '0000100000001000', hat: '0010001000100010' },
  },
  {
    name: 'Malam Derby',
    bpm: 112,
    chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
    bassOct: -24,
    drive: true,
    lead: [
      [74, S, 77, S, 81, S, 79, 77, 76, S, 74, S, 72, S, 74, _],
      [77, S, 74, S, 70, S, 74, 77, 79, S, 77, S, 74, S, S, _],
      [77, S, 81, S, 84, S, 81, 79, 77, S, 76, S, 77, S, 81, _],
      [79, S, 76, S, 72, S, 76, 79, 81, S, 79, S, 76, S, S, _],
      [74, S, 77, S, 81, S, 86, S, 84, 81, 79, S, 77, S, 74, _],
      [77, S, 74, S, 70, S, 74, 77, 82, S, 81, S, 79, S, S, _],
      [79, S, 82, S, 86, S, 84, 82, 81, S, 79, S, 77, S, 74, _],
      [76, S, 79, S, 81, S, S, S, 85, S, S, S, 81, S, S, _],
    ],
    drums: { kick: '1000100010001010', snare: '0000100000001001', hat: '1111111111111111' },
  },
]);

export function trackErrors(tr) {
  const e = [];
  if (!(tr.bpm >= 60 && tr.bpm <= 180)) e.push(`${tr.name}: bpm ${tr.bpm}`);
  if (tr.chords.length !== tr.lead.length) e.push(`${tr.name}: jumlah bar akor ≠ melodi`);
  for (const c of tr.chords) if (!CH[c]) e.push(`${tr.name}: akor tak dikenal ${c}`);
  tr.lead.forEach((bar, i) => {
    if (bar.length !== 16) e.push(`${tr.name}: bar ${i + 1} bukan 16 langkah`);
    if (bar[0] === S) e.push(`${tr.name}: bar ${i + 1} diawali sambungan`);
  });
  for (const [k, p] of Object.entries(tr.drums)) if (!/^[01]{16}$/.test(p)) e.push(`${tr.name}: pola ${k} tidak valid`);
  return e;
}
for (const tr of TRACKS) {
  const e = trackErrors(tr);
  if (e.length) throw new Error(`musik: ${e.join('; ')}`);
}

// Panjang nada melodi (berapa langkah sampai bukan sambungan).
function holdSteps(bar, i) {
  let n = 1;
  while (i + n < 16 && bar[i + n] === S) n += 1;
  return n;
}

let noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  noiseCache.set(ctx, b);
  return b;
}

function tone(ctx, out, { type, freq, t, dur, gain, attack = 0.01, release = 0.08, cutoff = null }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.linearRampToValueAtTime(0, t + dur);
  let node = o;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    o.connect(f);
    node = f;
  }
  node.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(ctx, out, { t, dur, gain, type, freq }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}

function kick(ctx, out, t) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.55, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.25);
}

// Jadwalkan satu langkah 1/16 (bar, step) dari lagu `tr` pada waktu t.
export function renderStep(ctx, out, tr, bar, step, t) {
  const sixteenth = 60 / tr.bpm / 4;
  const chord = CH[tr.chords[bar % tr.chords.length]];
  const leadBar = tr.lead[bar % tr.lead.length];
  // Pad akor di awal bar (lembut, dipotong lowpass).
  if (step === 0 && !tr.arp) for (const m of chord) tone(ctx, out, { type: 'sawtooth', freq: hz(m - 12), t, dur: sixteenth * 16, gain: 0.035, attack: 0.25, release: 0.4, cutoff: 1100 });
  // Arpeggio (lagu tenang).
  if (tr.arp && step % 2 === 0) {
    const m = chord[(step / 2) % 3] + (step >= 8 ? 12 : 0);
    tone(ctx, out, { type: 'triangle', freq: hz(m - 12), t, dur: sixteenth * 2, gain: 0.07, release: 0.1 });
  }
  // Bas: akar akor; lagu "drive" tiap 1/8, lainnya tiap ketukan.
  const bassEvery = tr.drive ? 2 : 4;
  if (step % bassEvery === 0) {
    const root = chord[0] + tr.bassOct + (tr.drive && step % 4 === 2 ? 12 : 0);
    tone(ctx, out, { type: 'triangle', freq: hz(root), t, dur: sixteenth * bassEvery * 0.9, gain: 0.16, release: 0.05 });
  }
  // Melodi.
  const n = leadBar[step];
  if (n > 0) tone(ctx, out, { type: 'square', freq: hz(n), t, dur: sixteenth * holdSteps(leadBar, step) * 0.95, gain: 0.045, release: 0.06, cutoff: 2600 });
  // Drum.
  if (tr.drums.kick[step] === '1') kick(ctx, out, t);
  if (tr.drums.snare[step] === '1') noise(ctx, out, { t, dur: 0.14, gain: 0.22, type: 'bandpass', freq: 1800 });
  if (tr.drums.hat[step] === '1') noise(ctx, out, { t, dur: 0.035, gain: 0.07, type: 'highpass', freq: 7000 });
}

export function createMusic(ctx) {
  if (!ctx || typeof ctx.createOscillator !== 'function') throw new TypeError('createMusic: AudioContext tidak valid');
  const master = ctx.createGain();
  // Kompresor menjaga puncak tetap di bawah 0 dBFS walau banyak nada bertumpuk.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.gain.value = 0.35;
  master.connect(comp).connect(ctx.destination);
  let timer = null;
  let track = 0;
  let pos = 0; // langkah ke-n sejak lagu mulai
  let nextTime = 0;
  let onTrack = () => {};

  function schedule() {
    const tr = TRACKS[track];
    const sixteenth = 60 / tr.bpm / 4;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      const bar = Math.floor(pos / 16);
      if (bar >= tr.lead.length * LOOPS) {
        // Ganti lagu setelah jeda satu ketukan.
        track = (track + 1) % TRACKS.length;
        pos = 0;
        nextTime += sixteenth * 4;
        onTrack(track);
        return;
      }
      renderStep(ctx, master, tr, bar, pos % 16, nextTime);
      pos += 1;
      nextTime += sixteenth;
    }
  }

  return {
    play(i = track) {
      if (!Number.isInteger(i) || i < 0 || i >= TRACKS.length) throw new RangeError(`play: lagu ${i} tidak ada`);
      if (timer) clearInterval(timer);
      track = i;
      pos = 0;
      nextTime = ctx.currentTime + 0.05;
      onTrack(track);
      timer = setInterval(schedule, TICK_MS);
      schedule();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    setVolume(v) {
      if (!(v >= 0 && v <= 1)) throw new RangeError(`setVolume: ${v} di luar 0–1`);
      master.gain.setTargetAtTime(v * 0.6, ctx.currentTime, 0.05);
    },
    next() {
      this.play((track + 1) % TRACKS.length);
    },
    current: () => track,
    playing: () => timer !== null,
    onTrackChange(fn) {
      onTrack = typeof fn === 'function' ? fn : () => {};
    },
  };
}

// Untuk uji: render `seconds` detik lagu ke OfflineAudioContext.
export function renderOffline(OfflineCtx, trackIndex, seconds = 4, sampleRate = 22050) {
  const ctx = new OfflineCtx(1, Math.ceil(seconds * sampleRate), sampleRate);
  const tr = TRACKS[trackIndex];
  const sixteenth = 60 / tr.bpm / 4;
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.gain.value = 0.35 * 0.6 * (1 / 0.6); // volume bawaan
  master.connect(comp).connect(ctx.destination);
  for (let p = 0, t = 0; t < seconds; p += 1, t += sixteenth) renderStep(ctx, master, tr, Math.floor(p / 16), p % 16, t);
  return ctx.startRendering();
}

export function resetNoiseCacheForTests() {
  noiseCache = new WeakMap();
}
