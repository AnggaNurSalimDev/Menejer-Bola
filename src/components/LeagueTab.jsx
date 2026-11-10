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
} from '../engine/league.js';

// Tab Liga (10 Nov): klasemen, jadwal, skuad & bursa "seadanya". Semua perubahan lewat fungsi murni
// league.js; App yang menyimpan ke perangkat. `locked` = laga liga sedang berjalan (skuad dikunci).

const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

export default function LeagueTab({ league, onChange, locked, onGoMatch, onReset }) {
  const [msg, setMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  if (!league) return null;
  const table = standings(league);
  const user = clubById(league, league.userClubId);
  const fx = userFixture(league);
  const over = seasonOver(league);
  const total = league.fixtures.length;
  const lastWeek = league.week > 0 ? league.fixtures[league.week - 1] : null;
  const thisWeek = !over ? league.fixtures[league.week] : null;
  const name = (id) => clubById(league, id).name;

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
            Musim {league.season} · Pekan {Math.min(league.week + 1, total)}/{total}
          </h3>
          <p className="league-sub">
            {user.name} · anggaran <b>{league.budget} jt</b> · pemasukan {LEAGUE.weeklyIncome} jt/pekan
          </p>
        </div>
        {!over && fx && (
          <div className="league-next">
            <span>
              Laga berikutnya: <b>{name(fx.home)}</b> vs <b>{name(fx.away)}</b> ({fx.home === user.id ? 'kandang' : 'tandang'}) · lawan bergaya{' '}
              {CLUB_STYLES[clubById(league, fx.home === user.id ? fx.away : fx.home).style].label.toLowerCase()}
            </span>
            <button type="button" className="break-button" onClick={onGoMatch}>
              Ke laga
            </button>
          </div>
        )}
        {over && (
          <div className="league-next">
            <span>
              🏆 Juara musim {league.season}: <b>{table[0].name}</b> · {user.name} finis ke-{table.findIndex((r) => r.id === user.id) + 1}
            </span>
            <button type="button" className="break-button" onClick={() => onChange(newSeason(league))}>
              Mulai musim {league.season + 1}
            </button>
          </div>
        )}
      </section>

      <section aria-label="Klasemen">
        <h4>Klasemen</h4>
        <div className="table-wrap">
          <table className="league-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="l">Klub</th>
                <th>Main</th>
                <th>M</th>
                <th>S</th>
                <th>K</th>
                <th>Gol</th>
                <th>SG</th>
                <th>Poin</th>
                <th className="l">5 terakhir</th>
              </tr>
            </thead>
            <tbody>
              {table.map((r, i) => {
                const c = clubById(league, r.id);
                return (
                  <tr key={r.id} className={r.id === user.id ? 'is-user' : undefined}>
                    <td>{i + 1}</td>
                    <td className="l">
                      <span className="team-swatch" style={{ background: c.colors.shirt }} /> {r.name}
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
                          {f}
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
            <h4>Hasil pekan {league.week}</h4>
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
            <h4>Jadwal pekan {league.week + 1}</h4>
            <ul className="fixture-list">
              {thisWeek.map((f) => (
                <li key={`${f.home}-${f.away}`} className={f.home === user.id || f.away === user.id ? 'is-user' : undefined}>
                  <span>{name(f.home)}</span>
                  <b>vs</b>
                  <span>{name(f.away)}</span>
                </li>
              ))}
            </ul>
            <p className="tac-note">Laga klub lain dihitung cepat dari kekuatan skuad saat pekan ditutup.</p>
          </div>
        )}
      </section>

      {msg && (
        <p className="script-warn" role="status">
          ⚠️ {msg}
        </p>
      )}
      {locked && <p className="zone-notice">Laga liga sedang berjalan — skuad & bursa terkunci sampai peluit akhir.</p>}

      <section aria-label="Skuad">
        <h4>
          Skuad ({user.players.length}/{LEAGUE.squadMax}) · nilai = rata-rata stat
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
                  aria-label={`Ganti pemain nomor ${s.number}`}
                  value=""
                  disabled={locked}
                  onChange={(e) => e.target.value && onChange(setStarter(league, s.number, e.target.value))}
                >
                  <option value="">ganti…</option>
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
        <h5>Cadangan (7 teratas ikut ke laga)</h5>
        <ul className="squad-list">
          {bench.map((p, i) => (
            <li key={p.uid} className={i >= LEAGUE.benchInMatch ? 'is-out' : undefined}>
              <span className="squad-num">{i < LEAGUE.benchInMatch ? 'C' : '–'}</span>
              <span className="squad-role">{p.role}</span>
              <span className="squad-name">{p.fullName}</span>
              <span className="squad-val">{fmt(overall(p))}</span>
              <button type="button" className="link-btn" disabled={locked} onClick={() => act(() => sellPlayer(league, p.uid))}>
                jual {Math.round(playerValue(p) * LEAGUE.sellRate)} jt
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Bursa">
        <h4>Bursa pemain bebas (berganti sebagian tiap pekan)</h4>
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
                  beli {playerValue(p)} jt
                </button>
              </li>
            ))}
        </ul>
      </section>

      <p className="tac-note">
        Progres liga disimpan di perangkat ini.{' '}
        {confirmReset ? (
          <>
            Hapus liga ini?{' '}
            <button type="button" className="link-btn" onClick={() => (setConfirmReset(false), onReset())}>
              ya, mulai baru
            </button>{' '}
            <button type="button" className="link-btn" onClick={() => setConfirmReset(false)}>
              batal
            </button>
          </>
        ) : (
          <button type="button" className="link-btn" disabled={locked} onClick={() => setConfirmReset(true)}>
            Mulai liga baru
          </button>
        )}
      </p>
    </div>
  );
}
