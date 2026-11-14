import { useState } from 'react';
import { getStyle } from '../engine/clubStyles.js';
import { getFormation } from '../engine/formations.js';
import { LEAGUE, clubById, overall, playerValue, buyPlayer, sellPlayer, setStarter, roleGroup } from '../engine/league.js';
import { MARKET_GROUPS, MARKET_SORTS, BLOCK, marketRows, squadCounts, strengths } from '../engine/market.js';
import { t, tk, getLang } from '../i18n.js';

// Tab "Skuad & bursa" (14 Nov): dipisah dari tab Liga supaya klasemen tidak perlu digulir.
//   kiri  = susunan inti + cadangan (jual)
//   kanan = bursa: saring posisi, urutkan, bandingkan dengan inti terlemah, beli dengan konfirmasi

const ERR_EN = [
  [/^Anggaran kurang \(butuh (\d+) jt, ada (\d+) jt\)$/, 'Not enough budget (need $1 M, have $2 M)'],
  [/^Skuad penuh \(maks (\d+)\)$/, 'Squad full (max $1)'],
  [/^Pemain inti tidak bisa dijual — ganti dulu dari susunan$/, 'Starters cannot be sold — take them out of the line-up first'],
  [/^Skuad minimal (\d+) pemain$/, 'Squad needs at least $1 players'],
];
const errText = (m) => (getLang() === 'en' ? ERR_EN.reduce((s, [re, en]) => s.replace(re, en), m) : m);
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

const GROUP_LABEL = { semua: tk('Semua'), GK: tk('Kiper'), DF: tk('Belakang'), MF: tk('Tengah'), FW: tk('Depan') };
const SORT_LABEL = { nilai: tk('Nilai'), harga: tk('Harga termurah'), selisih: tk('Paling menambah inti') };
const BLOCK_LABEL = { [BLOCK.locked]: tk('terkunci saat laga'), [BLOCK.full]: tk('skuad penuh'), [BLOCK.budget]: tk('anggaran kurang') };
const STAT_LABEL = {
  kecepatan: tk('Kecepatan'),
  akselerasi: tk('Akselerasi'),
  kelincahan: tk('Kelincahan'),
  stamina: tk('Stamina'),
  kekuatan: tk('Kekuatan'),
  duelUdara: tk('Duel udara'),
  passing: tk('Operan'),
  kontrol: tk('Kontrol'),
  dribbling: tk('Dribel'),
  finishing: tk('Penyelesaian'),
  tackling: tk('Tekel'),
  visi: tk('Visi'),
  keputusan: tk('Keputusan'),
  posisi: tk('Posisi'),
  antisipasi: tk('Antisipasi'),
  refleks: tk('Refleks'),
  penempatan: tk('Penempatan'),
  tangkapan: tk('Tangkapan'),
};
const strengthText = (p) =>
  strengths(p)
    .map(([k, v]) => `${STAT_LABEL[k] ? t(STAT_LABEL[k]) : k} ${v}`)
    .join(' · ');

function DeltaChip({ delta }) {
  if (delta === null) return null;
  const tone = delta >= 0.5 ? 'up' : delta <= -0.5 ? 'down' : 'flat';
  const text = tone === 'up' ? t('+{n} vs inti terlemah', { n: fmt(delta) }) : tone === 'down' ? t('{n} vs inti terlemah', { n: fmt(delta) }) : t('setara inti terlemah');
  return <span className={`delta-chip delta-chip--${tone}`}>{text}</span>;
}

