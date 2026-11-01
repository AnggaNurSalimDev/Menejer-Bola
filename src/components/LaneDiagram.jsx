import { useRef, useState } from 'react';
import { PITCH } from '../engine/pitch.js';
import { computeAnchor, slotForPoint } from '../engine/shape.js';
import { teamStyle, effectiveSlot, clampCustomSlot, CUSTOM_SLOT, baseSlots } from '../engine/tactics.js';

// Gambar & layer taktik (1 Nov, ide pengguna): lapangan dilihat dari arah serang tim (selalu ke kanan),
// jalur kiri di atas. Posisi dihitung dengan rumus jangkar engine (bola di tengah lapangan).
// Layer "Dengan bola" & "Tanpa bola": seret bulatan → titik patokan pribadi pemain itu. Pemain tetap
// bergeser mengikuti bola, menjaga lawan & berlari — titik ini bobot besar, bukan rel kaku.

const LANE_NAMES = ['Kiri', 'Half-space kiri', 'Tengah', 'Half-space kanan', 'Kanan'];
const W = PITCH.length;
const H = PITCH.width;
const BAND = H / 5;
const CENTER_BALL = Object.freeze({ x: PITCH.length / 2, y: PITCH.width / 2 });
const BOX_W = 40.32;

// Bayangan (2 Nov, masukan pengguna: "bingung pemain mana pindah ke mana"): posisi formasi dasar dan
// posisi fase lainnya, digambar tipis di bawah bulatan, dengan garis ke posisi di layer ini.
const GHOST_KEY = 'menejer-bola:bayangan';

