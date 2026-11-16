import MusicControl from './MusicControl.jsx';
import { useState } from 'react';
import ClubLogo from './ClubLogo.jsx';
import ProfileEditor from './ProfileEditor.jsx';
import { CLUB_CHOICES, createLeague, NAME_MAX } from '../engine/league.js';
import { CLUB_STYLES } from '../engine/clubStyles.js';
import { defaultLogo, logoErrors } from '../engine/logo.js';
import { SLOTS, slotSummary } from '../saves.js';
import { roundDate } from '../engine/calendar.js';
import { dateLabel } from './compLabels.js';
import { t, getLang } from '../i18n.js';

// Menu utama (14 Nov): lanjutkan · karier baru · muat · laga persahabatan · bahasa.
// Tidak menyimpan sendiri: memanggil onStart(slot, league) / onDelete(slot) / onFriendly().

function stars(q) {
  const n = Math.max(1, Math.min(5, Math.round((q - 6) / 2))); // 7 → ★, 15+ → ★★★★★ (15 Nov: 3 kasta)
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function fmtDate(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(getLang() === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function SlotCard({ index, slot, children }) {
  const s = slotSummary(slot);
  return (
    <div className={`slot-card ${s ? '' : 'is-empty'}`}>
      <span className="slot-card__num">{index + 1}</span>
      {s ? (
        <>
          <ClubLogo logo={s.logo} size={40} title={s.clubName} />
          <div className="slot-card__info">
            <b>{s.clubName}</b>
            <span>
              {s.managerName} · {t('Liga {n}', { n: s.tier ?? 1 })} · {t('Musim {s} · Babak {w}/{n}', { s: s.season, w: s.week, n: s.weeks })} · {dateLabel(roundDate(s.season, s.week - 1))}
            </span>
            <small>{fmtDate(s.savedAt)}</small>
          </div>
        </>
      ) : (
        <div className="slot-card__info">
          <span>{t('Slot kosong')}</span>
        </div>
      )}
      <div className="slot-card__actions">{children}</div>
    </div>
  );
}

function NewCareer({ saves, onStart, onBack }) {
  const firstFree = saves.slots.findIndex((s) => s === null);
  const [slot, setSlot] = useState(firstFree >= 0 ? firstFree : 0);
  const [clubId, setClubId] = useState(CLUB_CHOICES[0].id);
  const [tier, setTier] = useState(1);
  const club = CLUB_CHOICES.find((c) => c.id === clubId);
  const [profile, setProfile] = useState(() => ({ clubName: club.name, managerName: '', logo: defaultLogo(club) }));
  const [error, setError] = useState(null);

  function pickClub(c) {
    setClubId(c.id);
    // Nama & logo ikut klub baru, kecuali pengguna sudah mengubah nama klub sendiri.
    const renamed = profile.clubName.trim() && !CLUB_CHOICES.some((x) => x.name === profile.clubName.trim());
    setProfile({ ...profile, clubName: renamed ? profile.clubName : c.name, logo: renamed ? profile.logo : defaultLogo(c) });
  }

  const clubName = profile.clubName.replace(/\s+/g, ' ').trim();
  const managerName = profile.managerName.replace(/\s+/g, ' ').trim();
  const taken = CLUB_CHOICES.some((c) => c.id !== clubId && c.name.toLowerCase() === clubName.toLowerCase());
  const problems = [
    !clubName && t('Nama klub belum diisi'),
    taken && t('Nama klub sudah dipakai klub lain di liga'),
    !managerName && t('Nama manajer belum diisi'),
    logoErrors(profile.logo).length > 0 && t('Logo belum lengkap'),
  ].filter(Boolean);
  const overwriting = saves.slots[slot] !== null;

  function start() {
    if (problems.length) return;
    try {
      const league = createLeague(Math.floor(Math.random() * 1e9) + 1, { clubId, clubName, managerName, logo: profile.logo });
      onStart(slot, league);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="menu-panel">
      <div className="menu-panel__head">
        <button type="button" className="link-btn" onClick={onBack}>
          ← {t('Kembali')}
        </button>
        <h2>{t('Karier baru')}</h2>
      </div>

      <section>
        <h4>1 · {t('Pilih klub')}</h4>
        <p className="tac-note">{t('Klub menentukan skuad, kekuatan awal, dan gaya bermain bawaan. Nama dan logo bisa kamu ganti di bawah.')}</p>
        <div className="tac-options tier-tabs" role="group" aria-label={t('Kasta')}>
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" className={n === tier ? 'is-active' : undefined} aria-pressed={n === tier} onClick={() => setTier(n)}>
              {t('Liga {n}', { n })}
            </button>
          ))}
        </div>
        <p className="tac-note">{[t('Liga 1: kasta teratas, 4 teratas ikut Kejuaraan Elite.'), t('Liga 2: 2 teratas naik, peringkat 3–6 play-off.'), t('Liga 3: kasta terbawah — merintis dari bawah.')][tier - 1]}</p>
        <div className="club-grid">
          {CLUB_CHOICES.filter((c) => c.tier === tier)
            .sort((a, b) => b.quality - a.quality || a.name.localeCompare(b.name))
            .map((c) => (
            <button key={c.id} type="button" className={`club-card ${c.id === clubId ? 'is-active' : ''}`} onClick={() => pickClub(c)}>
              <ClubLogo logo={defaultLogo(c)} size={36} />
              <span className="club-card__name">{c.name}</span>
              <span className="club-card__meta">
                {t(CLUB_STYLES[c.style].label)} · {CLUB_STYLES[c.style].formation}
              </span>
              <span className="club-card__stars" title={t('Kekuatan skuad')}>
                {stars(c.quality)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>2 · {t('Identitas klub')}</h4>
        <ProfileEditor value={profile} onChange={setProfile} />
        <p className="tac-note">{t('Maks {n} huruf untuk nama. Nama, manajer, dan logo bisa diubah lagi kapan saja di tab Liga.', { n: NAME_MAX })}</p>
      </section>

      <section>
        <h4>3 · {t('Simpan di slot')}</h4>
        <div className="tac-options">
          {Array.from({ length: SLOTS }, (_, i) => (
            <button key={i} type="button" className={i === slot ? 'is-active' : undefined} onClick={() => setSlot(i)}>
              {t('Slot {n}', { n: i + 1 })} · {saves.slots[i] ? slotSummary(saves.slots[i]).clubName : t('kosong')}
            </button>
          ))}
        </div>
        {overwriting && <p className="script-warn">⚠️ {t('Slot ini sudah berisi karier — akan ditimpa.')}</p>}
      </section>

      {problems.length > 0 && (
        <ul className="script-errors">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && <p className="script-warn">⚠️ {error}</p>}
      <div className="menu-panel__foot">
        <button type="button" className="break-button" disabled={problems.length > 0} onClick={start}>
          {t('Mulai karier')}
        </button>
      </div>
    </div>
  );
}

function LoadCareer({ saves, onLoad, onDelete, onBack }) {
  const [confirm, setConfirm] = useState(null);
  return (
    <div className="menu-panel">
      <div className="menu-panel__head">
        <button type="button" className="link-btn" onClick={onBack}>
          ← {t('Kembali')}
        </button>
        <h2>{t('Muat karier')}</h2>
      </div>
      {saves.slots.map((s, i) => (
        <SlotCard key={i} index={i} slot={s}>
          {s && confirm !== i && (
            <>
              <button type="button" className="break-button" onClick={() => onLoad(i)}>
                {t('Muat')}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirm(i)}>
                {t('hapus')}
              </button>
            </>
          )}
          {s && confirm === i && (
            <>
              <span>{t('Hapus karier ini?')}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setConfirm(null);
                  onDelete(i);
                }}
              >
                {t('ya, hapus')}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                {t('batal')}
              </button>
            </>
          )}
        </SlotCard>
      ))}
    </div>
  );
}

export default function MainMenu({ saves, onStart, onLoad, onDelete, onFriendly, lang, onLang, langs }) {
  const [view, setView] = useState('home');
  const last = saves.last !== null ? saves.slots[saves.last] : null;
  const any = saves.slots.some(Boolean);

  return (
    <main className="main-menu">
      <div className="lang-switch" role="group" aria-label="Bahasa / Language">
        <MusicControl />
        {langs.map((l) => (
          <button key={l} type="button" className={l === lang ? 'is-active' : undefined} aria-pressed={l === lang} onClick={() => onLang(l)}>
            {l === 'id' ? 'ID' : 'EN'}
          </button>
        ))}
      </div>

      {view === 'home' && (
        <div className="menu-home">
          <h1 className="menu-title">
            MENEJER <span>BOLA</span>
          </h1>
          <p className="menu-tagline">{t('Racik taktik · tonton laga · juarai liga')}</p>
          {!saves.available && <p className="script-warn">⚠️ {t('Penyimpanan perangkat tidak tersedia — karier tidak bisa disimpan di browser ini.')}</p>}
          {saves.broken.length > 0 && <p className="script-warn">⚠️ {t('Sebagian data simpanan rusak dan dikosongkan.')}</p>}

          <div className="menu-buttons">
            {last && (
              <button type="button" className="menu-btn menu-btn--primary" onClick={() => onLoad(saves.last)}>
                <span>{t('Lanjutkan')}</span>
                <small>
                  {slotSummary(last).clubName} · {t('Liga {n}', { n: slotSummary(last).tier ?? 1 })} · {t('Musim {s} · Babak {w}/{n}', { s: slotSummary(last).season, w: slotSummary(last).week, n: slotSummary(last).weeks })} · {dateLabel(roundDate(slotSummary(last).season, slotSummary(last).week - 1))}
                </small>
              </button>
            )}
            <button type="button" className={`menu-btn ${last ? '' : 'menu-btn--primary'}`} onClick={() => setView('new')}>
              <span>{t('Karier baru')}</span>
              <small>{t('Pilih klub, nama, logo, dan nama manajer')}</small>
            </button>
            <button type="button" className="menu-btn" disabled={!any} onClick={() => setView('load')}>
              <span>{t('Muat karier')}</span>
              <small>{t('{n} slot simpanan', { n: SLOTS })}</small>
            </button>
            <button type="button" className="menu-btn" onClick={onFriendly}>
              <span>{t('Laga persahabatan')}</span>
              <small>{t('Satu laga cepat melawan gaya pilihan, tidak disimpan')}</small>
            </button>
          </div>
          <p className="tac-note menu-note">{t('Karier disimpan otomatis di browser perangkat ini.')}</p>
        </div>
      )}
      {view === 'new' && <NewCareer saves={saves} onStart={onStart} onBack={() => setView('home')} />}
      {view === 'load' && <LoadCareer saves={saves} onLoad={onLoad} onDelete={onDelete} onBack={() => setView('home')} />}
    </main>
  );
}