export default function SquadMarketTab({ league, onChange, locked }) {
  const [msg, setMsg] = useState(null);
  const [group, setGroup] = useState('semua');
  const [sort, setSort] = useState('nilai');
  const [confirm, setConfirm] = useState(null); // { kind: 'buy'|'sell', uid } | null
  if (!league) return null;

  const user = clubById(league, league.userClubId);
  const slots = getFormation(getStyle(user.style).formation);
  const byUid = new Map(user.players.map((p) => [p.uid, p]));
  const starters = new Set(Object.values(user.lineup));
  const bench = user.players.filter((p) => !starters.has(p.uid)).sort((a, b) => overall(b) - overall(a));
  const rows = marketRows(league, { group, sort, locked });
  const counts = squadCounts(league);

  function act(fn) {
    const r = fn();
    setConfirm(null);
    if (r.error) setMsg(r.error);
    else {
      setMsg(null);
      onChange(r.league);
    }
  }
  const asking = (kind, uid) => confirm?.kind === kind && confirm.uid === uid;

  return (
    <div className="squad-market">
      <header className="sm-head">
        <span>
          {t('Anggaran')} <b>{t('{n} jt', { n: league.budget })}</b> · {t('pemasukan {n} jt/pekan', { n: LEAGUE.weeklyIncome })}
        </span>
        <span>
          {t('Skuad')} <b>{user.players.length}/{LEAGUE.squadMax}</b> ({t('min {n}', { n: LEAGUE.squadMin })}) · GK {counts.GK} · DF {counts.DF} · MF {counts.MF} · FW {counts.FW}
        </span>
      </header>
      {locked && <p className="zone-notice">{t('Laga liga sedang berjalan — skuad & bursa terkunci sampai peluit akhir.')}</p>}
      {msg && (
        <p className="script-warn" role="status">
          ⚠️ {errText(msg)}
        </p>
      )}

      <div className="sm-columns">
        <section aria-label={t('Skuad')}>
          <h4>{t('Susunan inti')}</h4>
          <ul className="squad-list">
            {slots.map((s) => {
              const p = byUid.get(user.lineup[s.number]);
              if (!p) return null;
              return (
                <li key={s.number}>
                  <span className="squad-num">{s.number}</span>
                  <span className="squad-role">{s.role}</span>
                  <span className="squad-name">
                    {p.fullName} {roleGroup(p.role) !== roleGroup(s.role) && <small className="sub-warn">({p.role})</small>}
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
          <h4>{t('Cadangan (7 teratas ikut ke laga)')}</h4>
          <ul className="squad-list">
            {bench.map((p, i) => {
              const price = Math.round(playerValue(p) * LEAGUE.sellRate);
              return (
                <li key={p.uid} className={i >= LEAGUE.benchInMatch ? 'is-out' : undefined}>
                  <span className="squad-num">{i < LEAGUE.benchInMatch ? 'C' : '–'}</span>
                  <span className="squad-role">{p.role}</span>
                  <span className="squad-name">{p.fullName}</span>
                  <span className="squad-val">{fmt(overall(p))}</span>
                  {asking('sell', p.uid) ? (
                    <span className="sm-confirm">
                      <button type="button" className="link-btn" onClick={() => act(() => sellPlayer(league, p.uid))}>
                        {t('ya, jual')}
                      </button>
                      <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                        {t('Batal')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="link-btn" disabled={locked} onClick={() => setConfirm({ kind: 'sell', uid: p.uid })}>
                      {t('jual {n} jt', { n: price })}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label={t('Bursa')}>
          <h4>{t('Bursa pemain bebas')}</h4>
          <p className="tac-note">{t('{n} pemain berganti tiap pekan. Harga naik ±35% per poin nilai; jual dapat {p}% nilai.', { n: LEAGUE.marketRefresh, p: Math.round(LEAGUE.sellRate * 100) })}</p>
          <div className="sm-filters">
            <div className="tac-options" role="group" aria-label={t('Posisi')}>
              {MARKET_GROUPS.map((g) => (
                <button key={g} type="button" className={g === group ? 'is-active' : undefined} aria-pressed={g === group} onClick={() => setGroup(g)}>
                  {t(GROUP_LABEL[g])}
                </button>
              ))}
            </div>
            <label>
              {t('Urutkan')}{' '}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {MARKET_SORTS.map((k) => (
                  <option key={k} value={k}>
                    {t(SORT_LABEL[k])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="tac-note">{t('Tidak ada pemain di posisi ini minggu ini.')}</p>
          ) : (
            <ul className="market-list">
              {rows.map((r) => (
                <li key={r.player.uid} className="market-row">
                  <div className="market-row__main">
                    <span className="squad-role">{r.player.role}</span>
                    <span className="squad-name">{r.player.fullName}</span>
                    <span className="squad-val">{fmt(r.rating)}</span>
                  </div>
                  <div className="market-row__meta">
                    <DeltaChip delta={r.delta} />
                    <span className="market-row__stats">{strengthText(r.player)}</span>
                  </div>
                  <div className="market-row__buy">
                    {asking('buy', r.player.uid) ? (
                      <>
                        <button type="button" className="break-button" onClick={() => act(() => buyPlayer(league, r.player.uid))}>
                          {t('Beli {n} jt', { n: r.price })}
                        </button>
                        <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                          {t('Batal')}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="link-btn" disabled={r.block !== null} onClick={() => setConfirm({ kind: 'buy', uid: r.player.uid })}>
                        {t('beli {n} jt', { n: r.price })}
                      </button>
                    )}
                    {r.block && <small className="market-row__why">{t(BLOCK_LABEL[r.block])}</small>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
