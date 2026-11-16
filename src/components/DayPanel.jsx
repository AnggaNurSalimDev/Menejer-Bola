import { useEffect, useRef, useState } from 'react';
import { clubById, userFixture, seasonOver, clubLogo } from '../engine/league.js';
import { advanceDay, answerOffer, chooseAfterSack, isMatchDay, dayKind, nextUserMatch, prestige, strengthRank, boardTarget, CAREER, DAY } from '../engine/career.js';
import { getTemplate } from '../engine/tacticTemplates.js';
import { compLabel, roundLabel, dateLabel } from './compLabels.js';
import { absenceText } from './Status.jsx';
import ClubLogo from './ClubLogo.jsx';
import TrainingLoad from './TrainingLoad.jsx';
import { STAT_LABEL } from './SquadMarketTab.jsx';
import { t, tk } from '../i18n.js';

// Hari demi hari (16 Nov). Hari bergulir sendiri (± 3 hari/detik) dan berhenti saat ada event penting
// (cedera, tawaran, peringatan dewan, dipecat) atau hari laga. Tidak menyimpan sendiri: onChange(liga).
//
//   [▶ Lanjut] ─▶ advanceDay ─▶ onChange ─▶ … ─▶ stop? ─▶ tombol berhenti / kartu keputusan
//                                                └ hariLaga ─▶ [Ke laga]

const STEP_MS = 330;
const KIND_LABEL = { latihan: tk('latihan'), istirahat: tk('istirahat'), pemulihan: tk('pemulihan'), laga: tk('hari laga') };
const TARGET_LABEL = { juara: tk('juara liga'), atas: tk('papan atas'), tengah: tk('papan tengah'), bertahan: tk('bertahan di liga') };
const SESSION_LABEL = { bagus: tk('bagus'), biasa: tk('biasa'), buruk: tk('buruk') };

export const targetText = (expected) => t(TARGET_LABEL[boardTarget(expected)]);

export function diaryText(league, e) {
  const club = (id) => {
    try {
      return clubById(league, id).name;
    } catch {
      return id;
    }
  };
  switch (e.type) {
    case 'sakit':
    case 'izin':
    case 'cedera':
      return `${e.type === 'cedera' ? '🤕' : e.type === 'sakit' ? '🤒' : '✋'} ${e.name}: ${absenceText({ type: e.type, weeks: e.weeks, detail: e.detail })}`;
    case 'hasil':
      return `${e.gf > e.ga ? '✅' : e.gf < e.ga ? '❌' : '➖'} ${t('{c}: {gf}–{ga} vs {o}', { c: compLabel(e.comp), gf: e.gf, ga: e.ga, o: club(e.opp) })}`;
    case 'sesiTaktik':
      return `🧠 ${t('Sesi taktik {r}: pemahaman {tpl} +{g} → {f}%', { r: t(SESSION_LABEL[e.result]), tpl: e.template === 'kustom' ? t('taktik sendiri') : t(getTemplate(e.template).label), g: e.gain, f: Math.round(e.fam) })}`;
    case 'latihanHarian':
      return `🏃 ${t('Latihan {p}%', { p: e.load })}${Number.isFinite(e.gain) ? ` · ${t('perkembangan tim +{g}', { g: e.gain.toFixed(1) })}` : ''}: ${e.ups.length ? e.ups.map((u) => `${u.name} ${STAT_LABEL[u.stat] ? t(STAT_LABEL[u.stat]).toLowerCase() : u.stat} → ${u.to}`).join(', ') + (e.more ? ` ${t('(+{n} lagi)', { n: e.more })}` : '') : t('belum ada stat yang naik hari ini')}`;
    case 'istirahat':
      return `😴 ${t('Istirahat — kondisi pulih')}`;
    case 'sesiBatal':
      return `💤 ${e.why === 'istirahat' ? t('Sesi taktik dilewati — hari istirahat') : t('Sesi taktik dilewati — hari pemulihan setelah laga')}`;
    case 'tawaran':
      return `📨 ${t('Tawaran melatih {c}', { c: club(e.clubId) })}`;
    case 'tolak':
      return `🙅 ${t('Tawaran {c} ditolak', { c: club(e.clubId) })}`;
    case 'pindah':
      return `🤝 ${e.why === 'dipecat' ? t('Mulai melatih {c} setelah dipecat', { c: club(e.clubId) }) : t('Pindah melatih {c}', { c: club(e.clubId) })}`;
    case 'dipecat':
      return `🚪 ${t('Dipecat oleh {c}', { c: club(e.clubId) })}`;
    case 'peringatan':
      return `⚠️ ${t('Dewan mulai kehilangan kepercayaan ({n}%)', { n: Math.round(e.conf) })}`;
    case 'trofi':
      return `🏆 ${t('Trofi: {c}', { c: compLabel(e.comp, e.tier || null) })}`;
    case 'naik':
      return `⬆️ ${t('Promosi ke Liga {n}!', { n: e.tier })}`;
    case 'turun':
      return `⬇️ ${t('Terdegradasi ke Liga {n}', { n: e.tier })}`;
    case 'ujiSkema':
      return `🧪 ${t('Latihan uji skema "{n}": pemahaman +{g} → {f}%', { n: e.name, g: e.gain, f: Math.round(e.fam) })}`;
    case 'latihanSkema':
      return `🏋️ ${t('Latihan skema "{n}": {ok}/{r} berhasil · penguasaan +{g} → {m}', { n: e.name, ok: e.ok, r: e.reps, g: e.gain, m: Math.round(e.mastery) })}`;
    case 'akhirMusim':
      return `🏁 ${t('Musim selesai')}`;
    default:
      return `• ${e.type}`;
  }
}

