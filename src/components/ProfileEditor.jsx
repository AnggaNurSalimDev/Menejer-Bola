import ClubLogo from './ClubLogo.jsx';
import { LOGO_SHAPES, LOGO_PATTERNS, LOGO_TEXT_MAX, cleanLogoText } from '../engine/logo.js';
import { NAME_MAX } from '../engine/league.js';
import { t, tk } from '../i18n.js';

// Editor profil karier (14 Nov): nama klub, nama manajer, logo (bentuk, pola, dua warna, inisial).
// Terkendali penuh: value = { clubName, managerName, logo }, onChange(nilai baru).

const SHAPE_LABEL = { perisai: tk('Perisai'), bulat: tk('Bulat'), kotak: tk('Kotak'), berlian: tk('Berlian'), bintang: tk('Bintang') };
const PATTERN_LABEL = { polos: tk('Polos'), tengah: tk('Garis tengah'), diagonal: tk('Diagonal'), setengah: tk('Belah dua'), garis: tk('Garis-garis'), cincin: tk('Cincin') };
const SWATCHES = ['#1f4fbf', '#0b7285', '#2b8a3e', '#5f3dc4', '#c92a2a', '#e8590c', '#f59f00', '#ffd43b', '#212529', '#495057', '#a5d8ff', '#ffffff'];

function ColorPick({ label, value, onChange }) {
  return (
    <div className="color-pick">
      <span className="tac-label">{t(label)}</span>
      <div className="color-pick__row">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch ${c === value ? 'is-active' : ''}`}
            style={{ background: c }}
            aria-label={c}
            aria-pressed={c === value}
            onClick={() => onChange(c)}
          />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} aria-label={t('Warna lain')} />
      </div>
    </div>
  );
}

export default function ProfileEditor({ value, onChange, disabled }) {
  const { clubName, managerName, logo } = value;
  const set = (patch) => onChange({ ...value, ...patch });
  const setLogo = (patch) => set({ logo: { ...logo, ...patch } });
  return (
    <div className="profile-editor">
      <div className="profile-editor__preview">
        <ClubLogo logo={logo} size={112} title={clubName} />
        <div>
          <p className="profile-editor__club">{clubName || '—'}</p>
          <p className="profile-editor__manager">
            {t('Manajer')}: {managerName || '—'}
          </p>
        </div>
      </div>

      <div className="profile-editor__fields">
        <label className="field">
          <span className="tac-label">{t('Nama klub')}</span>
          <input type="text" value={clubName} maxLength={NAME_MAX} disabled={disabled} onChange={(e) => set({ clubName: e.target.value })} />
        </label>
        <label className="field">
          <span className="tac-label">{t('Nama manajer')}</span>
          <input type="text" value={managerName} maxLength={NAME_MAX} disabled={disabled} onChange={(e) => set({ managerName: e.target.value })} />
        </label>

        <div className="field">
          <span className="tac-label">{t('Bentuk logo')}</span>
          <div className="tac-options">
            {LOGO_SHAPES.map((s) => (
              <button key={s} type="button" className={s === logo.shape ? 'is-active' : undefined} disabled={disabled} onClick={() => setLogo({ shape: s })}>
                {t(SHAPE_LABEL[s])}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="tac-label">{t('Pola')}</span>
          <div className="tac-options">
            {LOGO_PATTERNS.map((p) => (
              <button key={p} type="button" className={p === logo.pattern ? 'is-active' : undefined} disabled={disabled} onClick={() => setLogo({ pattern: p })}>
                {t(PATTERN_LABEL[p])}
              </button>
            ))}
          </div>
        </div>
        <ColorPick label={tk('Warna utama (juga warna jersey)')} value={logo.primary} onChange={(c) => !disabled && setLogo({ primary: c })} />
        <ColorPick label={tk('Warna kedua')} value={logo.secondary} onChange={(c) => !disabled && setLogo({ secondary: c })} />
        <label className="field">
          <span className="tac-label">{t('Inisial di logo (maks {n})', { n: LOGO_TEXT_MAX })}</span>
          <input type="text" value={logo.text} maxLength={LOGO_TEXT_MAX} disabled={disabled} onChange={(e) => setLogo({ text: cleanLogoText(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}
