import { useState } from 'react';
import { CLUB_STYLES, getStyle } from '../engine/clubStyles.js';
import { getFormation } from '../engine/formations.js';
import {
  LEAGUE,
  standings,
  userFixture,
  clubById,
  seasonOver,
  overall,
  playerValue,
  buyPlayer,
  sellPlayer,
  setStarter,
  newSeason,
  updateProfile,
} from '../engine/league.js';
import ClubLogo from './ClubLogo.jsx';
import ProfileEditor from './ProfileEditor.jsx';
import { t, getLang } from '../i18n.js';

const FORM_EN = { M: 'W', S: 'D', K: 'L' };
const ERR_EN = [
  [/^Anggaran kurang \(butuh (\d+) jt, ada (\d+) jt\)$/, 'Not enough budget (need $1 M, have $2 M)'],
  [/^Skuad penuh \(maks (\d+)\)$/, 'Squad full (max $1)'],
  [/^Pemain inti tidak bisa dijual — ganti dulu dari susunan$/, 'Starters cannot be sold — take them out of the line-up first'],
  [/^Skuad minimal (\d+) pemain$/, 'Squad needs at least $1 players'],
];
const PROFILE_ERR = [
  [/nama klub kosong/, ['Nama klub belum diisi', 'Club name is empty']],
  [/nama manajer kosong/, ['Nama manajer belum diisi', 'Manager name is empty']],
  [/nama klub sudah dipakai/, ['Nama klub sudah dipakai klub lain di liga', 'Another club in the league already uses that name']],
  [/logo|teks|warna|bentuk|pola/, ['Logo belum lengkap', 'The logo is incomplete']],
];
const profileErrText = (m) => {
  const hit = PROFILE_ERR.find(([re]) => re.test(m));
  return hit ? hit[1][getLang() === 'en' ? 1 : 0] : m;
};
const errText = (m) => (getLang() === 'en' ? ERR_EN.reduce((s, [re, en]) => s.replace(re, en), m) : m);

// Tab Liga (10 Nov): klasemen, jadwal, skuad & bursa "seadanya". Semua perubahan lewat fungsi murni
// league.js; App yang menyimpan ke perangkat. `locked` = laga liga sedang berjalan (skuad dikunci).

const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