function OfferCard({ league, onChange, locked }) {
  const p = league.career.pending;
  const cur = clubById(league, league.userClubId);
  const row = (id) => {
    const c = clubById(league, id);
    return { c, rank: strengthRank(league, id), pres: prestige(league, id) };
  };
  if (p.type === 'tawaran') {
    const o = row(p.clubId);
    const me = row(cur.id);
    return (
      <div className="day-decision">
        <h4>📨 {t('Tawaran melatih {c}', { c: o.c.name })}</h4>
        <table className="offer-compare">
          <thead>
            <tr>
              <th />
              <th>{t('Sekarang')}</th>
              <th>{t('Tawaran')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('Klub')}</td>
              <td>{cur.name}</td>
              <td>
                <ClubLogo logo={clubLogo(league, o.c.id)} size={14} title={o.c.name} /> {o.c.name}
              </td>
            </tr>
            <tr>
              <td>{t('Kasta')}</td>
              <td>{t('Liga {n}', { n: cur.tier })}</td>
              <td>{t('Liga {n}', { n: o.c.tier })}</td>
            </tr>
            <tr>
              <td>{t('Kekuatan skuad di kasta')}</td>
              <td>#{me.rank}</td>
              <td>#{o.rank}</td>
            </tr>
            <tr>
              <td>{t('Target dewan')}</td>
              <td>{targetText(league.career.board.expected)}</td>
              <td>{targetText(o.rank)}</td>
            </tr>
            <tr>
              <td>{t('Anggaran awal')}</td>
              <td>{t('{n} jt', { n: league.budget })}</td>
              <td>{t('{n} jt', { n: CAREER.switchBudget[o.c.tier] })}</td>
            </tr>
          </tbody>
        </table>
        <p className="tac-note">{t('Pindah = melatih skuad klub itu mulai hari ini (jadwal & ajangnya ikut). Taktik direset ke "taktik sendiri" dan pemahaman tim mulai dari awal. Rekam jejakmu ikut pindah.')}</p>
        <div className="guide-actions">
          <button type="button" className="lane-reset" disabled={locked} onClick={() => onChange(answerOffer(league, false))}>
            {t('Tolak')}
          </button>
          <button type="button" className="break-button" disabled={locked} onClick={() => onChange(answerOffer(league, true))}>
            {t('Terima & pindah')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="day-decision is-bad">
      <h4>🚪 {t('Kamu dipecat oleh {c}', { c: cur.name })}</h4>
      <p>{t('Hasil di bawah harapan dewan. Klub-klub ini bersedia mempekerjakanmu — pilih satu untuk melanjutkan karier:')}</p>
      <ul className="offer-list">
        {p.offers.map((id) => {
          const o = row(id);
          return (
            <li key={id}>
              <b>{o.c.name}</b> · {t('Liga {n}', { n: o.c.tier })} · {t('kekuatan #{r}', { r: o.rank })} · {t('target: {x}', { x: targetText(o.rank) })}{' '}
              <button type="button" className="break-button" disabled={locked} onClick={() => onChange(chooseAfterSack(league, id))}>
                {t('Latih klub ini')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function DayPanel({ league, onChange, onGoMatch, locked }) {
  const [auto, setAuto] = useState(false);
  const [lastStop, setLastStop] = useState(null);
  const leagueRef = useRef(league);
  leagueRef.current = league;
  const c = league.career;
  const matchDay = isMatchDay(league);
  const over = seasonOver(league);
  const canAdvance = !locked && !c.pending && !matchDay && !over;

  useEffect(() => {
    if (!auto) return undefined;
    if (!canAdvance) {
      setAuto(false);
      return undefined;
    }
    const id = setTimeout(() => {
      try {
        const r = advanceDay(leagueRef.current);
        onChange(r.league);
        if (r.stop) {
          setAuto(false);
          setLastStop(r.stop);
        }
      } catch (e) {
        setAuto(false);
        setLastStop(`error:${e.message}`);
      }
    }, STEP_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, league, canAdvance]);

  const step = () => {
    const r = advanceDay(league);
    onChange(r.league);
    setLastStop(r.stop);
  };

  const fx = userFixture(league);
  const nm = over ? null : nextUserMatch(league);
  const nextFx = nm?.fixture ?? null;
  const daysLeft = nm ? Math.round((nm.date - c.day) / DAY) : null;
  const opp = nextFx ? clubById(league, nextFx.home === league.userClubId ? nextFx.away : nextFx.home) : null;
  const kind = over ? null : dayKind(league);
  // Catatan sejak laga terakhir (maks 8).
  const recent = c.diary.filter((e) => c.lastMatchDay === null || e.day >= c.lastMatchDay).slice(0, 8);
  const tactic = new Set(c.tacticDays);

  return (
    <div className="day-panel">
      <div className="day-head">
        <span className="day-today">
          📅 <b>{dateLabel(c.day)}</b>
          {kind && <span className={`day-kind day-kind--${kind}`}>{t(KIND_LABEL[kind])}</span>}
          {kind === 'latihan' && tactic.has(new Date(c.day).getUTCDay()) && <span className="day-kind">🧠 {t('sesi taktik')}</span>}
        </span>
        {nm && !matchDay && (
          <span className="tac-note">
            {t('Laga berikutnya')}: {roundLabel(league.calendar[nm.index], clubById(league, league.userClubId).tier)} {t('vs')} <b>{opp.name}</b> · {dateLabel(nm.date, { year: false })} ({t('{n} hari lagi', { n: daysLeft })})
          </span>
        )}
        {!nm && !over && <span className="tac-note">{t('Klubmu sedang tidak ada jadwal — hari tetap berjalan sampai laga berikutnya.')}</span>}
      </div>

      {c.pending && <OfferCard league={league} onChange={onChange} locked={locked} />}

      {!c.pending && matchDay && (
        <div className="day-actions">
          <b>⚽ {t('Hari laga!')}</b> {t('vs')} {opp.name} ({fx.home === league.userClubId ? t('kandang') : t('tandang')})
          <button type="button" className="break-button" onClick={onGoMatch}>
            {t('Ke laga')}
          </button>
        </div>
      )}

      {!c.pending && !over && <TrainingLoad league={league} onChange={onChange} locked={locked} compact />}

      {!c.pending && !matchDay && !over && (
        <div className="day-actions">
          {auto ? (
            <button type="button" className="break-button" onClick={() => setAuto(false)}>
              ⏸ {t('Berhenti')}
            </button>
          ) : (
            <button type="button" className="break-button" disabled={!canAdvance} onClick={() => setAuto(true)}>
              ▶ {t('Lanjut ke laga')}
            </button>
          )}
          <button type="button" className="lane-reset" disabled={!canAdvance || auto} onClick={step}>
            +1 {t('hari')}
          </button>
          {lastStop && !auto && STOP_NOTE[lastStop] && <small className="sub-warn">{t(STOP_NOTE[lastStop])}</small>}
          {lastStop?.startsWith('error:') && <small className="neg">{lastStop.slice(6)}</small>}
        </div>
      )}

      {recent.length > 0 && (
        <ul className="day-feed">
          {recent.map((e, i) => (
            <li key={`${e.day}-${e.type}-${i}`} className={e.type === 'cedera' || e.type === 'dipecat' || e.type === 'peringatan' ? 'is-bad' : e.type === 'sesiTaktik' && e.result === 'bagus' ? 'is-good' : undefined}>
              <small>{dateLabel(e.day, { year: false })}</small> {diaryText(league, e)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STOP_NOTE = {
  cedera: tk('Berhenti: ada pemain cedera di latihan.'),
  peringatan: tk('Berhenti: peringatan dari dewan.'),
};

