import { useState } from 'react';
import { CLUB_STYLES } from '../engine/clubStyles.js';
import {
  standings,
  userFixture,
  clubById,
  seasonOver,
  updateProfile,
  clubLogo,
  wageBill,
  absentPlayers,
  currentRound,
  eliteTables,
  SEASON_ROUNDS,
  TIERS,
  topPlayers,
} from '../engine/league.js';
import { DEV } from '../engine/development.js';
import { stagesOf, roundDate } from '../engine/calendar.js';
import { compLabel, stageLabel, roundLabel, scoreText, dateLabel } from './compLabels.js';
import { newsText, AbsenceBadge } from './Status.jsx';
import ClubLogo from './ClubLogo.jsx';
import DayPanel from './DayPanel.jsx';
import ManagerView from './ManagerView.jsx';
import { startSeason } from '../engine/career.js';
import ProfileEditor from './ProfileEditor.jsx';
import { t, tk, getLang } from '../i18n.js';

const FORM_EN = { M: 'W', S: 'D', K: 'L' };
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

// Tab Kompetisi (10 Nov; 3 kasta & piala 15 Nov): kepala musim, kabar klub, lalu satu tampilan pilihan
// (klasemen tiap kasta, tiap piala, Elite, jadwal saya, sejarah juara), lalu profil klub.
// Semua perubahan lewat fungsi murni league.js; App yang menyimpan. `locked` = laga liga sedang berjalan.

const VIEWS = ['liga', 'nasional', 'ligaCup', 'elite', 'super', 'jadwal', 'manajer', 'sejarah'];
const VIEW_LABEL = { jadwal: tk('Jadwal saya'), sejarah: tk('Sejarah juara'), manajer: tk('Profil manajer') };

function FixtureRow({ league, f, userId }) {
  const name = (id) => clubById(league, id).name;
  return (
    <li className={f.home === userId || f.away === userId ? 'is-user' : undefined}>
      <span>
        {name(f.home)} <ClubLogo logo={clubLogo(league, f.home)} size={14} />
      </span>
      <b>{scoreText(f.result)}</b>
      <span>
        <ClubLogo logo={clubLogo(league, f.away)} size={14} /> {name(f.away)}
      </span>
    </li>
  );
}

