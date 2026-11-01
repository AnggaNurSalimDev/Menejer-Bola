import { PITCH } from '../engine/pitch.js';
import { computeAnchor } from '../engine/shape.js';
import { teamStyle, laneSlot } from '../engine/tactics.js';

// Gambar taktik 5 jalur (1 Nov, masukan pengguna: "dibuat dengan gambar agar lebih intuitif").
// Lapangan dilihat dari arah serang tim (selalu ke kanan): jalur kiri di atas, kanan di bawah.
// Posisi dihitung dengan rumus jangkar yang sama dengan engine (bola di tengah lapangan),
// jadi gambar ini menunjukkan bentuk yang benar-benar dipakai pemain.

const LANE_NAMES = ['Kiri', 'Half-space kiri', 'Tengah', 'Half-space kanan', 'Kanan'];
const W = PITCH.length;
const H = PITCH.width;
const BAND = H / 5;
const CENTER_BALL = Object.freeze({ x: PITCH.length / 2, y: PITCH.width / 2 });

function positions(players, tactics, phase) {
  const style = teamStyle(tactics);
  return players.map((p) => {
    if (p.role === 'GK') {
      const a = computeAnchor({ ...p, slot: p.slot }, CENTER_BALL, true, phase, style);
      return { p, x: a.x, y: a.y, order: 'tetap' };
    }
    const order = phase === 'attack' ? (tactics.playerLanes?.[p.id] ?? 'tetap') : 'tetap';
    const base = phase === 'attack' ? (p.slotIn ?? p.slot) : (p.slotOut ?? p.slot);
    const slot = phase === 'attack' ? laneSlot(base, order) : base;
    const a = computeAnchor({ ...p, slot }, CENTER_BALL, true, phase, style);
    return { p, x: a.x, y: a.y, order };
  });
}

function Pitch({ title, items, color, highlightId, showLaneNames }) {
  return (
    <figure className="lane-fig">
      <figcaption>{title}</figcaption>
      <svg viewBox={`-1 -1 ${W + 2} ${H + 2}`} role="img" aria-label={title}>
        <rect x="0" y="0" width={W} height={H} className="lane-pitch" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x="0" y={i * BAND} width={W} height={BAND} className={i % 2 ? 'lane-band lane-band--alt' : 'lane-band'} />
        ))}
        {[1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" x2={W} y1={i * BAND} y2={i * BAND} className="lane-divider" />
        ))}
        <line x1={W / 2} x2={W / 2} y1="0" y2={H} className="lane-line" />
        <circle cx={W / 2} cy={H / 2} r={PITCH.centerCircleRadius} className="lane-line lane-line--fill" />
        <rect x="0" y={(H - 40.32) / 2} width={PITCH.penaltyAreaDepth} height="40.32" className="lane-line lane-line--fill" />
        <rect x={W - PITCH.penaltyAreaDepth} y={(H - 40.32) / 2} width={PITCH.penaltyAreaDepth} height="40.32" className="lane-line lane-line--fill" />
        {showLaneNames &&
          LANE_NAMES.map((n, i) => (
            <text key={n} x={W / 2 + 1.5} y={i * BAND + 3.2} className="lane-name">
              {n}
            </text>
          ))}
        <text x={W - 2} y={H - 1.5} className="lane-arrow" textAnchor="end">
          arah serang →
        </text>
        {items.map(({ p, x, y, order }) => (
          <g key={p.id} transform={`translate(${x} ${y})`} className={p.id === highlightId ? 'lane-dot is-hl' : 'lane-dot'}>
            <circle r="2.6" fill={color} className={order !== 'tetap' ? 'lane-dot__ring' : undefined} />
            <text y="1.05" textAnchor="middle">
              {p.number}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}

export default function LaneDiagram({ players, tactics, color, highlightId }) {
  if (!tactics || !Array.isArray(players) || players.length === 0) return null;
  return (
    <div className="lane-diagram">
      <Pitch title="Dengan bola" items={positions(players, tactics, 'attack')} color={color} highlightId={highlightId} showLaneNames />
      <Pitch title="Tanpa bola" items={positions(players, tactics, 'defend')} color={color} highlightId={highlightId} />
      <p className="lane-legend">
        Bulatan bercincin kuning = pemain dengan instruksi jalur. Posisi saat bola di tengah lapangan; saat bermain, tim ikut bergeser mengikuti bola.
      </p>
    </div>
  );
}
