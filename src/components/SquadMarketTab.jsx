import { useState } from 'react';
import { getStyle } from '../engine/clubStyles.js';
import { getFormation } from '../engine/formations.js';
import { LEAGUE, clubById, overall, playerValue, buyPlayer, sellPlayer, setStarter, roleGroup, isAvailable, effectiveLineup, matchBench, wageBill, wageFor, renewContract, renewWage, restTired, setTraining, seasonLine, roleReference } from '../engine/league.js';
import { potentialRange, DEV, TRAINING_FOCUS, TRAINING_INTENSITY } from '../engine/development.js';
import { AbsenceBadge, PotentialStars, FitBar } from './Status.jsx';
import FitChip from './FitChip.jsx';
import { getTemplate } from '../engine/tacticTemplates.js';
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
  [/^Kontrak sekarang sudah sepanjang itu$/, 'The current contract is already that long'],
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

const FOCUS_LABEL = { seimbang: tk('Seimbang'), serang: tk('Menyerang'), bertahan: tk('Bertahan'), fisik: tk('Fisik'), teknik: tk('Teknik'), taktik: tk('Taktik') };
const INTENSITY_LABEL = { ringan: tk('Ringan'), normal: tk('Normal'), berat: tk('Berat') };

// Baris kecil di bawah nama pemain: umur · potensi · kondisi · statistik musim ini.
function PlayerMeta({ league, p, withStats = true, fitKey = null, reference = null }) {
  const line = withStats ? seasonLine(league, p.uid) : null;
  return (
    <span className="player-meta">
      {t('{a} th', { a: p.age })} · <PotentialStars range={potentialRange(p)} /> <FitBar fit={p.fit} /> <FitChip templateKey={fitKey} player={p} reference={reference} />
      {line && line.apps > 0 && (
        <small>
          {' '}
          · {t('{n} laga', { n: line.apps })} · ⚽ {line.goals} · 🅰️ {line.assists} · ⭐ {line.rating.toFixed(1)}
        </small>
      )}
    </span>
  );
}

function DeltaChip({ delta }) {
  if (delta === null) return null;
  const tone = delta >= 0.5 ? 'up' : delta <= -0.5 ? 'down' : 'flat';
  const text = tone === 'up' ? t('+{n} vs inti terlemah', { n: fmt(delta) }) : tone === 'down' ? t('{n} vs inti terlemah', { n: fmt(delta) }) : t('setara inti terlemah');
  return <span className={`delta-chip delta-chip--${tone}`}>{text}</span>;
}

