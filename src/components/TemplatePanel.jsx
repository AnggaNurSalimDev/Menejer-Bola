import { useState } from 'react';
import { TEMPLATE_KEYS, getTemplate, templateComplexity, squadFit, rankTemplates, weakSpots, requiredUnderstanding } from '../engine/tacticTemplates.js';
import { starText } from './Status.jsx';
import { t } from '../i18n.js';

// Template taktik (15 Nov): pilih gaya dari yang sederhana sampai rumit, lihat kecocokan skuad & saran
// pemain, dan pemahaman tim. Tidak menyimpan sendiri: onApply(key) / onCustom() dari App.
//
//   squad    : pemain yang bisa main { uid, shortName, role, stats, ten? }
//   market   : pemain bursa (kandidat saran) — boleh kosong (laga persahabatan)
//   active   : kunci template aktif | 'kustom'
//   famOf(k) : keakraban tim 0–100 · understand(★) → { effective, need, gap }

const pct = (x) => `${Math.round(x * 100)}%`;
const gapText = (gap) => (gap <= 0 ? t('rencana berjalan') : gap < 0.35 ? t('sebagian rencana tidak jalan') : t('rencana sering tidak jalan'));

export default function TemplatePanel({ squad, market = [], active, famOf, understand, currentComplexity, onApply, onCustom, disabled }) {
  const [open, setOpen] = useState(null);
  if (!squad || squad.length < 11) return <p className="tac-note">{t('Skuad belum cukup untuk menilai template.')}</p>;
  const ranked = rankTemplates(squad);
  const fitOf = new Map(ranked.map((r) => [r.key, r.fit]));
  const nowU = understand(currentComplexity);
  const name = (id) => squad.find((p) => (p.uid ?? p.id) === id)?.shortName ?? id;
  const sorted = [...TEMPLATE_KEYS].sort((a, b) => templateComplexity(a) - templateComplexity(b) || a.localeCompare(b));

  return (
    <div className="template-panel">
      <p className={`template-now ${nowU.gap > 0 ? 'is-gap' : ''}`}>
        {t('Taktik sekarang')}: <b>{active === 'kustom' ? t('Taktik sendiri') : t(getTemplate(active).label)}</b> · {t('kerumitan')} <span className="pot-stars">{starText(currentComplexity)}</span> · {t('pemahaman tim {u}% / butuh {n}%', { u: Math.round(nowU.effective), n: Math.round(nowU.need) })} → {gapText(nowU.gap)}
      </p>
      <p className="tac-note">
        {t('Paling cocok untuk skuadmu')}:{' '}
        {ranked.slice(0, 3).map((r, i) => (
          <span key={r.key}>
            {i > 0 && ' · '}
            <button type="button" className="link-btn" onClick={() => setOpen(r.key)}>
              {t(getTemplate(r.key).label)} ({pct(r.fit)})
            </button>
          </span>
        ))}
      </p>
      <ul className="template-list">
        {sorted.map((key) => {
          const tpl = getTemplate(key);
          const cx = templateComplexity(key);
          const u = understand(cx, key);
          const isOpen = open === key;
          return (
            <li key={key} className={`${key === active ? 'is-active' : ''} ${isOpen ? 'is-open' : ''}`}>
              <button type="button" className="template-row" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                <span className="pot-stars" title={t('Kerumitan')}>
                  {starText(cx)}
                </span>
                <span className="template-name">{t(tpl.label)}</span>
                <span className="template-meta">
                  {t('cocok {p}', { p: pct(fitOf.get(key)) })} · {t('akrab {p}%', { p: Math.round(famOf(key)) })}
                  {u.gap > 0 && <b className="neg"> · {t('butuh {n}%', { n: Math.round(requiredUnderstanding(cx)) })}</b>}
                </span>
              </button>
              {isOpen && <TemplateDetail tplKey={key} squad={squad} market={market} name={name} u={u} active={key === active} onApply={onApply} disabled={disabled} />}
            </li>
          );
        })}
      </ul>
      {active !== 'kustom' && (
        <button type="button" className="link-btn" disabled={disabled} onClick={onCustom}>
          {t('Anggap taktik sekarang sebagai taktik sendiri')}
        </button>
      )}
      <p className="tac-note">{t('Pemahaman naik tiap laga memakai template (lebih cepat dengan fokus latihan "Taktik" dan pemain yang cerdas). Pemain baru butuh ±10 babak untuk menyatu. Kurang paham → posisi melenceng, skema sering batal, keputusan lebih lambat, pressing kurang kompak.')}</p>
    </div>
  );
}

function TemplateDetail({ tplKey, squad, market, name, u, active, onApply, disabled }) {
  const tpl = getTemplate(tplKey);
  const fit = squadFit(tplKey, squad);
  const weak = weakSpots(tplKey, squad, market, 3);
  return (
    <div className="template-detail">
      <p>{t(tpl.idea)}</p>
      <p className="tac-note">
        {t('Formasi {f}', { f: tpl.formation })} · {t('pemahaman tim {u}% / butuh {n}%', { u: Math.round(u.effective), n: Math.round(u.need) })} → {gapText(u.gap)}
      </p>
      <p className="tac-note">
        {t('Susunan terbaik')}: {fit.slots.map((x) => `${x.role} ${name(x.id)}`).join(' · ')}
      </p>
      {weak.length > 0 && (
        <ul className="weak-list">
          {weak.map((w) => (
            <li key={w.number}>
              {t('Posisi lemah')}: <b>{w.role}</b> ({name(w.id)}, {pct(w.fit)})
              {w.better.length > 0 ? (
                <span>
                  {' '}
                  → {t('saran bursa')}: {w.better.map((b) => `${b.c.shortName} ${b.c.role} (${pct(b.fit)})`).join(', ')}
                </span>
              ) : (
                <span className="tac-note"> → {t('tidak ada yang lebih cocok di bursa saat ini')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="break-button" disabled={disabled} onClick={() => onApply(tplKey)}>
        {active ? t('Pasang ulang template ini') : t('Pakai template ini')}
      </button>
      <p className="tac-note">{t('Memakai template mengganti seluruh taktik (formasi, instruksi, jalur, kelompok, skema). Setelah itu semuanya tetap bisa kamu ubah.')}</p>
    </div>
  );
}
