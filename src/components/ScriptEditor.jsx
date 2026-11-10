import { useState } from 'react';
import { scriptErrors, SCRIPT, TRIGGERS, ACTIONS } from '../engine/scripts.js';
import { t, tk, getLang } from '../i18n.js';

// Strategi detil — editor (2 Nov, tahap 2). Skema dibuat per zona, untuk fase DENGAN BOLA.
// Syarat utama: pemegang bola + pemain yang harus berada di posisi zonanya (diatur di papan zona).
// Tiap langkah: satu pemicu + beberapa aksi. Titik dipilih dengan mengklik lapangan di atas.

export const TRIGGER_LABEL = {
  mulai: tk('Mulai (syarat utama terpenuhi)'),
  operanDilepas: tk('Operan sebelumnya dilepas'),
  operanDiterima: tk('Operan sebelumnya diterima'),
  pemainSampai: tk('Pemain sampai di titiknya'),
  waktu: tk('Setelah beberapa detik'),
};
export const ACTION_LABEL = {
  oper: tk('Oper ke'),
  lari: tk('Lari ke titik'),
  giring: tk('Giring bola ke titik'),
  umpanSilang: tk('Umpan silang ke titik'),
  tembak: tk('Tembak'),
};

let seq = 0;
const newId = () => `skema-${Date.now().toString(36)}-${(seq += 1)}`;

export function blankScript(zone, holderId) {
  return {
    id: newId(),
    name: t('Skema baru'),
    zone,
    holderId: holderId ?? '',
    playerIds: [],
    steps: [{ trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: '' }] }],
  };
}

function PlayerSelect({ players, value, onChange, disabled, placeholder = tk('pilih pemain'), exclude = [] }) {
  return (
    <select className="lane-select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t(placeholder)}</option>
      {players
        .filter((p) => !exclude.includes(p.id))
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.number} · {p.shortName}
          </option>
        ))}
    </select>
  );
}

// draft: skrip yang sedang diedit. onChange(draft). onPick(callback) → mode pilih titik di lapangan.
// Siapa yang memegang bola saat aksi pemegang bola tiap langkah dijalankan (2 Nov: pengguna bingung
// umpan silang dilakukan pemain lain). null = belum jelas (bola baru dilambungkan / ditembak).
export function carriersBySteps(script) {
  const out = [];
  let carrier = script.holderId || null;
  for (const step of script.steps) {
    out.push(carrier);
    for (const a of step.actions) {
      if (a.type === 'oper') carrier = a.to || null;
      else if (a.type === 'umpanSilang' || a.type === 'tembak') carrier = null;
    }
  }
  return out;
}

const HOLDER_TYPES = new Set(['oper', 'giring', 'umpanSilang', 'tembak']);

// Pesan validasi dari engine (bahasa Indonesia) → Inggris bila bahasa tampilan Inggris.
const ERR_EN = [
  [/^langkah (\d+) aksi (\d+): /, 'step $1 action $2: '],
  [/^langkah (\d+): /, 'step $1: '],
  [/penerima belum dipilih/, 'receiver not chosen'],
  [/pemain\/titik lari tidak valid/, 'runner or run point not set'],
  [/titik tidak valid/, 'point not set'],
  [/pemegang bola belum dipilih/, 'ball holder not chosen'],
  [/pemicu tidak dikenal/, 'unknown trigger'],
  [/pemain untuk "sampai" belum dipilih/, 'player for "arrives" not chosen'],
  [/detik harus 0–10/, 'seconds must be 0–10'],
  [/langkah pertama harus "mulai"/, 'the first step must be "start"'],
  [/belum ada aksi/, 'no actions yet'],
  [/belum ada langkah/, 'no steps yet'],
  [/pemegang bola hanya bisa satu aksi per langkah/, 'the ball holder can do only one action per step'],
  [/nama tidak valid/, 'invalid name'],
  [/paling banyak (\d+) aksi/, 'at most $1 actions'],
  [/paling banyak (\d+) langkah/, 'at most $1 steps'],
  [/tidak dikenal/, 'unknown'],
];
function errorText(e) {
  const msg = e.replace(/^skema 1:\s*/, '');
  if (getLang() !== 'en') return msg;
  return ERR_EN.reduce((m, [re, en]) => m.replace(re, en), msg);
}