function readGhosts() {
  try {
    const raw = window.localStorage.getItem(GHOST_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveGhost(key, on) {
  try {
    const all = readGhosts();
    all[key] = on;
    window.localStorage.setItem(GHOST_KEY, JSON.stringify(all));
  } catch {
    // penyimpanan tidak tersedia: abaikan
  }
}

// Bentuk fase yang sedang dibuka, supaya formasi yang sama tanpa seretan tepat menumpuk (tanpa garis).
function basePositions(players, tactics, phase) {
  const slots = baseSlots(players, tactics);
  const style = teamStyle(tactics);
  return players.map((p) => {
    const a = computeAnchor({ ...p, slot: slots.get(p.id) ?? p.slot }, CENTER_BALL, true, phase, style);
    return { p, x: a.x, y: a.y };
  });
}

function positions(players, tactics, phase) {
  const style = teamStyle(tactics);
  return players.map((p) => {
    const layer = phase === 'attack' ? 'in' : 'out';
    const slot = p.role === 'GK' ? p.slot : effectiveSlot(p, tactics, layer);
    const a = computeAnchor({ ...p, slot }, CENTER_BALL, true, phase, style);
    const custom = Boolean((phase === 'attack' ? tactics.customIn : tactics.customOut)?.[p.id]);
    const lane = phase === 'attack' && (tactics.playerLanes?.[p.id] ?? 'tetap') !== 'tetap';
    const man = phase === 'defend' && tactics.marking?.[p.id] === 'tempel';
    return { p, x: a.x, y: a.y, marked: custom || lane, man };
  });
}

export function LayerPitch({ title, phase, players, tactics, color, highlightId, locked, onSet, onReset, showLaneNames }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id, x, y }
  const [ghostOn, setGhostOn] = useState(() => readGhosts());
  const items = positions(players, tactics, phase);
  const otherPhase = phase === 'attack' ? 'defend' : 'attack';
  const ghostDefs = [
    { key: `${phase}:dasar`, label: 'Formasi dasar', cls: 'ghost--base', items: () => basePositions(players, tactics, phase) },
    { key: `${phase}:lain`, label: otherPhase === 'attack' ? 'Dengan bola' : 'Tanpa bola', cls: `ghost--${otherPhase}`, items: () => positions(players, tactics, otherPhase) },
  ];
  const ghosts = ghostDefs.filter((g) => ghostOn[g.key]).map((g) => ({ ...g, list: g.items() }));
  const here = new Map(items.map((it) => [it.p.id, it]));
  function toggleGhost(key) {
    const next = !ghostOn[key];
    setGhostOn({ ...ghostOn, [key]: next });
    saveGhost(key, next);
  }
  const anyCustom = phase === 'attack'
    ? Object.keys(tactics.customIn ?? {}).length + Object.keys(tactics.playerLanes ?? {}).length > 0
    : Object.keys(tactics.customOut ?? {}).length > 0;

  function toPitch(evt) {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const q = pt.matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(W, q.x)), y: Math.max(0, Math.min(H, q.y)) };
  }

  function start(evt, p) {
    if (locked || p.role === 'GK') return;
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
    const slot = clampCustomSlot(slotForPoint({ x: drag.x, y: drag.y }, phase, teamStyle(tactics), CUSTOM_SLOT));
    const id = drag.id;
    setDrag(null);
    onSet(phase === 'attack' ? { customIn: { [id]: slot }, playerLanes: { [id]: null } } : { customOut: { [id]: slot } }, id);
  }

  return (
    <figure className="lane-fig">
      <figcaption>
        <span>{title}</span>
        {anyCustom && (
          <button type="button" className="lane-reset" onClick={onReset} disabled={locked}>
            Kembali ke formasi
          </button>
        )}
      </figcaption>
      <div className="ghost-toggles" role="group" aria-label="Bayangan posisi">
        <span>Bayangan:</span>
        {ghostDefs.map((g) => (
          <label key={g.key} className={`ghost-toggle ${g.cls}`}>
            <input type="checkbox" checked={Boolean(ghostOn[g.key])} onChange={() => toggleGhost(g.key)} />
            <span className="ghost-swatch" aria-hidden="true" />
            {g.label}
          </label>
        ))}
      </div>
      <svg ref={svgRef} viewBox={`-1 -1 ${W + 2} ${H + 2}`} role="img" aria-label={title} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
        <rect x="0" y="0" width={W} height={H} className="lane-pitch" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="0" y={i * BAND} width={W} height={BAND} className={i % 2 ? 'lane-band lane-band--alt' : 'lane-band'} />
        ))}
        {[1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" x2={W} y1={i * BAND} y2={i * BAND} className="lane-divider" />
        ))}
        <line x1={W / 2} x2={W / 2} y1="0" y2={H} className="lane-line" />
        <circle cx={W / 2} cy={H / 2} r={PITCH.centerCircleRadius} className="lane-line lane-line--fill" />
        <rect x="0" y={(H - BOX_W) / 2} width={PITCH.penaltyAreaDepth} height={BOX_W} className="lane-line lane-line--fill" />
        <rect x={W - PITCH.penaltyAreaDepth} y={(H - BOX_W) / 2} width={PITCH.penaltyAreaDepth} height={BOX_W} className="lane-line lane-line--fill" />
        {showLaneNames &&
          LANE_NAMES.map((n, i) => (
            <text key={n} x={W / 2 + 1.5} y={i * BAND + 3.2} className="lane-name">
              {n}
            </text>
          ))}
        <text x={W - 2} y={H - 1.5} className="lane-arrow" textAnchor="end">
          arah serang →
        </text>
        {ghosts.map((g) =>
          g.list.map(({ p, x, y }) => {
            const cur = here.get(p.id);
            const tx = drag?.id === p.id ? drag.x : cur?.x;
            const ty = drag?.id === p.id ? drag.y : cur?.y;
            const far = cur && Math.hypot(tx - x, ty - y) > 1;
            return (
              <g key={`${g.key}-${p.id}`} className={`ghost ${g.cls}`} pointerEvents="none">
                {far && <line x1={x} y1={y} x2={tx} y2={ty} className="ghost__line" />}
                <circle cx={x} cy={y} r="2.3" className="ghost__dot" />
                <text x={x} y={y + 0.95} textAnchor="middle" className="ghost__num">
                  {p.number}
                </text>
              </g>
            );
          }),
        )}
        {items.map(({ p, x, y, marked, man }) => {
          const dragging = drag?.id === p.id;
          const cx = dragging ? drag.x : x;
          const cy = dragging ? drag.y : y;
          const cls = ['lane-dot', p.id === highlightId ? 'is-hl' : '', p.role !== 'GK' && !locked ? 'is-draggable' : '', dragging ? 'is-dragging' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <g key={p.id} transform={`translate(${cx} ${cy})`} className={cls} onPointerDown={(e) => start(e, p)}>
              <circle r="5" className="lane-dot__hit" />
              <circle r="2.6" fill={color} className={man ? 'lane-dot__man' : marked ? 'lane-dot__ring' : undefined} />
              <text y="1.05" textAnchor="middle">
                {p.number}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export default function LaneDiagram({ players, tactics, color, highlightId, locked, onSetTactics, nameOf }) {
  if (!tactics || !Array.isArray(players) || players.length === 0) return null;
  const ids = players.filter((p) => p.role !== 'GK').map((p) => p.id);
  const clear = (key) => Object.fromEntries(ids.map((id) => [id, null]));
  return (
    <div className="lane-diagram">
      <LayerPitch
        title="Dengan bola"
        phase="attack"
        players={players}
        tactics={tactics}
        color={color}
        highlightId={highlightId}
        locked={locked}
        showLaneNames
        onSet={(changes, id) => onSetTactics(changes, `${nameOf(id)}: posisi dengan bola diubah`)}
        onReset={() => onSetTactics({ customIn: clear('customIn'), playerLanes: clear('playerLanes') }, 'Dengan bola: kembali ke formasi')}
      />
      <LayerPitch
        title="Tanpa bola"
        phase="defend"
        players={players}
        tactics={tactics}
        color={color}
        highlightId={highlightId}
        locked={locked}
        onSet={(changes, id) => onSetTactics(changes, `${nameOf(id)}: posisi tanpa bola diubah`)}
        onReset={() => onSetTactics({ customOut: clear('customOut') }, 'Tanpa bola: kembali ke formasi')}
      />
      <p className="lane-legend">
        Seret bulatan untuk menaruh titik patokan pemain (bukan rel kaku: pemain tetap bergeser mengikuti bola dan menjaga lawan). Cincin kuning = posisi/jalur
        pribadi · cincin merah = tempel lawan. Posisi digambar saat bola di tengah lapangan; tanpa bola tim merapat ke arah bola, jadi titik di pinggir ditarik ke dalam.
      </p>
    </div>
  );
}
