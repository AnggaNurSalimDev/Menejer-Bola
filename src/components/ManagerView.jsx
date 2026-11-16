import { careerSummary, currentStint, CAREER } from '../engine/career.js';
import { clubById, standings } from '../engine/league.js';
import { compLabel } from './compLabels.js';
import { targetText } from './DayPanel.jsx';
import { starText } from './Status.jsx';
import { t } from '../i18n.js';

// Profil manajer (16 Nov): reputasi, kepercayaan dewan, rekam jejak per klub, trofi.
//
//   reputasi 0–100 ─▶ bintang (÷20) — menentukan klub mana yang mau menawarimu
//   dewan: target dari peringkat kekuatan skuad · kepercayaan < 30 peringatan, < 15 dipecat

const pctBar = (v, tone) => (
  <span className={`fit-bar fit-bar--${tone}`}>
    <span className="fit-bar__track">
      <span style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
    </span>
  </span>
);

export default function ManagerView({ league }) {
  const c = league.career;
  const sum = careerSummary(league);
  const b = c.board;
  const table = standings(league);
  const pos = table.findIndex((r) => r.id === league.userClubId) + 1;
  const played = table[pos - 1]?.p ?? 0;
  const confTone = b.conf < CAREER.board.sackBelow + 10 ? 'low' : b.conf < 50 ? 'mid' : 'ok';
  const repStars = Math.round((c.rep / 20) * 2) / 2;
  return (
    <section className="manager-view" aria-label={t('Profil manajer')}>
      <h4>👔 {league.profile.managerName}</h4>
      <p>
        {t('Reputasi')}: <span className="pot-stars">{starText(Math.max(0.5, repStars))}</span> ({Math.round(c.rep)}/100) · {t('{n} laga', { n: sum.games })} · {sum.w}M {sum.d}S {sum.l}K · {t('{p}% menang', { p: sum.winPct })} · {t('{n} trofi', { n: sum.trophies.length })}
        {sum.sacked > 0 && <> · {t('dipecat {n}×', { n: sum.sacked })}</>}
      </p>
      <p className="tac-note">{t('Reputasi naik dari kemenangan, trofi, dan promosi; turun karena kekalahan, degradasi, dan pemecatan. Klub yang lebih besar baru menawarimu kalau reputasimu cukup.')}</p>

      <h5>{t('Dewan direksi · {c}', { c: clubById(league, league.userClubId).name })}</h5>
      <p>
        {t('Target musim ini')}: <b>{targetText(b.expected)}</b> ({t('diperkirakan finis ke-{n}', { n: b.expected })}) · {t('sekarang ke-{n}', { n: pos })}
        {played === 0 && <> ({t('belum main')})</>}
      </p>
      <p>
        {t('Kepercayaan dewan')}: {pctBar(b.conf, confTone)} <b>{Math.round(b.conf)}%</b>
        {b.conf < CAREER.board.warnBelow && <b className="neg"> · {t('posisimu terancam')}</b>}
      </p>
      <p className="tac-note">{t('Kepercayaan naik-turun tiap laga liga menurut poin dibanding harapan, dan ditarik ke arah posisi di klasemen. Di bawah {s}% setelah {g} laga liga = dipecat. Terdegradasi padahal tidak diperkirakan turun juga bisa berujung pemecatan.', { s: CAREER.board.sackBelow, g: CAREER.board.sackMinGames })}</p>

      <h5>{t('Rekam jejak')}</h5>
      <div className="table-wrap">
        <table className="career-table">
          <thead>
            <tr>
              <th>{t('Klub')}</th>
              <th>{t('Periode')}</th>
              <th>{t('Main')}</th>
              <th>M</th>
              <th>S</th>
              <th>K</th>
              <th>{t('Gol')}</th>
              <th>{t('Musim')}</th>
              <th>{t('Trofi')}</th>
            </tr>
          </thead>
          <tbody>
            {[...c.stints].reverse().map((s, i) => {
              const now = s === currentStint(league);
              return (
                <tr key={`${s.clubId}-${s.start.season}-${s.start.week}-${i}`} className={now ? 'is-user' : undefined}>
                  <td>
                    {s.name}
                    {s.end && <small className={s.end.why === 'dipecat' ? 'neg' : undefined}> · {s.end.why === 'dipecat' ? t('dipecat') : t('pindah')}</small>}
                  </td>
                  <td>
                    {t('M{s}', { s: s.start.season })}–{s.end ? t('M{s}', { s: s.end.season }) : t('sekarang')}
                  </td>
                  <td>{s.w + s.d + s.l}</td>
                  <td>{s.w}</td>
                  <td>{s.d}</td>
                  <td>{s.l}</td>
                  <td>
                    {s.gf}–{s.ga}
                  </td>
                  <td>{s.seasons.map((x) => t('M{s}: Liga {n} ke-{p}', { s: x.season, n: x.tier, p: x.pos })).join(' · ') || '–'}</td>
                  <td>{s.trophies.map((x) => `🏆 ${compLabel(x.comp, x.tier || null)} (${t('M{s}', { s: x.season })})`).join(' · ') || '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
