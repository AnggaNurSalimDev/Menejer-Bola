import { useState } from 'react';
import { scriptErrors, SCRIPT, TRIGGERS, ACTIONS } from '../engine/scripts.js';

// Strategi detil — editor (2 Nov, tahap 2). Skema dibuat per zona, untuk fase DENGAN BOLA.
// Syarat utama: pemegang bola + pemain yang harus berada di posisi zonanya (diatur di papan zona).
// Tiap langkah: satu pemicu + beberapa aksi. Titik dipilih dengan mengklik lapangan di atas.

export const TRIGGER_LABEL = {
  mulai: 'Mulai (syarat utama terpenuhi)',
  operanDilepas: 'Operan sebelumnya dilepas',
  operanDiterima: 'Operan sebelumnya diterima',
  pemainSampai: 'Pemain sampai di titiknya',
  waktu: 'Setelah beberapa detik',
};
export const ACTION_LABEL = {
  oper: 'Oper ke',
  lari: 'Lari ke titik',
  giring: 'Giring bola ke titik',
  umpanSilang: 'Umpan silang ke titik',
  tembak: 'Tembak',
};

let seq = 0;
const newId = () => `skema-${Date.now().toString(36)}-${(seq += 1)}`;

export function blankScript(zone, holderId) {
  return {
    id: newId(),
    name: 'Skema baru',
    zone,
    holderId: holderId ?? '',
    playerIds: [],
    steps: [{ trigger: { type: 'mulai' }, actions: [{ type: 'oper', to: '' }] }],
  };
}

function PlayerSelect({ players, value, onChange, disabled, placeholder = 'pilih pemain', exclude = [] }) {
  return (
    <select className="lane-select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
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
export default function ScriptEditor({ draft, players, onChange, onSave, onCancel, onPick, picking, locked }) {
  const [showErrors, setShowErrors] = useState(false);
  const outfield = players.filter((p) => p.role !== 'GK').sort((a, b) => a.number - b.number);
  const errors = scriptErrors([draft]);
  const set = (patch) => onChange({ ...draft, ...patch });
  const setStep = (i, patch) => set({ steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setAction = (i, k, patch) =>
    setStep(i, { actions: draft.steps[i].actions.map((a, j) => (j === k ? { ...a, ...patch } : a)) });
  const togglePlayer = (id) =>
    set({ playerIds: draft.playerIds.includes(id) ? draft.playerIds.filter((x) => x !== id) : [...draft.playerIds, id] });
  const pointText = (pt) => (pt ? `(${pt.x.toFixed(0)}, ${pt.y.toFixed(0)}) m` : 'belum dipilih');

  return (
    <div className="script-editor">
      <div className="script-row">
        <label className="tac-label" htmlFor={`nm-${draft.id}`}>
          Nama
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

      <fieldset className="script-box">
        <legend>Syarat utama</legend>
        <div className="script-row">
          <span className="tac-label">Bola di</span>
          <PlayerSelect players={outfield} value={draft.holderId} disabled={locked} onChange={(v) => set({ holderId: v })} placeholder="pilih pemegang bola" />
        </div>
        <div className="script-row script-row--top">
          <span className="tac-label">Harus di posisi zona (±{SCRIPT.radius} m)</span>
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
            Langkah {i + 1}
            {i > 0 && (
              <button type="button" className="link-btn" disabled={locked} onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}>
                hapus
              </button>
            )}
          </legend>
          <div className="script-row">
            <span className="tac-label">Pemicu</span>
            {i === 0 ? (
              <span className="script-fixed">{TRIGGER_LABEL.mulai}</span>
            ) : (
              <span className="script-inline">
                <select
                  className="lane-select"
                  value={step.trigger.type}
                  disabled={locked}
                  onChange={(e) => setStep(i, { trigger: { type: e.target.value, ...(e.target.value === 'waktu' ? { detik: 1 } : {}) } })}
                >
                  {TRIGGERS.filter((t) => t !== 'mulai').map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABEL[t]}
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
              <span className="tac-label">Aksi {k + 1}</span>
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
                  {ACTIONS.map((t) => (
                    <option key={t} value={t}>
                      {ACTION_LABEL[t]}
                    </option>
                  ))}
                </select>
                {a.type === 'oper' && <PlayerSelect players={outfield} value={a.to} disabled={locked} onChange={(v) => setAction(i, k, { to: v })} placeholder="penerima" />}
                {a.type === 'lari' && <PlayerSelect players={outfield} value={a.playerId} disabled={locked} onChange={(v) => setAction(i, k, { playerId: v })} placeholder="pelari" />}
                {(a.type === 'lari' || a.type === 'giring' || a.type === 'umpanSilang') && (
                  <button
                    type="button"
                    className={picking?.step === i && picking?.action === k ? 'lane-reset is-picking' : 'lane-reset'}
                    disabled={locked}
                    onClick={() => onPick({ step: i, action: k }, (pt) => setAction(i, k, { point: pt }))}
                  >
                    {picking?.step === i && picking?.action === k ? 'Klik lapangan…' : `Titik: ${pointText(a.point)}`}
                  </button>
                )}
                <button type="button" className="link-btn" disabled={locked || step.actions.length <= 1} onClick={() => setStep(i, { actions: step.actions.filter((_, j) => j !== k) })}>
                  ×
                </button>
              </span>
            </div>
          ))}
          {step.actions.length < SCRIPT.maxActions && (
            <button type="button" className="link-btn" disabled={locked} onClick={() => setStep(i, { actions: [...step.actions, { type: 'lari', playerId: '' }] })}>
              + aksi
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
            onClick={() => set({ steps: [...draft.steps, { trigger: { type: 'operanDiterima' }, actions: [{ type: 'tembak' }] }] })}
          >
            + Langkah
          </button>
        )}
        <span className="script-spacer" />
        <button type="button" className="lane-reset" onClick={onCancel}>
          Batal
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
          Simpan skema
        </button>
      </div>
      {showErrors && errors.length > 0 && (
        <ul className="script-errors">
          {errors.map((e) => (
            <li key={e}>{e.replace(/^skema 1:\s*/, '')}</li>
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
        const d =
          s.kind === 'cross'
            ? `M${s.from.x},${s.from.y} Q${mx},${my - 10} ${s.to.x},${s.to.y}`
            : `M${s.from.x},${s.from.y} L${s.to.x},${s.to.y}`;
        return (
          <g key={i} className={`sc sc--${s.kind}`}>
            <path d={d} markerEnd="url(#script-arrow)" />
            <circle cx={mx} cy={s.kind === 'cross' ? my - 5 : my} r="1.7" />
            <text x={mx} y={(s.kind === 'cross' ? my - 5 : my) + 0.8} textAnchor="middle">
              {s.step}
            </text>
          </g>
        );
      })}
      {numberOf && null}
    </g>
  );
}
