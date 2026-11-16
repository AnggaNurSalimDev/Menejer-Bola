import { useEffect, useState } from 'react';
import { TRACKS } from '../audio/music.js';
import { subscribe, soundState, updateSound, nextTrack, setLanguage } from '../audio/hub.js';
import { t, getLang } from '../i18n.js';

// Tombol suara di bar atas (menu & layar game): musik, penonton & peluit, komentator bersuara.
// Pengaturan & pemutar ada di audio/hub.js (satu untuk seluruh halaman).

export default function MusicControl() {
  const [s, setS] = useState(soundState);
  const [open, setOpen] = useState(false);
  useEffect(() => subscribe(setS), []);
  useEffect(() => setLanguage(getLang()));
  const anyOn = s.on || s.sfx;
  return (
    <span className="music-control">
      <button type="button" className="menu-link" aria-pressed={anyOn} title={anyOn ? t('Matikan semua suara') : t('Nyalakan suara')} onClick={() => updateSound(anyOn ? { on: false, sfx: false } : { on: true, sfx: true })}>
        {anyOn ? '🔊' : '🔇'}
      </button>
      <button type="button" className="menu-link" aria-expanded={open} title={t('Pengaturan suara')} onClick={() => setOpen(!open)}>
        ♪
      </button>
      {open && (
        <span className="music-pop">
          <label className="sound-row">
            <input type="checkbox" checked={s.on} onChange={(e) => updateSound({ on: e.target.checked })} /> {t('Musik')}
            <input type="range" min={0} max={1} step={0.05} value={s.volume} aria-label={t('Volume musik')} onChange={(e) => updateSound({ volume: Number(e.target.value), on: true })} />
          </label>
          <span className="tac-note">
            ♪ {TRACKS[s.track].name}
            {!s.started && s.on && ` · ${t('mulai setelah kamu klik di halaman')}`}{' '}
            <button type="button" className="link-btn" onClick={nextTrack}>
              ⏭ {t('Lagu berikutnya')}
            </button>
          </span>
          <label className="sound-row">
            <input type="checkbox" checked={s.sfx} onChange={(e) => updateSound({ sfx: e.target.checked })} /> {t('Penonton & peluit')}
            <input type="range" min={0} max={1} step={0.05} value={s.sfxVolume} aria-label={t('Volume penonton')} onChange={(e) => updateSound({ sfxVolume: Number(e.target.value), sfx: true })} />
          </label>
          <label className="sound-row">
            <input type="checkbox" checked={s.voice} onChange={(e) => updateSound({ voice: e.target.checked })} /> {t('Suara komentator')}
          </label>
          {s.voice && !s.voiceAvailable && <small className="sub-warn">{t('Browser ini tidak punya suara untuk bahasa yang dipilih — komentar tampil sebagai teks saja.')}</small>}
          <small className="tac-note">{t('Musik, penonton, dan peluit dibuat langsung oleh game (bebas hak cipta). Suara komentator memakai suara bawaan browser/perangkatmu.')}</small>
        </span>
      )}
    </span>
  );
}
