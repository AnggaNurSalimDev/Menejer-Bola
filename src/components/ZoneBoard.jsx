import { useEffect, useRef, useState } from 'react';
import ScriptEditor, { ScriptOverlay, blankScript, ACTION_LABEL } from './ScriptEditor.jsx';
import { PITCH } from '../engine/pitch.js';
import { computeAnchor, slotForPoint } from '../engine/shape.js';
import {
  teamStyle,
  effectiveSlot,
  zonedSlot,
  zoneWeights,
  zoneCenter,
  mirrorZone,
  clampCustomSlot,
  CUSTOM_SLOT,
  ZONES,
} from '../engine/tactics.js';

// Detail 8 zona (2 Nov, layer 3 — ide pengguna): SATU lapangan khusus. Pilih dengan/tanpa bola dan satu
// dari 4 zona bola; zona lain digelapkan (latar saja — semua pemain tetap terang & bisa diseret, karena
// zona = tempat BOLA, bukan tempat pemain). Bola contoh di tengah zona; posisi dihitung dengan rumus
// engine untuk bola di situ. Zona yang tidak diatur memakai posisi layer biasa.

const W = PITCH.length;
const H = PITCH.width;
const BOX_W = 40.32;
const PREF_KEY = 'menejer-bola:zona';
const ZONE_LABEL = { sendiriKiri: 'Sendiri · kiri', sendiriKanan: 'Sendiri · kanan', lawanKiri: 'Lawan · kiri', lawanKanan: 'Lawan · kanan' };

function readPref() {
  try {
    const p = JSON.parse(window.localStorage.getItem(PREF_KEY) ?? '{}');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}
function savePref(next) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    // penyimpanan tidak tersedia: abaikan
  }
}

function zoneRect(zone) {
  return { x: zone.startsWith('lawan') ? W / 2 : 0, y: zone.endsWith('Kiri') ? 0 : H / 2, w: W / 2, h: H / 2 };
}

export function zoneCount(tactics, key, zone) {
  return Object.keys(tactics?.[key]?.[zone] ?? {}).length;
}