// part (14 Nov malam): 'squad' = tab Skuad (susunan, cadangan, kontrak), 'market' = tab Bursa — dipisah atas
// permintaan pengguna; kepala (anggaran, gaji, jumlah skuad) tampil di keduanya.
export default function SquadMarketTab({ league, onChange, locked, part = 'squad', fitKey = null }) {
  if (part !== 'squad' && part !== 'market') throw new RangeError(`SquadMarketTab: bagian tidak dikenal ${part}`);
  const [msg, setMsg] = useState(null);
  const [group, setGroup] = useState('semua');
  const [sort, setSort] = useState('nilai');
  const [confirm, setConfirm] = useState(null); // { kind: 'buy'|'sell', uid } | null
  if (!league) return null;

  const user = clubById(league, league.userClubId);
  const slots = getFormation(getStyle(user.style).formation);
  const byUid = new Map(user.players.map((p) => [p.uid, p]));
  const starters = new Set(Object.values(user.lineup));
  const bench = user.players.filter((p) => !starters.has(p.uid)).sort((a, b) => isAvailable(b) - isAvailable(a) || overall(b) - overall(a));
  const { lineup: playing, changes } = effectiveLineup(user, league.userFormation);
  const autoIn = new Map(changes.map((c) => [c.number, byUid.get(c.inUid)]));
  const travelling = new Set(matchBench(user, playing).map((p) => p.uid));
  const bill = wageBill(user);
  const net = Math.round((league.income - bill) * 10) / 10;
  const contracts = [...user.players].sort((a, b) => a.contract.seasons - b.contract.seasons || overall(b) - overall(a));
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
  const reference = roleReference(league, user.tier);
  const tired = slots.map((s) => byUid.get(user.lineup[s.number])).filter((p) => p && isAvailable(p) && (p.fit ?? 100) < DEV.tiredBelow);

  return (
    <div className="squad-market">
      <header className="sm-head">
        <span>
          {t('Anggaran')} <b className={league.budget < 0 ? 'neg' : undefined}>{t('{n} jt', { n: league.budget })}</b> · {t('pemasukan {n} jt/pekan', { n: league.income })} · {t('gaji {n} jt/pekan', { n: bill })} ·{' '}
          <b className={net < 0 ? 'neg' : 'pos'}>{t('bersih {n} jt/pekan', { n: net > 0 ? `+${net}` : net })}</b>
        </span>
        <span>
          {t('Skuad')} <b>{user.players.length}/{LEAGUE.squadMax}</b> ({t('min {n}', { n: LEAGUE.squadMin })}) · GK {counts.GK} · DF {counts.DF} · MF {counts.MF} · FW {counts.FW}
        </span>
      </header>
      {locked && <p className="zone-notice">{t('Laga liga sedang berjalan — skuad & bursa terkunci sampai peluit akhir.')}</p>}
      {fitKey && fitKey !== 'kustom' ? (
        <p className="tac-note">
          {t('Kecocokan dihitung untuk template: {n}', { n: t(getTemplate(fitKey).label) })}
          {fitKey !== league.tactic.template && ` (${t('pratinjau dari tab Taktik')})`}
        </p>
      ) : (
        <p className="tac-note">{t('Pilih template di tab Taktik untuk melihat kecocokan tiap pemain.')}</p>
      )}
      {msg && (
        <p className="script-warn" role="status">
          ⚠️ {errText(msg)}
        </p>
      )}

      <div className={`sm-columns sm-columns--${part}`}>
        {part === 'squad' && (
        <section aria-label={t('Skuad')}>
          <div className="training-box">
            <h4>{t('Latihan')}</h4>
            <div className="training-row">
              <span className="tac-label">{t('Fokus')}</span>
              <div className="tac-options">
                {TRAINING_FOCUS.map((f) => (
                  <button key={f} type="button" className={league.training.focus === f ? 'is-active' : undefined} aria-pressed={league.training.focus === f} onClick={() => onChange(setTraining(league, { focus: f }))}>
                    {t(FOCUS_LABEL[f])}
                  </button>
                ))}
              </div>
            </div>
            <div className="training-row">
              <span className="tac-label">{t('Intensitas')}</span>
              <div className="tac-options">
                {TRAINING_INTENSITY.map((k) => (
                  <button key={k} type="button" className={league.training.intensity === k ? 'is-active' : undefined} aria-pressed={league.training.intensity === k} onClick={() => onChange(setTraining(league, { intensity: k }))}>
                    {t(INTENSITY_LABEL[k])}
                  </button>
                ))}
              </div>
            </div>
            <p className="tac-note">{t('Berat: pemain muda berkembang ±25% lebih cepat, tapi kondisi pulih lebih lambat (9%/hari, normal 11%, ringan 13%) dan cedera latihan lebih sering. Fokus mempercepat stat terkait. Perkembangan dihitung tiap awal bulan; pemain inti berkembang lebih cepat dari cadangan; mulai usia 30 stat fisik menurun.')}</p>
          </div>
          {tired.length > 0 && (
            <div className="zone-notice tired-row">
              <span>{t('{n} pemain inti kondisinya di bawah {p}%: {list}', { n: tired.length, p: DEV.tiredBelow, list: tired.map((p) => `${p.shortName} ${p.fit}%`).join(', ') })}</span>
              <button type="button" className="break-button" disabled={locked} onClick={() => act(() => restTired(league))}>
                {t('Istirahatkan yang lelah')}
              </button>
            </div>
          )}
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
                    {p.fullName} {roleGroup(p.role) !== roleGroup(s.role) && <small className="sub-warn">({p.role})</small>} <AbsenceBadge absence={p.absence} />
                    {autoIn.has(s.number) && <small className="auto-in">→ {t('diganti {p} otomatis', { p: autoIn.get(s.number).shortName })}</small>}
                    <PlayerMeta league={league} p={p} fitKey={fitKey} reference={reference} />
                  </span>
                  <span className="squad-val">{fmt(overall(p))}</span>
                  <select
                    aria-label={t('Ganti pemain nomor {n}', { n: s.number })}
                    value=""
                    disabled={locked}
                    onChange={(e) => e.target.value && onChange(setStarter(league, s.number, e.target.value))}
                  >
                    <option value="">{t('ganti…')}</option>
                    {bench.filter(isAvailable).map((b) => (
                      <option key={b.uid} value={b.uid}>
                        {b.shortName} ({b.role}, {fmt(overall(b))}, {b.fit}%)
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
          <h4>{t('Cadangan (7 teratas yang tersedia ikut ke laga)')}</h4>
          <ul className="squad-list">
            {bench.map((p) => {
              const price = Math.round(playerValue(p) * LEAGUE.sellRate);
              const goes = travelling.has(p.uid);
              return (
                <li key={p.uid} className={goes ? undefined : 'is-out'}>
                  <span className="squad-num">{goes ? 'C' : '–'}</span>
                  <span className="squad-role">{p.role}</span>
                  <span className="squad-name">
                    {p.fullName} <AbsenceBadge absence={p.absence} />
                    <PlayerMeta league={league} p={p} fitKey={fitKey} reference={reference} />
                  </span>
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
          <h4>{t('Kontrak')}</h4>
          <p className="tac-note">{t('Kontrak berkurang satu musim tiap pergantian musim. Pemain yang kontraknya habis pergi — perpanjang sebelum musim selesai. Gaji naik 10% saat diperpanjang.')}</p>
          <ul className="squad-list contract-list">
            {contracts.map((p) => (
              <li key={p.uid} className={p.contract.seasons === 1 ? 'is-expiring' : undefined}>
                <span className="squad-num">{p.contract.seasons}</span>
                <span className="squad-role">{p.role}</span>
                <span className="squad-name">
                  {p.fullName} <small>{t('{n} jt/pk', { n: p.contract.wage })}</small>
                  {p.contract.seasons === 1 && <small className="sub-warn"> {t('habis akhir musim')}</small>}
                </span>
                <span className="squad-val">{fmt(overall(p))}</span>
                <select
                  aria-label={t('Perpanjang kontrak {p}', { p: p.shortName })}
                  value=""
                  disabled={locked || p.contract.seasons >= LEAGUE.renewMax}
                  onChange={(e) => e.target.value && act(() => renewContract(league, p.uid, Number(e.target.value)))}
                >
                  <option value="">{t('perpanjang…')}</option>
                  {[1, 2, 3]
                    .filter((n) => n > p.contract.seasons && n <= LEAGUE.renewMax)
                    .map((n) => (
                      <option key={n} value={n}>
                        {t('{n} musim · {w} jt/pk', { n, w: renewWage(p) })}
                      </option>
                    ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
        )}

        {part === 'market' && (
        <section aria-label={t('Bursa')}>
          <h4>{t('Bursa pemain bebas')}</h4>
          <p className="tac-note">
            {t('{n} pemain berganti tiap pekan. Harga naik ±35% per poin nilai; jual dapat {p}% nilai.', { n: LEAGUE.marketRefresh, p: Math.round(LEAGUE.sellRate * 100) })}{' '}
            {t('Pemain yang dibeli dikontrak {n} musim.', { n: LEAGUE.buyContractSeasons })}
          </p>
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
                    <span className="market-row__stats">
                      {t('{a} th', { a: r.player.age })} · <PotentialStars range={potentialRange(r.player)} /> <FitChip templateKey={fitKey} player={r.player} reference={reference} />
                    </span>
                    <span className="market-row__stats">{strengthText(r.player)}</span>
                    <span className="market-row__stats">{t('gaji {n} jt/pekan', { n: wageFor(r.player) })}</span>
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
        )}
      </div>
    </div>
  );
}