export default function LeagueTab({ league, onChange, locked, onGoMatch }) {
  const [msg, setMsg] = useState(null);
  const [editing, setEditing] = useState(null); // profil yang sedang diubah | null
  const [profileError, setProfileError] = useState(null);
  if (!league) return null;
  const table = standings(league);
  const user = clubById(league, league.userClubId);
  const fx = userFixture(league);
  const over = seasonOver(league);
  const total = league.fixtures.length;
  const lastWeek = league.week > 0 ? league.fixtures[league.week - 1] : null;
  const thisWeek = !over ? league.fixtures[league.week] : null;
  const name = (id) => clubById(league, id).name;

  function saveProfile() {
    try {
      onChange(updateProfile(league, editing));
      setEditing(null);
      setProfileError(null);
    } catch (e) {
      setProfileError(profileErrText(e.message));
    }
  }

  function act(fn) {
    const r = fn();
    if (r.error) setMsg(r.error);
    else {
      setMsg(null);
      onChange(r.league);
    }
  }

  const slots = getFormation(getStyle(user.style).formation);
  const byUid = new Map(user.players.map((p) => [p.uid, p]));
  const starters = new Set(Object.values(user.lineup));
  const bench = user.players.filter((p) => !starters.has(p.uid)).sort((a, b) => overall(b) - overall(a));

  return (
    <div className="league">
      <section className="league-head">
        <div>
          <h3>
            {t('Musim {s} · Pekan {w}/{n}', { s: league.season, w: Math.min(league.week + 1, total), n: total })}
          </h3>
          <p className="league-sub">
            <ClubLogo logo={league.profile.logo} size={18} title={user.name} /> {user.name} · {t('Manajer')}: {league.profile.managerName} · {t('anggaran')} <b>{t('{n} jt', { n: league.budget })}</b> · {t('pemasukan {n} jt/pekan', { n: LEAGUE.weeklyIncome })}
          </p>
        </div>
        {!over && fx && (
          <div className="league-next">
            <span>
              {t('Laga berikutnya')}: <b>{name(fx.home)}</b> vs <b>{name(fx.away)}</b> ({fx.home === user.id ? t('kandang') : t('tandang')}) · {t('lawan bergaya')}{' '}
              {t(CLUB_STYLES[clubById(league, fx.home === user.id ? fx.away : fx.home).style].label).toLowerCase()}
            </span>
            <button type="button" className="break-button" onClick={onGoMatch}>
              {t('Ke laga')}
            </button>
          </div>
        )}
        {over && (
          <div className="league-next">
            <span>
              🏆 {t('Juara musim {s}', { s: league.season })}: <b>{table[0].name}</b> · {t('{c} finis ke-{p}', { c: user.name, p: table.findIndex((r) => r.id === user.id) + 1 })}
            </span>
            <button type="button" className="break-button" onClick={() => onChange(newSeason(league))}>
              {t('Mulai musim {s}', { s: league.season + 1 })}
            </button>
          </div>
        )}
      </section>

      <section aria-label={t('Klasemen')}>
        <h4>{t('Klasemen')}</h4>
        <div className="table-wrap">
          <table className="league-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="l">{t('Klub')}</th>
                <th>{t('Main')}</th>
                <th>{t('M')}</th>
                <th>{t('S')}</th>
                <th>{t('K')}</th>
                <th>{t('Gol')}</th>
                <th>{t('SG')}</th>
                <th>{t('Poin')}</th>
                <th className="l">{t('5 terakhir')}</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => {
                const c = clubById(league, r.id);
                return (
                  <tr key={r.id} className={r.id === user.id ? 'is-user' : undefined}>
                    <td>{i + 1}</td>
                    <td className="l">
                      {c.id === user.id ? (
                        <ClubLogo logo={league.profile.logo} size={16} title={r.name} />
                      ) : (
                        <span className="team-swatch" style={{ background: c.colors.shirt }} />
                      )}{' '}
                      {r.name}
                    </td>
                    <td>{r.p}</td>
                    <td>{r.w}</td>
                    <td>{r.d}</td>
                    <td>{r.l}</td>
                    <td>
                      {r.gf}–{r.ga}
                    </td>
                    <td>{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
                    <td>
                      <b>{r.pts}</b>
                    </td>
                    <td className="l form">
                      {r.form.map((f, k) => (
                        <span key={k} className={`form-${f}`}>
                          {getLang() === 'en' ? FORM_EN[f] : f}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="league-weeks">
        {lastWeek && (
          <div>
            <h4>{t('Hasil pekan {n}', { n: league.week })}</h4>
            <ul className="fixture-list">
              {lastWeek.map((f) => (
                <li key={`${f.home}-${f.away}`} className={f.home === user.id || f.away === user.id ? 'is-user' : undefined}>
                  <span>{name(f.home)}</span>
                  <b>
                    {f.result.home} – {f.result.away}
                  </b>
                  <span>{name(f.away)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {thisWeek && (
          <div>
            <h4>{t('Jadwal pekan {n}', { n: league.week + 1 })}</h4>
            <ul className="fixture-list">
              {thisWeek.map((f) => (
                <li key={`${f.home}-${f.away}`} className={f.home === user.id || f.away === user.id ? 'is-user' : undefined}>
                  <span>{name(f.home)}</span>
                  <b>vs</b>
                  <span>{name(f.away)}</span>
                </li>
              ))}
            </ul>
            <p className="tac-note">{t('Laga klub lain dihitung cepat dari kekuatan skuad saat pekan ditutup.')}</p>
          </div>
        )}
      </section>

      {msg && (
        <p className="script-warn" role="status">
          ⚠️ {errText(msg)}
        </p>
      )}
      {locked && <p className="zone-notice">{t('Laga liga sedang berjalan — skuad & bursa terkunci sampai peluit akhir.')}</p>}

      <section aria-label={t('Skuad')}>
        <h4>
          {t('Skuad')} ({user.players.length}/{LEAGUE.squadMax}) · {t('nilai = rata-rata stat')}
        </h4>
        <ul className="squad-list">
          {slots.map((s) => {
            const p = byUid.get(user.lineup[s.number]);
            return (
              <li key={s.number}>
                <span className="squad-num">{s.number}</span>
                <span className="squad-role">{s.role}</span>
                <span className="squad-name">
                  {p.fullName} <small>({p.role})</small>
                </span>
                <span className="squad-val">{fmt(overall(p))}</span>
                <select
                  aria-label={t('Ganti pemain nomor {n}', { n: s.number })}
                  value=""
                  disabled={locked}
                  onChange={(e) => e.target.value && onChange(setStarter(league, s.number, e.target.value))}
                >
                  <option value="">{t('ganti…')}</option>
                  {bench.map((b) => (
                    <option key={b.uid} value={b.uid}>
                      {b.shortName} ({b.role}, {fmt(overall(b))})
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
        <h5>{t('Cadangan (7 teratas ikut ke laga)')}</h5>
        <ul className="squad-list">
          {bench.map((p, i) => (
            <li key={p.uid} className={i >= LEAGUE.benchInMatch ? 'is-out' : undefined}>
              <span className="squad-num">{i < LEAGUE.benchInMatch ? 'C' : '–'}</span>
              <span className="squad-role">{p.role}</span>
              <span className="squad-name">{p.fullName}</span>
              <span className="squad-val">{fmt(overall(p))}</span>
              <button type="button" className="link-btn" disabled={locked} onClick={() => act(() => sellPlayer(league, p.uid))}>
                {t('jual {n} jt', { n: Math.round(playerValue(p) * LEAGUE.sellRate) })}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('Bursa')}>
        <h4>{t('Bursa pemain bebas (berganti sebagian tiap pekan)')}</h4>
        <ul className="squad-list">
          {[...league.market.players]
            .sort((a, b) => overall(b) - overall(a))
            .map((p) => (
              <li key={p.uid}>
                <span className="squad-num">·</span>
                <span className="squad-role">{p.role}</span>
                <span className="squad-name">{p.fullName}</span>
                <span className="squad-val">{fmt(overall(p))}</span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={locked || playerValue(p) > league.budget}
                  onClick={() => act(() => buyPlayer(league, p.uid))}
                >
                  {t('beli {n} jt', { n: playerValue(p) })}
                </button>
              </li>
            ))}
        </ul>
      </section>

      <section aria-label={t('Profil klub')}>
        <h4>{t('Profil klub')}</h4>
        {editing ? (
          <>
            <ProfileEditor value={editing} onChange={setEditing} disabled={locked} />
            {profileError && <p className="script-warn">⚠️ {profileError}</p>}
            <div className="script-actions">
              <button type="button" className="lane-reset" onClick={() => (setEditing(null), setProfileError(null))}>
                {t('Batal')}
              </button>
              <button type="button" className="break-button" disabled={locked} onClick={saveProfile}>
                {t('Simpan profil')}
              </button>
            </div>
          </>
        ) : (
          <div className="profile-row">
            <ClubLogo logo={league.profile.logo} size={48} title={user.name} />
            <div>
              <b>{user.name}</b>
              <div className="league-sub">
                {t('Manajer')}: {league.profile.managerName}
              </div>
            </div>
            <button
              type="button"
              className="link-btn"
              disabled={locked}
              onClick={() => setEditing({ clubName: user.name, managerName: league.profile.managerName, logo: league.profile.logo })}
            >
              {t('ubah nama, manajer & logo')}
            </button>
          </div>
        )}
        <p className="tac-note">{t('Progres karier disimpan otomatis di perangkat ini. Karier baru atau slot lain: lewat Menu utama.')}</p>
      </section>
    </div>
  );
}
