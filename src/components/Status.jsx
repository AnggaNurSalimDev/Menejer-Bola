import { t, tk } from '../i18n.js';

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
  return `${ABSENCE_ICON[n.type] ?? '•'} ${n.name}: ${absenceText({ type: n.type, weeks: n.weeks, detail: n.detail })}`;
}