export default function ZoneBoard({ players, tactics, color, locked, onSetTactics, nameOf, scriptStats = {} }) {
  const pref = readPref();
  const [phase, setPhase] = useState(pref.phase === 'defend' ? 'defend' : 'attack');
  const [zone, setZone] = useState(ZONES.includes(pref.zone) ? pref.zone : 'lawanKiri');
  const [ghostOn, setGhostOn] = useState(pref.ghost !== false);
  const [drag, setDrag] = useState(null);
  const [draft, setDraft] = useState(null); // Strategi detil: skema yang sedang diedit
  const [viewId, setViewId] = useState(null); // skema yang garisnya ditampilkan
  const [picking, setPicking] = useState(null); // { step, action, cb } — menunggu klik titik
  const svgRef = useRef(null);
  // Esc membatalkan mode memilih titik (2 Nov: pengguna mengira papan "tidak bisa diklik").
  useEffect(() => {
    if (!picking) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPicking(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picking]);

  if (!tactics || !Array.isArray(players) || players.length === 0) return null;
  const layer = phase === 'attack' ? 'in' : 'out';
  const key = layer === 'in' ? 'zoneIn' : 'zoneOut';
  const ball = zoneCenter(zone);
  const style = teamStyle(tactics);
  const weights = zoneWeights(ball);
  const zoneMap = tactics[key]?.[zone] ?? {};

  const items = players.map((p) => {
    const slot = p.role === 'GK' ? p.slot : zonedSlot(p, tactics, layer, weights);
    const a = computeAnchor({ ...p, slot }, ball, true, phase, style);
    return { p, x: a.x, y: a.y, custom: Boolean(zoneMap[p.id]) };
  });
  const ghosts = ghostOn
    ? players.map((p) => {
        const slot = p.role === 'GK' ? p.slot : effectiveSlot(p, tactics, layer);
        const a = computeAnchor({ ...p, slot }, ball, true, phase, style);
        return { p, x: a.x, y: a.y };
      })
    : [];
  const here = new Map(items.map((it) => [it.p.id, it]));
  const outfieldIds = players.filter((p) => p.role !== 'GK').map((p) => p.id);
  const mirrored = zone.endsWith('Kiri') ? zone.replace('Kiri', 'Kanan') : zone.replace('Kanan', 'Kiri');

  function remember(next) {
    savePref({ phase, zone, ghost: ghostOn, ...next });
  }
  function pickPhase(v) {
    if (draft) return;
    setPhase(v);
    remember({ phase: v });
  }
  function pickZone(v) {
    if (picking) setPicking(null);
    // Skema yang sedang diedit ikut pindah ke zona yang dipilih (2 Nov: dulu tombol zona terkunci
    // diam-diam saat mengedit — pengguna mengira papan rusak).
    if (draft) setDraft({ ...draft, zone: v });
    setZone(v);
    remember({ zone: v });
  }
  function toggleGhost() {
    setGhostOn(!ghostOn);
    remember({ ghost: !ghostOn });
  }

  function toPitch(evt) {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const q = pt.matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(W, q.x)), y: Math.max(0, Math.min(H, q.y)) };
  }
  function start(evt, p) {
    evt.stopPropagation();
    if (locked || p.role === 'GK' || picking) return;
    evt.preventDefault(); // cegah seleksi teks / seret bawaan browser
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
    const q = toPitch(evt);
    if (q) setDrag({ id: p.id, ...q });
  }
  function move(evt) {
    if (!drag) return;
    const q = toPitch(evt);
    if (q) setDrag({ ...drag, ...q });
  }
  function end() {
    if (!drag) return;
    const slot = clampCustomSlot(slotForPoint({ x: drag.x, y: drag.y }, phase, style, CUSTOM_SLOT, ball));
    const id = drag.id;
    setDrag(null);
    onSetTactics({ [key]: { [zone]: { [id]: slot } } }, `${nameOf(id)}: posisi zona ${ZONE_LABEL[zone].toLowerCase()} (${phase === 'attack' ? 'dengan' : 'tanpa'} bola)`);
  }
  function clearZone() {
    onSetTactics({ [key]: { [zone]: null } }, `Zona ${ZONE_LABEL[zone].toLowerCase()} dikosongkan`);
  }
  function mirror() {
    const m = mirrorZone(players, tactics, layer, zone);
    const clearOld = Object.fromEntries(outfieldIds.map((id) => [id, null]));
    onSetTactics({ [key]: { [m.zone]: { ...clearOld, ...m.map } } }, `Zona ${ZONE_LABEL[zone].toLowerCase()} dicerminkan ke ${ZONE_LABEL[m.zone].toLowerCase()}`);
  }

  const count = zoneCount(tactics, key, zone);
  const scripts = tactics.scripts ?? [];
  const zoneScripts = scripts.filter((x) => x.zone === zone);
  const numberOf = (id) => players.find((q) => q.id === id)?.number ?? '?';
  function saveDraft(d) {
    const next = [...scripts.filter((x) => x.id !== d.id), { ...d, zone }];
    onSetTactics({ scripts: next }, `Skema "${d.name}" disimpan (${ZONE_LABEL[zone].toLowerCase()})`);
    setDraft(null);
    setPicking(null);
    setViewId(d.id);
  }
  function removeScript(id) {
    const s0 = scripts.find((x) => x.id === id);
    onSetTactics({ scripts: scripts.filter((x) => x.id !== id) }, `Skema "${s0?.name ?? ''}" dihapus`);
    if (viewId === id) setViewId(null);
  }

  return (
    <div className="zone-board">
      <div className="zone-bar">
        <div className="tac-options" role="group" aria-label="Layer zona">
          <button type="button" className={phase === 'defend' ? 'is-active' : undefined} disabled={Boolean(draft)} title={draft ? 'Simpan atau batalkan skema dulu' : undefined} onClick={() => pickPhase('defend')}>
            Tanpa bola
          </button>
          <button type="button" className={phase === 'attack' ? 'is-active' : undefined} disabled={Boolean(draft)} title={draft ? 'Simpan atau batalkan skema dulu' : undefined} onClick={() => pickPhase('attack')}>
            Dengan bola
          </button>
        </div>
        <div className="tac-options zone-picker" role="group" aria-label="Zona bola">
          {ZONES.map((z) => {
            const n = zoneCount(tactics, key, z);
            return (
              <button key={z} type="button" className={z === zone ? 'is-active' : undefined} title={draft ? 'Skema yang sedang diedit ikut pindah ke zona ini' : undefined} onClick={() => pickZone(z)}>
                {ZONE_LABEL[z]}
                {n > 0 && <span className="zone-count">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ghost-toggles">
        <label className="ghost-toggle ghost--base">
          <input type="checkbox" checked={ghostOn} onChange={toggleGhost} />
          <span className="ghost-swatch" aria-hidden="true" />
          Bayangan posisi layer biasa
        </label>
        <span className="zone-actions">
          <button type="button" className="lane-reset" onClick={mirror} disabled={locked || count === 0} title="Pemain dipetakan ke pasangannya di sisi lain (bek kiri ↔ bek kanan)">
            Cermin ke {ZONE_LABEL[mirrored].toLowerCase()}
          </button>
          <button type="button" className="lane-reset" onClick={clearZone} disabled={locked || count === 0}>
            Kosongkan zona
          </button>
        </span>
      </div>
      {(draft || picking) && (
        <p className="zone-notice" role="status">
          {picking ? (
            <>
              Klik lapangan untuk memilih titik.{' '}
              <button type="button" className="link-btn" onClick={() => setPicking(null)}>
                Batal (Esc)
              </button>
            </>
          ) : (
            <>
              Sedang mengedit skema "{draft.name}" untuk zona {ZONE_LABEL[zone].toLowerCase()} — pilih zona lain untuk memindahkannya. Editor ada di bawah
              lapangan.
            </>
          )}
        </p>
      )}
      <svg
        ref={svgRef}
        className="zone-svg"
        viewBox={`-1 -1 ${W + 2} ${H + 2}`}
        role="img"
        aria-label={`Detail zona ${ZONE_LABEL[zone]}, ${phase === 'attack' ? 'dengan' : 'tanpa'} bola`}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDrag(null)}
        onClick={(evt) => {
          if (!picking) return;
          const q = toPitch(evt);
          if (!q) return;
          picking.cb({ x: Math.round(q.x * 2) / 2, y: Math.round(q.y * 2) / 2 });
          setPicking(null);
        }}
        data-picking={picking ? 'ya' : undefined}
      >
        <rect x="0" y="0" width={W} height={H} className="lane-pitch" />
        <line x1={W / 2} x2={W / 2} y1="0" y2={H} className="lane-line" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="lane-divider" />
        <circle cx={W / 2} cy={H / 2} r={PITCH.centerCircleRadius} className="lane-line lane-line--fill" />
        <rect x="0" y={(H - BOX_W) / 2} width={PITCH.penaltyAreaDepth} height={BOX_W} className="lane-line lane-line--fill" />
        <rect x={W - PITCH.penaltyAreaDepth} y={(H - BOX_W) / 2} width={PITCH.penaltyAreaDepth} height={BOX_W} className="lane-line lane-line--fill" />
        {ZONES.map((z) => {
          const r = zoneRect(z);
          return (
            <g key={z} onClick={() => pickZone(z)} className="zone-cell">
              <rect x={r.x} y={r.y} width={r.w} height={r.h} className={z === zone ? 'zone-shade zone-shade--on' : 'zone-shade'} />
              <text x={r.x + 2} y={r.y + 4} className="zone-label">
                {ZONE_LABEL[z]}
                {zoneCount(tactics, key, z) > 0 ? ` · ${zoneCount(tactics, key, z)}` : ''}
              </text>
            </g>
          );
        })}
        <text x={W - 2} y={H - 1.5} className="lane-arrow" textAnchor="end">
          arah serang →
        </text>
        {ghosts.map(({ p, x, y }) => {
          const cur = here.get(p.id);
          const tx = drag?.id === p.id ? drag.x : cur?.x;
          const ty = drag?.id === p.id ? drag.y : cur?.y;
          const far = cur && Math.hypot(tx - x, ty - y) > 1;
          return (
            <g key={`g-${p.id}`} className="ghost ghost--base" pointerEvents="none">
              {far && <line x1={x} y1={y} x2={tx} y2={ty} className="ghost__line" />}
              <circle cx={x} cy={y} r="2.3" className="ghost__dot" />
              <text x={x} y={y + 0.95} textAnchor="middle" className="ghost__num">
                {p.number}
              </text>
            </g>
          );
        })}
        {phase === 'attack' && <ScriptOverlay script={draft ?? scripts.find((x) => x.id === viewId && x.zone === zone)} pos={(id) => here.get(id) ?? null} />}
        <g className="zone-ball" pointerEvents="none">
          <circle cx={ball.x} cy={ball.y} r="1.4" />
        </g>
        {items.map(({ p, x, y, custom }) => {
          const dragging = drag?.id === p.id;
          const cls = ['lane-dot', p.role !== 'GK' && !locked ? 'is-draggable' : '', dragging ? 'is-dragging' : ''].filter(Boolean).join(' ');
          return (
            <g key={p.id} transform={`translate(${dragging ? drag.x : x} ${dragging ? drag.y : y})`} className={cls} onPointerDown={(e) => start(e, p)}>
              <circle r="5" className="lane-dot__hit" />
              <circle r="2.6" fill={color} className={custom ? 'lane-dot__ring' : undefined} />
              <text y="1.05" textAnchor="middle">
                {p.number}
              </text>
            </g>
          );
        })}
      </svg>
      {phase === 'attack' ? (
        <section className="scripts" aria-label="Strategi detil">
          <div className="scripts__head">
            <h5>Strategi detil · {ZONE_LABEL[zone].toLowerCase()}</h5>
            {!draft && (
              <button
                type="button"
                className="lane-reset"
                disabled={locked || scripts.length >= 16}
                onClick={() => setDraft(blankScript(zone, players.find((q) => q.role !== 'GK')?.id))}
              >
                + Skema baru
              </button>
            )}
          </div>
          {!draft && zoneScripts.length === 0 && (
            <p className="tac-note">Belum ada skema di zona ini. Skema dijalankan saat bola dipegang pemain yang ditentukan di zona ini dan pemain skema sudah di posisi zonanya.</p>
          )}
          {!draft && zoneScripts.length > 0 && (
            <ul className="scripts__list">
              {zoneScripts.map((x) => (
                <li key={x.id} className={viewId === x.id ? 'is-on' : undefined}>
                  <button type="button" className="scripts__name" onClick={() => setViewId(viewId === x.id ? null : x.id)}>
                    {x.name}
                    <span className="tac-note">
                      {' '}
                      · bola di #{numberOf(x.holderId)} · {x.steps.length} langkah ·{' '}
                      {x.steps
                        .flatMap((st) => st.actions.map((a) => ACTION_LABEL[a.type].toLowerCase().split(' ')[0]))
                        .slice(0, 4)
                        .join(' → ')}
                    </span>
                    <span className="scripts__stats">
                      laga ini: aktif {scriptStats[x.id]?.started ?? 0} · selesai {scriptStats[x.id]?.completed ?? 0} · batal {scriptStats[x.id]?.aborted ?? 0} · tembakan {scriptStats[x.id]?.shots ?? 0}
                    </span>
                  </button>
                  <button type="button" className="link-btn" disabled={locked} onClick={() => setDraft(JSON.parse(JSON.stringify(x)))}>
                    ubah
                  </button>
                  <button type="button" className="link-btn" disabled={locked} onClick={() => removeScript(x.id)}>
                    hapus
                  </button>
                </li>
              ))}
            </ul>
          )}
          {draft && (
            <ScriptEditor
              draft={draft}
              players={players}
              locked={locked}
              picking={picking}
              onChange={setDraft}
              onPick={(at, cb) => setPicking({ ...at, cb })}
              onCancel={() => {
                setDraft(null);
                setPicking(null);
              }}
              onSave={saveDraft}
            />
          )}
        </section>
      ) : (
        <section className="scripts" aria-label="Strategi detil">
          <div className="scripts__head">
            <h5>Strategi detil</h5>
            <button type="button" className="lane-reset" onClick={() => pickPhase('attack')}>
              Buat skema (pindah ke Dengan bola)
            </button>
          </div>
          <p className="tac-note">Skema oper, lari, dan tembak dibuat untuk saat tim memegang bola.</p>
        </section>
      )}
      <p className="lane-legend">
        Pilih zona (klik kotaknya atau tombol di atas), lalu seret pemain: itu posisinya saat bola ada di zona tersebut. Zona yang tidak diatur memakai
        posisi layer biasa; saat bola berpindah zona, pemain bergeser halus di antara skema. Cincin kuning = posisi zona ini · ⚪ = bola contoh.
      </p>
    </div>
  );
}
