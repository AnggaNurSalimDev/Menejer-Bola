import { useEffect, useState } from 'react';
import { createMusic, TRACKS } from '../audio/music.js';
import { t } from '../i18n.js';

// Tombol musik di bar atas (menu & layar game memakai satu pemutar yang sama).
//
//   pengaturan (localStorage) { on, volume }  ─▶  klik/ketuk pertama di halaman membuat AudioContext
//   (aturan browser: suara baru boleh mulai setelah interaksi pengguna)  ─▶  play()

const KEY = 'menejer-bola:musik:v1';
const DEFAULTS = { on: true, volume: 0.5 };

function load() {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.on === 'boolean' && v.volume >= 0 && v.volume <= 1) return v;
  } catch {
    /* abaikan */
  }
  return { ...DEFAULTS };
}
function save(v) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* abaikan */
  }
}

// Satu pemutar untuk seluruh halaman.
const player = { ctx: null, music: null, settings: load(), track: 0, listeners: new Set() };
const notify = () => player.listeners.forEach((fn) => fn({ ...player.settings, track: player.track, started: Boolean(player.music?.playing()) }));

function ensure() {
  if (player.music) return player.music;
  const Ctx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx) return null; // browser tanpa Web Audio: tombol tetap ada, tanpa suara
  player.ctx = new Ctx();
  player.music = createMusic(player.ctx);
  player.music.onTrackChange((i) => {
    player.track = i;
    notify();
  });
  player.music.setVolume(player.settings.volume);
  return player.music;
}

function apply() {
  const s = player.settings;
  if (!s.on) {
    player.music?.stop();
    player.ctx?.suspend?.();
    notify();
    return;
  }
  const m = ensure();
  if (!m) return;
  player.ctx.resume?.();
  m.setVolume(s.volume);
  if (!m.playing()) m.play(player.track);
  notify();
}

function update(patch) {
  player.settings = { ...player.settings, ...patch };
  save(player.settings);
  apply();
}

// Mulai saat interaksi pertama (bila musik aktif).
if (typeof window !== 'undefined') {
  const first = () => {
    window.removeEventListener('pointerdown', first);
    window.removeEventListener('keydown', first);
    if (player.settings.on) apply();
  };
  window.addEventListener('pointerdown', first);
  window.addEventListener('keydown', first);
}

export default function MusicControl() {
  const [s, setS] = useState({ ...player.settings, track: player.track, started: Boolean(player.music?.playing()) });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    player.listeners.add(setS);
    return () => player.listeners.delete(setS);
  }, []);
  return (
    <span className="music-control">
      <button type="button" className="menu-link" aria-pressed={s.on} title={s.on ? t('Matikan musik') : t('Nyalakan musik')} onClick={() => update({ on: !s.on })}>
        {s.on ? '🔊' : '🔇'}
      </button>
      <button type="button" className="menu-link" aria-expanded={open} title={t('Pengaturan musik')} onClick={() => setOpen(!open)}>
        ♪
      </button>
      {open && (
        <span className="music-pop">
          <label>
            {t('Volume')}
            <input type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => update({ volume: Number(e.target.value), on: true })} />
          </label>
          <span className="tac-note">
            ♪ {TRACKS[s.track].name}
            {!s.started && s.on && ` · ${t('mulai setelah kamu klik di halaman')}`}
          </span>
          <button
            type="button"
            className="lane-reset"
            onClick={() => {
              update({ on: true });
              player.music?.next();
            }}
          >
            ⏭ {t('Lagu berikutnya')}
          </button>
          <small className="tac-note">{t('Musik orisinal buatan game ini (disintesis langsung, bebas hak cipta).')}</small>
        </span>
      )}
    </span>
  );
}
