import { t, tk, getLang } from '../i18n.js';

// Nama ajang & babak (15 Nov). Kunci teks Indonesia; terjemahan lewat i18n.

const COMP_LABEL = {
  liga: tk('Liga'),
  nasional: tk('Piala Nasional'),
  ligaCup: tk('Piala Liga'),
  super: tk('Piala Super'),
  elite: tk('Kejuaraan Elite'),
  playoff: tk('Play-off promosi'),
};
const STAGE_LABEL = {
  R64: tk('64 besar'),
  R32: tk('32 besar'),
  R16: tk('16 besar'),
  R1: tk('Babak 1'),
  R2: tk('Babak 2'),
  QF: tk('Perempat final'),
  SF: tk('Semifinal'),
  F: tk('Final'),
};

export function compLabel(comp, tier = null) {
  if (!COMP_LABEL[comp]) throw new RangeError(`compLabel: ajang tidak dikenal ${comp}`);
  if (comp === 'liga' && tier) return t('Liga {n}', { n: tier });
  return t(COMP_LABEL[comp]);
}

export function stageLabel(stage) {
  if (/^L\d+$/.test(stage)) return t('Pekan {w}', { w: Number(stage.slice(1)) });
  if (/^G\d$/.test(stage)) return t('Grup · laga {n}', { n: Number(stage.slice(1)) });
  if (!STAGE_LABEL[stage]) throw new RangeError(`stageLabel: babak tidak dikenal ${stage}`);
  return t(STAGE_LABEL[stage]);
}

export function roundLabel(round, tier = null) {
  if (!round) return '';
  if (round.comp === 'super') return compLabel('super');
  return `${compLabel(round.comp, round.comp === 'liga' ? tier : null)} · ${stageLabel(round.stage)}`;
}

// Skor dengan adu penalti, mis. "1–1 (pen 4–3)".
export function scoreText(result) {
  if (!result) return 'vs';
  const pens = result.pens ? ` (${t('pen')} ${result.pens.home}–${result.pens.away})` : '';
  return `${result.home}–${result.away}${pens}`;
}

// Tanggal babak (14 Nov malam), mis. "Sab, 8 Agu 2026" / "Sat, 8 Aug 2026".
export function dateLabel(ms, { year = true } = {}) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'id-ID', { weekday: 'short', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
