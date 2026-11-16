import { t, tk } from '../i18n.js';
import { compLabel, stageLabel } from './compLabels.js';

// Label & lencana status pemain (14 Nov): absen (cedera, sakit, skorsing, izin) dan kabar pekan.

export const ABSENCE_ICON = { cedera: '🩹', sakit: '🤒', skors: '🟥', izin: '✈️' };
const ABSENCE_LABEL = { cedera: tk('Cedera'), sakit: tk('Sakit'), skors: tk('Skorsing'), izin: tk('Izin pribadi') };
const DETAIL_LABEL = {
  ringan: tk('ringan'),
  sedang: tk('sedang'),
  berat: tk('berat'),
  'latihan-ringan': tk('latihan, ringan'),
  'latihan-sedang': tk('latihan, sedang'),
  'latihan-berat': tk('latihan, berat'),
  merah: tk('kartu merah'),
  kuning: tk('5 kartu kuning'),
};

export function absenceLabel(type) {
  if (!ABSENCE_LABEL[type]) throw new RangeError(`absenceLabel: jenis tidak dikenal ${type}`);
  return t(ABSENCE_LABEL[type]);
}

export function absenceText(absence) {
  if (!absence) return '';
  const detail = absence.detail && DETAIL_LABEL[absence.detail] ? ` (${t(DETAIL_LABEL[absence.detail])})` : '';
  return `${absenceLabel(absence.type)}${detail} · ${t('{n} pekan', { n: absence.weeks })}`;
}

export function AbsenceBadge({ absence }) {
  if (!absence) return null;
  return (
    <span className={`absence-badge absence-badge--${absence.type}`} title={absenceText(absence)}>
      {ABSENCE_ICON[absence.type]} {absence.weeks}
    </span>
  );
}

// Satu baris kabar pekan.
export function newsText(n) {
  if (n.type === 'pergi') return `👋 ${t('{p} pergi — kontraknya habis', { p: n.name })}`;
  if (n.type === 'muda') return `🌱 ${t('{p} dipromosikan dari tim muda', { p: n.name })}`;
  if (n.type === 'pensiun') return `🎓 ${t('{p} pensiun di usia {a}', { p: n.name, a: n.weeks })}`;
  if (n.type === 'lolos' || n.type === 'gugur') {
    const [comp, stage] = String(n.detail).split(':');
    const where = `${compLabel(comp)} · ${stageLabel(stage)}`;
    return n.type === 'lolos' ? `✅ ${t('Lolos dari {w} (lawan {o})', { w: where, o: n.name })}` : `❌ ${t('Tersingkir di {w} oleh {o}', { w: where, o: n.name })}`;
  }
  if (n.type === 'pindah') return `🤝 ${n.detail === 'dipecat' ? t('Mulai melatih {c} setelah dipecat', { c: n.name }) : t('Pindah melatih {c}', { c: n.name })}`;
  if (n.type === 'juara') return `🏆 ${t('Juara {c}!', { c: compLabel(n.detail) })}`;
  if (n.type === 'naik') return `⬆️ ${t('Promosi ke Liga {n}!', { n: n.weeks })}`;
  if (n.type === 'turun') return `⬇️ ${t('Terdegradasi ke Liga {n}', { n: n.weeks })}`;
  return `${ABSENCE_ICON[n.type] ?? '•'} ${n.name}: ${absenceText({ type: n.type, weeks: n.weeks, detail: n.detail })}`;
}

// Bintang kelipatan ½ (15 Nov): 3,5 → "★★★½".
export function starText(v) {
  if (!Number.isFinite(v)) return '';
  const full = Math.floor(v);
  return '★'.repeat(full) + (v - full >= 0.5 ? '½' : '');
}

export function PotentialStars({ range }) {
  if (!range) return null;
  const [lo, hi] = range;
  return (
    <span className="pot-stars" title={t('Perkiraan potensi (bukan pasti)')}>
      {lo === hi ? starText(lo) : `${starText(lo)}–${starText(hi)}`}
    </span>
  );
}

// Bar kondisi 0–100 (15 Nov). Kuning < 85, merah < 75.
export function FitBar({ fit }) {
  if (!Number.isFinite(fit)) return null;
  const tone = fit < 75 ? 'low' : fit < 85 ? 'mid' : 'ok';
  return (
    <span className={`fit-bar fit-bar--${tone}`} title={t('Kondisi {n}%', { n: fit })}>
      <span className="fit-bar__track">
        <span style={{ width: `${Math.max(0, Math.min(100, fit))}%` }} />
      </span>
      <small>{fit}%</small>
    </span>
  );
}
