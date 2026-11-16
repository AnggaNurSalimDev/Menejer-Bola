// Pusat suara (16 Nov): satu AudioContext untuk musik dan penonton/peluit. Pengaturan di localStorage.
// (Suara komentator dicoba lalu dihapus atas permintaan pengguna, 16 Nov.)
//
//   ctx ─┬─ musicBus ── createMusic   (diredam 35% saat laga berjalan)
//        └─ sfxBus ──── createCrowd   (penonton hanya berbunyi saat laga berjalan)

import { createMusic } from './music.js';
import { createCrowd } from './crowd.js';
import { loadSamples } from './samples.js';

const KEY = 'menejer-bola:musik:v1';
export const SOUND_DEFAULTS = Object.freeze({ on: true, volume: 0.5, sfx: true, sfxVolume: 0.8 });

function load() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const m = { ...SOUND_DEFAULTS, ...v };
      if (typeof m.on === 'boolean' && m.volume >= 0 && m.volume <= 1 && typeof m.sfx === 'boolean' && m.sfxVolume >= 0 && m.sfxVolume <= 1) return m;
    }
  } catch {
    /* abaikan */
  }
  return { ...SOUND_DEFAULTS };
}

const hub = {
  ctx: null,
  music: null,
  crowd: null,
  sfxBus: null,
  settings: typeof window !== 'undefined' ? load() : { ...SOUND_DEFAULTS },
  track: 0,
  matchActive: false,
  lang: 'id',
  listeners: new Set(),
};

const snapshot = () => ({ ...hub.settings, track: hub.track, started: Boolean(hub.music?.playing()) });
const notify = () => hub.listeners.forEach((fn) => fn(snapshot()));
export const subscribe = (fn) => {
  hub.listeners.add(fn);
  return () => hub.listeners.delete(fn);
};
export const soundState = snapshot;
// Untuk pemeriksaan (konsol / uji otomatis): apakah rekaman penonton termuat.
if (typeof window !== 'undefined') window.__menejerSound = () => ({ context: hub.ctx?.state ?? null, recordings: hub.crowd?.hasRecordings() ?? false });

function ensure() {
  if (hub.ctx) return true;
  const Ctx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx) return false;
  hub.ctx = new Ctx();
  hub.music = createMusic(hub.ctx);
  hub.music.onTrackChange((i) => {
    hub.track = i;
    notify();
  });
  hub.sfxBus = hub.ctx.createGain();
  // Penonton yang riuh bisa menumpuk; kompresor menjaga supaya tidak pecah.
  const comp = hub.ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.ratio.value = 6;
  hub.sfxBus.connect(comp).connect(hub.ctx.destination);
  hub.crowd = createCrowd(hub.ctx, hub.sfxBus);
  // Rekaman penonton (bila ada di build) dimuat di belakang; sebelum siap, penonton diam.
  loadSamples(hub.ctx).then((smp) => hub.crowd.setSamples(smp)).catch(() => {});
  return true;
}

function apply() {
  const s = hub.settings;
  const anything = s.on || s.sfx;
  if (!anything) {
    hub.music?.stop();
    hub.ctx?.suspend?.();
    notify();
    return;
  }
  if (!ensure()) return;
  hub.ctx.resume?.();
  hub.music.setVolume(s.on ? s.volume * (hub.matchActive && s.sfx ? 0.35 : 1) : 0);
  if (s.on && !hub.music.playing()) hub.music.play(hub.track);
  if (!s.on) hub.music.stop();
  hub.sfxBus.gain.setTargetAtTime(s.sfx ? s.sfxVolume : 0, hub.ctx.currentTime, 0.05);
  hub.crowd.setActive(s.sfx && hub.matchActive);
  notify();
}

export function updateSound(patch) {
  hub.settings = { ...hub.settings, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(hub.settings));
  } catch {
    /* abaikan */
  }
  apply();
}

export function nextTrack() {
  updateSound({ on: true });
  hub.music?.next();
}

// Hanya memberi tahu bila bahasa benar-benar berubah (memberi tahu tanpa perubahan memicu render
// ulang MusicControl → efeknya memanggil ini lagi → putaran render tanpa henti; bug 16 Nov).
export function setLanguage(lang) {
  const next = lang === 'en' ? 'en' : 'id';
  if (hub.lang === next) return;
  hub.lang = next;
  notify();
}

// Laga sedang berjalan (bukan dijeda) → penonton bersuara, musik diredam.
export function setMatchActive(on) {
  if (hub.matchActive === Boolean(on)) return;
  hub.matchActive = Boolean(on);
  if (hub.ctx) apply();
}

export function setExcitement(x) {
  if (hub.crowd && hub.settings.sfx) hub.crowd.setExcitement(x);
}

export function playSound(name) {
  if (!hub.crowd || !hub.settings.sfx) return;
  const c = hub.crowd;
  switch (name) {
    case 'roar':
      c.celebrate(1);
      break;
    case 'roarAway':
      // Gol tim tamu: pendukungnya lebih sedikit (tetap meriah, tapi lebih kecil); sisanya kecewa.
      c.celebrate(0.6);
      c.groan();
      break;
    case 'ooh':
      c.ooh();
      break;
    case 'groan':
      c.groan();
      break;
    case 'applause':
      c.applause(2);
      break;
    case 'whistleShort':
      c.whistle('short');
      break;
    case 'whistleLong':
      c.whistle('long');
      break;
    case 'whistleEnd':
      c.whistle('long');
      c.applause(5);
      break;
    default:
      throw new RangeError(`playSound: bunyi tidak dikenal ${name}`);
  }
}

// Mulai saat interaksi pertama (aturan autoplay browser).
if (typeof window !== 'undefined') {
  const first = () => {
    window.removeEventListener('pointerdown', first);
    window.removeEventListener('keydown', first);
    if (hub.settings.on || hub.settings.sfx) apply();
  };
  window.addEventListener('pointerdown', first);
  window.addEventListener('keydown', first);
}
