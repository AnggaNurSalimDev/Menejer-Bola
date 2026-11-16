// Pusat suara (16 Nov): satu AudioContext untuk musik, penonton/peluit, plus suara komentator
// (speechSynthesis bawaan browser). Pengaturan disimpan di localStorage.
//
//   ctx ─┬─ musicBus ── createMusic   (diredam 35% saat laga berjalan)
//        └─ sfxBus ──── createCrowd   (penonton hanya berbunyi saat laga berjalan)
//   speak(teks) ── speechSynthesis, hanya bila ada suara untuk bahasa yang dipilih (tidak memakai
//                  suara bahasa lain yang akan salah ucap)

import { createMusic } from './music.js';
import { createCrowd } from './crowd.js';

const KEY = 'menejer-bola:musik:v1';
export const SOUND_DEFAULTS = Object.freeze({ on: true, volume: 0.5, sfx: true, sfxVolume: 0.7, voice: true });

function load() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const m = { ...SOUND_DEFAULTS, ...v };
      if (typeof m.on === 'boolean' && m.volume >= 0 && m.volume <= 1 && typeof m.sfx === 'boolean' && m.sfxVolume >= 0 && m.sfxVolume <= 1 && typeof m.voice === 'boolean') return m;
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

const snapshot = () => ({ ...hub.settings, track: hub.track, started: Boolean(hub.music?.playing()), voiceAvailable: voiceFor(hub.lang) !== null });
const notify = () => hub.listeners.forEach((fn) => fn(snapshot()));
export const subscribe = (fn) => {
  hub.listeners.add(fn);
  return () => hub.listeners.delete(fn);
};
export const soundState = snapshot;

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
  hub.sfxBus.connect(hub.ctx.destination);
  hub.crowd = createCrowd(hub.ctx, hub.sfxBus);
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
  if (!hub.settings.voice) window.speechSynthesis?.cancel?.();
  apply();
}

export function nextTrack() {
  updateSound({ on: true });
  hub.music?.next();
}

export function setLanguage(lang) {
  hub.lang = lang === 'en' ? 'en' : 'id';
  notify();
}

// Laga sedang berjalan (bukan dijeda) → penonton bersuara, musik diredam.
export function setMatchActive(on) {
  if (hub.matchActive === Boolean(on)) return;
  hub.matchActive = Boolean(on);
  if (!on) window.speechSynthesis?.cancel?.();
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
      c.roar(1);
      break;
    case 'roarAway':
      // Gol tim tamu: pendukungnya lebih sedikit; sisanya kecewa.
      c.roar(0.45);
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
      c.whistle('end');
      c.applause(4);
      break;
    default:
      throw new RangeError(`playSound: bunyi tidak dikenal ${name}`);
  }
}

// ---------------------------------------------------------------- komentator bersuara

export function voiceFor(lang) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (!synth?.getVoices) return null;
  const want = lang === 'en' ? 'en' : 'id';
  const voices = synth.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith(want) && /google|natural|online/i.test(v.name)) ?? voices.find((v) => v.lang?.toLowerCase().startsWith(want)) ?? null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  // Daftar suara sering baru terisi setelah event ini.
  window.speechSynthesis.addEventListener?.('voiceschanged', notify);
}

// priority: 5 gol · 4 penalti/kartu merah · 3 kartu/babak · 2 tembakan. Kalimat penting memotong antrean.
export function speak(text, priority) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
  if (!synth || !hub.settings.voice || !hub.matchActive) return false;
  const voice = voiceFor(hub.lang);
  if (!voice) return false;
  if (synth.speaking || synth.pending) {
    if (priority < 4) return false;
    synth.cancel();
  }
  const u = new SpeechSynthesisUtterance(text.replace(/[–—]/g, ' ').replace(/\s+/g, ' '));
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = priority >= 5 ? 1.15 : 1.08;
  u.pitch = priority >= 5 ? 1.15 : 1;
  u.volume = Math.min(1, 0.6 + hub.settings.sfxVolume * 0.4);
  synth.speak(u);
  return true;
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