export default function ScriptEditor({ draft, players, onChange, onSave, onCancel, onPick, picking, locked, zoneWarning, zones = [], onZone }) {
  const [showErrors, setShowErrors] = useState(false);
  const outfield = players.filter((p) => p.role !== 'GK').sort((a, b) => a.number - b.number);
  const errors = scriptErrors([draft]);
  const set = (patch) => onChange({ ...draft, ...patch });
  const setStep = (i, patch) => set({ steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setAction = (i, k, patch) =>
    setStep(i, { actions: draft.steps[i].actions.map((a, j) => (j === k ? { ...a, ...patch } : a)) });
  const togglePlayer = (id) =>
    set({ playerIds: draft.playerIds.includes(id) ? draft.playerIds.filter((x) => x !== id) : [...draft.playerIds, id] });
  const pointText = (pt) => (pt ? `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}) m` : t('belum dipilih'));
  const carriers = carriersBySteps(draft);
  const num = (id) => players.find((p) => p.id === id)?.number;

  return (
    <div className="script-editor">
      <div className="script-row">
        <label className="tac-label" htmlFor={`nm-${draft.id}`}>
          {t('Nama')}
        </label>
        <input
          id={`nm-${draft.id}`}
          className="script-name"
          maxLength={40}
          value={draft.name}
          disabled={locked}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      {zones.length > 0 && onZone && (
        <div className="script-row">
          <label className="tac-label" htmlFor={`zn-${draft.id}`}>
            {t('Zona awal')}
          </label>
          <select id={`zn-${draft.id}`} value={draft.zone} disabled={locked} onChange={(e) => onZone(e.target.value)}>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {zones.length > 0 && onZone && <p className="script-hint">{t('Tempat bola saat skema dimulai. Bentuk formasi di papan mengikuti zona ini; operan, giring, umpan silang dan lari boleh berakhir di luar zona.')}</p>}

      <p className="script-hint">
        💡 {t('Saran: skema pendek lebih sering berhasil — 3 langkah atau kurang dan sedikit pemain di syarat utama. Tiap langkah bisa gagal (operan dipotong, bola direbut), jadi peluang selesai mengecil di tiap langkah tambahan. Lebih baik beberapa skema kecil daripada satu skema panjang.')}
      </p>
      {draft.steps.length > 3 && <p className="script-warn">⚠️ {t('Skema ini {n} langkah — kemungkinan jarang selesai. Pertimbangkan memecahnya.', { n: draft.steps.length })}</p>}
      {zoneWarning && <p className="script-warn">⚠️ {zoneWarning}</p>}
      <fieldset className="script-box">
        <legend>{t('Syarat utama')}</legend>
        <p className="tac-note">{t('Skema mulai saat bola dipegang pemain di bawah ini dan bola berada di zona awal.')}</p>
        <div className="script-row">
          <span className="tac-label">{t('Bola di')}</span>
          <PlayerSelect players={outfield} value={draft.holderId} disabled={locked} onChange={(v) => set({ holderId: v })} placeholder={tk('pilih pemegang bola')} />
        </div>
        <div className="script-row script-row--top">
          <span className="tac-label">{t('Harus di posisi zona (±{r} m)', { r: SCRIPT.radius })}</span>
          <div className="chips">
            {outfield.map((p) => (
              <button
                key={p.id}
                type="button"
                className={draft.playerIds.includes(p.id) ? 'chip is-on' : 'chip'}
                disabled={locked}
                onClick={() => togglePlayer(p.id)}
              >
                {p.number}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      {draft.steps.map((step, i) => (
        <fieldset key={i} className="script-box">
          <legend>
            {t('Langkah {n}', { n: i + 1 })}
            {i > 0 && (
              <button type="button" className="link-btn" disabled={locked} onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}>
                {t('hapus')}
              </button>
            )}
          </legend>
          <div className="script-row">
            <span className="tac-label">{t('Pemicu')}</span>
            {i === 0 ? (
              <span className="script-fixed">{t(TRIGGER_LABEL.mulai)}</span>
            ) : (
              <span className="script-inline">
                <select
                  className="lane-select"
                  value={step.trigger.type}
                  disabled={locked}
                  onChange={(e) => setStep(i, { trigger: { type: e.target.value, ...(e.target.value === 'waktu' ? { detik: 1 } : {}) } })}
                >
                  {TRIGGERS.filter((g) => g !== 'mulai').map((g) => (
                    <option key={g} value={g}>
                      {t(TRIGGER_LABEL[g])}
                    </option>
                  ))}
                </select>
                {step.trigger.type === 'pemainSampai' && (
                  <PlayerSelect players={outfield} value={step.trigger.playerId} disabled={locked} onChange={(v) => setStep(i, { trigger: { ...step.trigger, playerId: v } })} />
                )}
                {step.trigger.type === 'waktu' && (
                  <input
                    type="number"
                    className="script-num"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={step.trigger.detik}
                    disabled={locked}
                    onChange={(e) => setStep(i, { trigger: { ...step.trigger, detik: Number(e.target.value) } })}
                  />
                )}
              </span>
            )}
          </div>
          {step.actions.map((a, k) => (
            <div key={k} className="script-row">
              <span className="tac-label">{t('Aksi {n}', { n: k + 1 })}</span>
              <span className="script-inline">
                <select
                  className="lane-select"
                  value={a.type}
                  disabled={locked}
                  onChange={(e) => {
                    const type = e.target.value;
                    setAction(i, k, { type, to: type === 'oper' ? '' : undefined, playerId: type === 'lari' ? '' : undefined, point: undefined });
                  }}
                >
                  {ACTIONS.map((g) => (
                    <option key={g} value={g}>
                      {t(ACTION_LABEL[g])}
                    </option>
                  ))}
                </select>
                {HOLDER_TYPES.has(a.type) && (
                  <span className="script-by" title={t('Aksi pemegang bola dilakukan oleh pemain yang memegang bola pada langkah ini')}>
                    {t('oleh')} {carriers[i] ? `#${num(carriers[i]) ?? '?'}` : t('pemenang bola (belum jelas)')}
                  </span>
                )}
                {a.type === 'oper' && <PlayerSelect players={outfield} value={a.to} disabled={locked} onChange={(v) => setAction(i, k, { to: v })} placeholder={tk('penerima')} />}
                {a.type === 'lari' && <PlayerSelect players={outfield} value={a.playerId} disabled={locked} onChange={(v) => setAction(i, k, { playerId: v })} placeholder={tk('pelari')} />}
                {(a.type === 'lari' || a.type === 'giring' || a.type === 'umpanSilang') && (
                  <button
                    type="button"
                    className={picking?.step === i && picking?.action === k ? 'lane-reset is-picking' : 'lane-reset'}
                    disabled={locked}
                    onClick={() => onPick({ step: i, action: k }, (pt) => setAction(i, k, { point: pt }))}
                  >
                    {picking?.step === i && picking?.action === k ? t('Klik lapangan…') : `${t('Titik')}: ${pointText(a.point)}`}
                  </button>
                )}
                <button type="button" className="link-btn" disabled={locked || step.actions.length <= 1} onClick={() => setStep(i, { actions: step.actions.filter((_, j) => j !== k) })}>
                  ×
                </button>
              </span>
            </div>
          ))}
          {step.actions.length < SCRIPT.maxActions && (
            <span className="script-hint script-hint--inline">{t('Pemain mana pun boleh diberi lari, tidak harus penerima — mulai bersamaan dengan aksi lain di langkah ini.')}</span>
          )}
          {step.actions.length < SCRIPT.maxActions && (
            <button type="button" className="link-btn" disabled={locked} onClick={() => setStep(i, { actions: [...step.actions, { type: 'lari', playerId: '' }] })}>
              + {t('Pemain lain lari')}
            </button>
          )}
        </fieldset>
      ))}

      <div className="script-actions">
        {draft.steps.length < SCRIPT.maxSteps && (
          <button
            type="button"
            className="lane-reset"
            disabled={locked}
            onClick={() => set({ steps: [...draft.steps, { trigger: { type: 'operanDiterima' }, actions: [{ type: 'oper', to: '' }] }] })}
          >
            + {t('Langkah')}
          </button>
        )}
        <span className="script-spacer" />
        <button type="button" className="lane-reset" onClick={onCancel}>
          {t('Batal')}
        </button>
        <button
          type="button"
          className="break-button script-save"
          disabled={locked}
          onClick={() => {
            if (errors.length > 0) setShowErrors(true);
            else onSave(draft);
          }}
        >
          {t('Simpan skema')}
        </button>
      </div>
      {showErrors && errors.length > 0 && (
        <ul className="script-errors">
          {errors.map((e) => (
            <li key={e}>{errorText(e)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Garis & panah skema di lapangan (bingkai tim). pos(id) → posisi pemain di gambar zona.
export function ScriptOverlay({ script, pos, numberOf }) {
  if (!script) return null;
  const shapes = [];
  let carrier = script.holderId;
  let carrierAt = pos(carrier);
  const runAt = {};
  script.steps.forEach((step, i) => {
    for (const a of step.actions) {
      if (a.type === 'lari' && a.playerId && a.point) {
        const from = runAt[a.playerId] ?? pos(a.playerId);
        if (from) shapes.push({ kind: 'run', from, to: a.point, step: i + 1 });
        runAt[a.playerId] = a.point;
      }
    }
    for (const a of step.actions) {
      if (!carrierAt) break;
      if (a.type === 'oper' && a.to) {
        const to = runAt[a.to] ?? pos(a.to);
        if (to) shapes.push({ kind: 'pass', from: carrierAt, to, step: i + 1 });
        carrier = a.to;
        carrierAt = to;
      } else if (a.type === 'giring' && a.point) {
        shapes.push({ kind: 'dribble', from: carrierAt, to: a.point, step: i + 1 });
        carrierAt = a.point;
      } else if (a.type === 'umpanSilang' && a.point) {
        shapes.push({ kind: 'cross', from: carrierAt, to: a.point, step: i + 1 });
        carrierAt = a.point;
      } else if (a.type === 'tembak') {
        shapes.push({ kind: 'shot', from: carrierAt, to: { x: 105, y: 34 }, step: i + 1 });
        carrierAt = null; // setelah tembakan, tak ada lagi pemegang bola yang jelas
      }
    }
  });
  return (
    <g className="script-overlay" pointerEvents="none">
      <defs>
        <marker id="script-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0,0 L6,3 L0,6 z" fill="context-stroke" />
        </marker>
      </defs>
      {shapes.map((s, i) => {
        const mx = (s.from.x + s.to.x) / 2;
        const my = (s.from.y + s.to.y) / 2;
        // Nomor langkah di dekat PEMAIN yang bergerak/menendang (2 Nov, masukan pengguna: di tengah garis
        // terbaca seperti titik singgah). Letaknya ±5 m dari pangkal panah, di sepanjang lintasan.
        const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
        const u = len > 0 ? Math.min(0.4, 5 / len) : 0;
        const cx = s.kind === 'cross' ? (1 - u) * (1 - u) * s.from.x + 2 * (1 - u) * u * mx + u * u * s.to.x : s.from.x + (s.to.x - s.from.x) * u;
        const cy = s.kind === 'cross' ? (1 - u) * (1 - u) * s.from.y + 2 * (1 - u) * u * (my - 10) + u * u * s.to.y : s.from.y + (s.to.y - s.from.y) * u;
        const d =
          s.kind === 'cross'
            ? `M${s.from.x},${s.from.y} Q${mx},${my - 10} ${s.to.x},${s.to.y}`
            : `M${s.from.x},${s.from.y} L${s.to.x},${s.to.y}`;
        return (
          <g key={i} className={`sc sc--${s.kind}`}>
            <path d={d} markerEnd="url(#script-arrow)" />
            <circle cx={cx} cy={cy} r="1.7" />
            <text x={cx} y={cy + 0.8} textAnchor="middle">
              {s.step}
            </text>
          </g>
        );
      })}
      {numberOf && null}
    </g>
  );
}