function TableView({ league, rows, userId, zones = () => '' }) {
  return (
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
          {rows.map((r, i) => (
            <tr key={r.id} className={[r.id === userId ? 'is-user' : '', zones(i, rows.length)].filter(Boolean).join(' ') || undefined}>
              <td>{i + 1}</td>
              <td className="l">
                <ClubLogo logo={clubLogo(league, r.id)} size={16} title={r.name} /> {r.name}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Zona warna klasemen: Elite (Liga 1), naik langsung, play-off, degradasi.
const zoneFor = (tier) => (i, n) => {
  if (tier === 1 && i < 4) return 'zone-elite';
  if (tier > 1 && i < 2) return 'zone-up';
  if (tier > 1 && i >= 2 && i < 6) return 'zone-playoff';
  if (tier < 3 && i >= n - 3) return 'zone-down';
  return '';
};

// Top skor, assist, rating satu ajang (15 Nov).
const AWARD_LABEL = { terbaik: tk('Pemain terbaik'), topskor: tk('Top skor'), kiper: tk('Kiper terbaik'), muda: tk('Pemain muda terbaik') };
function TopLists({ league, statKey, userId }) {
  const table = league.pstats?.[statKey] ?? {};
  const maxApps = Object.values(table).reduce((m, r) => Math.max(m, r[0]), 0);
  if (maxApps === 0) return null;
  const minApps = Math.max(1, Math.round(maxApps / 3));
  const lists = [
    [tk('Top skor'), topPlayers(league, statKey, 'goals', { limit: 8 }), (r) => r.goals],
    [tk('Assist'), topPlayers(league, statKey, 'assists', { limit: 8 }), (r) => r.assists],
    [tk('Rating rata-rata'), topPlayers(league, statKey, 'rating', { limit: 8, minApps }), (r) => r.rating.toFixed(2)],
  ];
  return (
    <div className="top-lists">
      {lists.map(([label, rows, val]) => (
        <div key={label}>
          <h5>{t(label)}</h5>
          {rows.length === 0 ? (
            <p className="tac-note">–</p>
          ) : (
            <ol className="top-list">
              {rows.map((r) => (
                <li key={r.uid} className={r.clubId === userId ? 'is-user' : undefined}>
                  <ClubLogo logo={clubLogo(league, r.clubId)} size={14} /> <span>{r.player.shortName}</span>
                  <small>{t('{n} laga', { n: r.apps })}</small>
                  <b>{val(r)}</b>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
      <p className="tac-note">{t('Rating: minimal {n} laga. Laga klub lain dihitung cepat, jadi gol & rating mereka perkiraan.', { n: minApps })}</p>
    </div>
  );
}

function CupView({ league, comp, userId }) {
  const rounds = league.calendar.filter((r) => r.comp === comp && r.fixtures && !(comp === 'elite' && r.stage.startsWith('G')));
  const stages = stagesOf(comp).filter((st) => !(comp === 'elite' && st.startsWith('G')));
  const pending = stages.filter((st) => !rounds.some((r) => r.stage === st));
  return (
    <div className="cup-view">
      {[...rounds].reverse().map((r) => (
        <div key={r.stage}>
          <h5>
            {stageLabel(r.stage)} · {dateLabel(roundDate(league.season, league.calendar.indexOf(r)))}
          </h5>
          <ul className="fixture-list">
            {[...r.fixtures]
              .sort((a, b) => (b.home === userId || b.away === userId) - (a.home === userId || a.away === userId))
              .map((f) => (
                <FixtureRow key={`${f.home}-${f.away}`} league={league} f={f} userId={userId} />
              ))}
          </ul>
        </div>
      ))}
      <TopLists league={league} statKey={comp} userId={userId} />
      {pending.length > 0 && (
        <p className="tac-note">
          {t('Belum diundi')}:{' '}
          {pending
            .map((st) => `${stageLabel(st)} (${dateLabel(roundDate(league.season, league.calendar.findIndex((r) => r.comp === comp && r.stage === st)), { year: false })})`)
            .join(' · ')}
        </p>
      )}
    </div>
  );
}

function EliteView({ league, userId }) {
  const tables = eliteTables(league);
  return (
    <div className="cup-view">
      <p className="tac-note">{t('4 teratas Liga 1 musim lalu (musim pertama: 4 klub terkuat) + 12 klub luar negeri. Dua teratas tiap grup lolos ke perempat final.')}</p>
      <div className="elite-groups">
        {tables.map((rows, gi) => (
          <div key={gi}>
            <h5>{t('Grup {g}', { g: 'ABCD'[gi] })}</h5>
            <TableView league={league} rows={rows} userId={userId} zones={(i) => (i < 2 ? 'zone-up' : '')} />
          </div>
        ))}
      </div>
      <CupView league={league} comp="elite" userId={userId} />
    </div>
  );
}

function MySchedule({ league, userId }) {
  const rows = league.calendar
    .map((r, i) => ({ r, i, f: (r.fixtures ?? []).find((f) => f.home === userId || f.away === userId) }))
    .filter((x) => x.f);
  const tier = clubById(league, userId).tier;
  return (
    <ul className="schedule-list">
      {rows.map(({ r, i, f }) => {
        const home = f.home === userId;
        const opp = home ? f.away : f.home;
        const res = f.result;
        const mine = res ? (home ? res.home : res.away) : null;
        const theirs = res ? (home ? res.away : res.home) : null;
        const outcome = !res ? '' : mine > theirs ? 'M' : mine < theirs ? 'K' : 'S';
        return (
          <li key={i} className={i === league.week ? 'is-now' : undefined}>
            <small>
              {dateLabel(roundDate(league.season, i), { year: false })} · {roundLabel(r, tier)}
            </small>
            <span>
              {home ? t('kandang') : t('tandang')} · <ClubLogo logo={clubLogo(league, opp)} size={14} /> {clubById(league, opp).name}
            </span>
            <b className={outcome ? `form-${outcome}` : undefined}>{res ? scoreText(home ? res : { home: res.away, away: res.home, pens: res.pens && { home: res.pens.away, away: res.pens.home } }) : '–'}</b>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryView({ league }) {
  if (league.history.length === 0) return <p className="tac-note">{t('Belum ada juara — musim pertama masih berjalan.')}</p>;
  const seasons = [...new Set(league.history.map((h) => h.season))].sort((a, b) => b - a);
  return (
    <ul className="history-list">
      {seasons.map((s) => (
        <li key={s}>
          <b>{t('Musim {s}', { s })}</b>
          {league.history
            .filter((h) => h.season === s && h.comp !== 'award')
            .map((h, i) => (
              <span key={i}>
                🏆 {compLabel(h.comp, h.comp === 'liga' ? h.tier : null)}: {h.name}
              </span>
            ))}
          {league.history
            .filter((h) => h.season === s && h.comp === 'award')
            .map((h, i) => (
              <span key={`a${i}`} className="award">
                🎖️ {t(AWARD_LABEL[h.kind])} {t('Liga {n}', { n: h.tier })}: {h.name} ({h.club}) · {h.kind === 'topskor' ? t('{n} gol', { n: h.value }) : `⭐ ${Number(h.value).toFixed(2)}`}
              </span>
            ))}
        </li>
      ))}
    </ul>
  );
}

export default function LeagueTab({ league, onChange, locked, onGoMatch }) {
  const [editing, setEditing] = useState(null); // profil yang sedang diubah | null
  const [profileError, setProfileError] = useState(null);
  const [view, setView] = useState('liga');
  const [tierView, setTierView] = useState(null);
  if (!league) return null;
  const user = clubById(league, league.userClubId);
  const tier = tierView ?? user.tier;
  if (!TIERS.includes(tier)) throw new RangeError(`LeagueTab: kasta ${tier} tidak ada`);
  const table = standings(league, tier);
  const fx = userFixture(league);
  const over = seasonOver(league);
  const round = currentRound(league);
  const name = (id) => clubById(league, id).name;
  const lastLeague = [...league.calendar.slice(0, league.week)].reverse().find((r) => r.comp === 'liga');
  const ownTable = standings(league, user.tier);
  const tiredCount = Object.values(user.lineup).map((u) => user.players.find((p) => p.uid === u)).filter((p) => p && !p.absence && (p.fit ?? 100) < DEV.tiredBelow).length;
  const playoff = league.calendar.filter((r) => r.comp === 'playoff' && r.fixtures).flatMap((r) => r.fixtures.filter((f) => f.tier === tier).map((f) => ({ ...f, stage: r.stage })));

  function saveProfile() {
    try {
      onChange(updateProfile(league, editing));
      setEditing(null);
      setProfileError(null);
    } catch (e) {
      setProfileError(profileErrText(e.message));
    }
  }

  return (
    <div className="league">
      <section className="league-head">
        <div>
          <h3>
            {t('Musim {s} · Babak {w}/{n}', { s: league.season, w: Math.min(league.week + 1, SEASON_ROUNDS), n: SEASON_ROUNDS })}
            {round && (
              <small className="round-tag">
                {' '}
                · {roundLabel(round, user.tier)} · 📅 {dateLabel(roundDate(league.season, league.week))}
              </small>
            )}
          </h3>
          <p className="league-sub">
            <ClubLogo logo={league.profile.logo} size={18} title={user.name} /> {user.name} · {t('Liga {n}', { n: user.tier })} · {t('Manajer')}: {league.profile.managerName} · {t('anggaran')}{' '}
            <b>{t('{n} jt', { n: league.budget })}</b> · {t('pemasukan {n} jt/pekan', { n: league.income })} · {t('gaji {n} jt/pekan', { n: wageBill(user) })}
          </p>
        </div>
        {!over && (
          <div className="league-next">
            {fx && tiredCount > 0 && <small className="sub-warn">⚠️ {t('{n} pemain inti kondisinya di bawah {p}% — cek tab Skuad', { n: tiredCount, p: DEV.tiredBelow })}</small>}
            {fx && (
              <span className="tac-note">
                {t('lawan bergaya')} {t(CLUB_STYLES[clubById(league, fx.home === user.id ? fx.away : fx.home).style].label).toLowerCase()}
              </span>
            )}
          </div>
        )}
        {over && (
          <div className="league-next">
            <span>
              🏆 {t('Juara Liga {n}', { n: user.tier })}: <b>{ownTable[0].name}</b> · {t('{c} finis ke-{p}', { c: user.name, p: ownTable.findIndex((r) => r.id === user.id) + 1 })}
            </span>
            <button type="button" className="break-button" disabled={locked || Boolean(league.career.pending)} onClick={() => onChange(startSeason(league))}>
              {t('Mulai musim {s}', { s: league.season + 1 })}
            </button>
          </div>
        )}
      </section>

      {!over && <DayPanel league={league} onChange={onChange} onGoMatch={onGoMatch} locked={locked} />}
      {over && league.career.pending && <DayPanel league={league} onChange={onChange} onGoMatch={onGoMatch} locked={locked} />}

      {(league.news.length > 0 || absentPlayers(user).length > 0) && (
        <section className="league-news" aria-label={t('Kabar klub')}>
          <h4>{t('Kabar klub')}</h4>
          {absentPlayers(user).length > 0 && (
            <p className="league-sub">
              {t('Absen sekarang')}:{' '}
              {absentPlayers(user).map((p) => (
                <span key={p.uid} className="news-absent">
                  {p.shortName} <AbsenceBadge absence={p.absence} />
                </span>
              ))}
            </p>
          )}
          <ul className="news-list">
            {league.news.slice(0, 6).map((n, i) => (
              <li key={`${n.uid}-${n.week}-${n.season ?? ''}-${i}`}>
                <small>{n.season ? t('Musim {s}', { s: n.season }) : t('Babak {w}', { w: n.week })}</small> {newsText(n)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="comp-nav" aria-label={t('Kompetisi')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" className={v === view ? 'is-active' : undefined} aria-pressed={v === view} onClick={() => setView(v)}>
            {VIEW_LABEL[v] ? t(VIEW_LABEL[v]) : compLabel(v)}
          </button>
        ))}
      </nav>

      {view === 'liga' && (
        <section aria-label={t('Klasemen')}>
          <div className="tac-options tier-tabs">
            {TIERS.map((n) => (
              <button key={n} type="button" className={n === tier ? 'is-active' : undefined} aria-pressed={n === tier} onClick={() => setTierView(n)}>
                {t('Liga {n}', { n })}
              </button>
            ))}
          </div>
          <TableView league={league} rows={table} userId={user.id} zones={zoneFor(tier)} />
          <p className="zone-legend">
            {tier === 1 && <span className="zone-elite">{t('Kejuaraan Elite musim depan')}</span>}
            {tier > 1 && <span className="zone-up">{t('Naik langsung')}</span>}
            {tier > 1 && <span className="zone-playoff">{t('Play-off promosi')}</span>}
            {tier < 3 && <span className="zone-down">{t('Degradasi')}</span>}
          </p>
          <TopLists league={league} statKey={`liga${tier}`} userId={user.id} />
          {playoff.length > 0 && (
            <>
              <h5>{compLabel('playoff')}</h5>
              <ul className="fixture-list">
                {playoff.map((f) => (
                  <FixtureRow key={`${f.stage}-${f.home}`} league={league} f={f} userId={user.id} />
                ))}
              </ul>
            </>
          )}
          {lastLeague && (
            <>
              <h5>
                {t('Hasil')} · {stageLabel(lastLeague.stage)}
              </h5>
              <ul className="fixture-list">
                {lastLeague.fixtures
                  .filter((f) => f.tier === tier)
                  .map((f) => (
                    <FixtureRow key={`${f.home}-${f.away}`} league={league} f={f} userId={user.id} />
                  ))}
              </ul>
            </>
          )}
          <p className="tac-note">{t('Laga klub lain dihitung cepat dari kekuatan skuad saat pekan ditutup.')}</p>
        </section>
      )}
      {(view === 'nasional' || view === 'ligaCup' || view === 'super') && <CupView league={league} comp={view} userId={user.id} />}
      {view === 'elite' && <EliteView league={league} userId={user.id} />}
      {view === 'jadwal' && <MySchedule league={league} userId={user.id} />}
      {view === 'sejarah' && <HistoryView league={league} />}
      {view === 'manajer' && <ManagerView league={league} />}

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
