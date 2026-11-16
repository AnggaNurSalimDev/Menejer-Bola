import { setTraining } from '../engine/league.js';
import { trainingLoad } from '../engine/career.js';
import { LOAD_STEP, DAILY } from '../engine/development.js';
import { t } from '../i18n.js';

// Porsi latihan vs istirahat (17 Nov, permintaan pengguna). Hari non-laga dibagi tepat sesuai persen:
// 60% → 3 dari 5 hari latihan. Hari latihan: stat berkembang, kondisi hampir tidak pulih, risiko cedera.
// Hari istirahat: kondisi pulih banyak, stat tidak berkembang.
//
//   0% ─────── 60% ─────── 100%
//   segar,     seimbang     berkembang paling cepat,
//   lambat     (bawaan)     cepat lelah & lebih sering cedera

export const loadEffectText = (load) => {
  const growth = Math.round((DAILY.monthlyShare + (1 - DAILY.monthlyShare) * (load / 60)) * 100);
  const tone = load <= 30 ? t('pemain segar, berkembang lambat') : load <= 70 ? t('seimbang') : load <= 85 ? t('cepat berkembang, mulai lelah di jadwal padat') : t('paling cepat berkembang, kondisi turun terus & cedera lebih sering');
  return t('perkembangan ±{g}% dari normal · {tone}', { g: growth, tone });
};

export default function TrainingLoad({ league, onChange, locked, compact = false }) {
  const load = trainingLoad(league);
  return (
    <div className={compact ? 'training-load is-compact' : 'training-row training-load'}>
      <span className="tac-label">
        🏃 {t('Latihan {a}%', { a: load })} · 😴 {t('Istirahat {b}%', { b: 100 - load })}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={LOAD_STEP}
        value={load}
        disabled={locked}
        aria-label={t('Porsi latihan')}
        onChange={(e) => onChange(setTraining(league, { load: Number(e.target.value) }))}
      />
      <small className="tac-note">{loadEffectText(load)}</small>
    </div>
  );
}
