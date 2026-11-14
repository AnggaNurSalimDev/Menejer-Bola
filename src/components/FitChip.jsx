import { useState } from 'react';
import { fitDetail, betterTemplatesFor, getTemplate } from '../engine/tacticTemplates.js';
import { t, tk } from '../i18n.js';

// Label kecocokan pemain dengan template (15 Nov). Klik → kotak rincian: stat yang dipentingkan
// peran itu, nilai pemain vs rata-rata pemain inti sekasta (⚠ = kurang), dan template yang lebih cocok.

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

export default function FitChip({ templateKey, player, reference }) {
  const [open, setOpen] = useState(false);
  if (!templateKey || templateKey === 'kustom' || !player?.stats) return null;
  const d = fitDetail(templateKey, player, reference);
  const pct = Math.round(d.fit * 100);
  return (
    <span className="fit-chip-wrap">
      <button type="button" className={`fit-chip fit-chip--${d.tone}`} aria-expanded={open} onClick={() => setOpen(!open)} title={t('Kecocokan dengan template {n}', { n: t(getTemplate(templateKey).label) })}>
        {t('cocok {p}', { p: `${pct}%` })} ▾
      </button>
      {open && (
        <span className="fit-box" role="dialog">
          <b>
            {t(getTemplate(templateKey).label)} · {d.role}
          </b>
          {d.stats.map((s) => (
            <span key={s.key} className={`fit-stat ${s.short ? 'is-short' : ''}`}>
              <span>{STAT_LABEL[s.key] ? t(STAT_LABEL[s.key]) : s.key}</span>
              <span className="fit-stat__bar">
                <span style={{ width: `${(s.value / 20) * 100}%` }} />
                <i style={{ left: `${(s.ref / 20) * 100}%` }} title={t('Rata-rata pemain inti sekasta: {n}', { n: s.ref })} />
              </span>
              <span>
                {s.value} {s.short ? `⚠ ${t('kurang')}` : '✓'}
              </span>
            </span>
          ))}
          <small>{t('Garis tipis = rata-rata pemain inti sekasta. ⚠ = di bawah rata-rata itu.')}</small>
          {betterTemplatesFor(player, templateKey).length > 0 && (
            <small>
              → {t('lebih cocok di')}: {betterTemplatesFor(player, templateKey).map((x) => `${t(getTemplate(x.key).label)} ${Math.round(x.fit * 100)}%`).join(' · ')}
            </small>
          )}
        </span>
      )}
    </span>
  );
}
