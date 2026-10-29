import { useState } from 'react';
import { SUBS, substitutionErrors, roleLine } from '../engine/substitution.js';
import { gameClock } from '../engine/state.js';
import { getMentality } from '../engine/mentality.js';

// Tab "Tim" (layer manajer 8a): susunan pemain, kondisi, bangku cadangan, antrian pergantian.
// Simulasi TETAP berjalan saat tab ini dibuka (keputusan 29 Okt). Pergantian hanya diantrikan:
//   babak 1 / jeda → dijalankan saat babak 2 dimulai; babak 2 → pada bola mati berikutnya.

const RATING_KEYS = [
  'kecepatan',
  'stamina',
  'kekuatan',
  'passing',
  'kontrol',
  'dribbling',
  'finishing',
  'tackling',
  'visi',
  'keputusan',
  'posisi',
];

function rating(skills) {
  const values = RATING_KEYS.map((k) => skills[k]).filter(Number.isFinite);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

function whenText(state) {
  if (state.period === 'first' || state.period === 'halftime') return 'Dijalankan saat babak 2 dimulai.';
  if (state.period === 'second') return 'Dijalankan pada bola mati berikutnya.';
  return 'Pertandingan sudah selesai.';
}

function EnergyBar({ value }) {
  const pct = Math.round(value * 100);
  const tone = value < 0.45 ? 'low' : value < 0.65 ? 'mid' : 'ok';
  return (
    <span className={`energy energy--${tone}`} title={`Tenaga ${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export default function TeamTab({ state, teamId, simulation, onChange, namesById }) {
  const [outId, setOutId] = useState(null);
  const [inId, setInId] = useState(null);
  const [message, setMessage] = useState(null);

  if (!state) return <p className="team-empty">Memuat…</p>;
  const team = state.teams[teamId];
  if (!team) return <p className="team-empty">Tim tidak ditemukan.</p>;

  const onPitch = state.players.filter((p) => p.teamId === teamId);
  const queuedOut = new Set(team.subQueue.map((q) => q.outId));
  const queuedIn = new Set(team.subQueue.map((q) => q.inId));
  const used = team.subsUsed;
  const left = SUBS.max - used - team.subQueue.length;
  const sentOff = state.sentOff.filter((p) => p.teamId === teamId);
  const subbedOff = (state.subbedOff ?? []).filter((p) => p.teamId === teamId);
  const errors = outId && inId ? substitutionErrors(state, teamId, outId, inId) : [];
  const name = (id) => namesById.get(id) ?? id;

  function queue() {
    // Guard: state bisa sudah berubah sejak tombol ditekan (simulasi tetap berjalan).
    const fresh = simulation.getState();
    const problems = substitutionErrors(fresh, teamId, outId, inId);
    if (problems.length > 0) {
      setMessage({ tone: 'error', text: problems.join('; ') });
      return;
    }
    const next = simulation.queueSubstitution(teamId, outId, inId);
    setMessage({ tone: 'info', text: `${name(outId)} ➜ ${name(inId)} diantrikan. ${whenText(next)}` });
    setOutId(null);
    setInId(null);
    onChange(next);
  }

  function cancel(index) {
    onChange(simulation.cancelSubstitution(teamId, index));
  }

  const minute = state.period === 'halftime' ? 'Jeda' : state.period === 'fulltime' ? 'Selesai' : `${gameClock(state).minute}'`;

  return (
    <section className="team-tab" aria-label="Pengaturan tim">
      <header className="team-tab__head">
        <div>
          <h2>{team.name}</h2>
          <p className="team-tab__meta">
            {minute} · Mentalitas: {getMentality(team.mentality).label} · Pergantian {used}/{SUBS.max}
            {team.subQueue.length > 0 ? ` (+${team.subQueue.length} antre)` : ''}
          </p>
        </div>
        <p className="team-tab__live">● Pertandingan tetap berjalan</p>
      </header>

      {message && <p className={`team-msg team-msg--${message.tone}`}>{message.text}</p>}

      <div className="team-columns">
        <div className="team-col">
          <h3>Di lapangan ({onPitch.length})</h3>
          <ul className="roster">
            {onPitch.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`roster-row${outId === p.id ? ' is-selected' : ''}${queuedOut.has(p.id) ? ' is-queued' : ''}`}
                  onClick={() => setOutId(outId === p.id ? null : p.id)}
                  disabled={queuedOut.has(p.id) || state.period === 'fulltime'}
                >
                  <span className="roster-num">{p.number}</span>
                  <span className="roster-name">
                    {p.shortName}
                    {p.discipline.yellows > 0 && <span className="card-chip" title="Kartu kuning" />}
                    {queuedOut.has(p.id) && <span className="roster-tag">keluar</span>}
                  </span>
                  <span className="roster-role">{p.role}</span>
                  <EnergyBar value={p.condition.energy} />
                </button>
              </li>
            ))}
          </ul>
          {(sentOff.length > 0 || subbedOff.length > 0) && (
            <p className="roster-note">
              {sentOff.map((p) => `🟥 ${p.shortName}`).join(', ')}
              {sentOff.length && subbedOff.length ? ' · ' : ''}
              {subbedOff.length > 0 ? `Sudah keluar: ${subbedOff.map((p) => p.shortName).join(', ')}` : ''}
            </p>
          )}
        </div>

        <div className="team-col">
          <h3>Cadangan ({team.bench.length})</h3>
          <ul className="roster">
            {team.bench.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`roster-row${inId === p.id ? ' is-selected' : ''}${queuedIn.has(p.id) ? ' is-queued' : ''}`}
                  onClick={() => setInId(inId === p.id ? null : p.id)}
                  disabled={queuedIn.has(p.id) || state.period === 'fulltime'}
                >
                  <span className="roster-num">{p.number}</span>
                  <span className="roster-name">
                    {p.shortName}
                    {queuedIn.has(p.id) && <span className="roster-tag">masuk</span>}
                  </span>
                  <span className="roster-role">{p.naturalRole}</span>
                  <span className="roster-rating" title="Rata-rata stat utama">
                    {rating(p.skills)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sub-panel">
        <p className="sub-pick">
          {outId ? `Keluar: ${name(outId)}` : 'Pilih pemain keluar'} ➜ {inId ? `Masuk: ${name(inId)}` : 'pilih cadangan'}
          {outId &&
            inId &&
            roleLine(onPitch.find((p) => p.id === outId)?.role ?? '') !==
              roleLine(team.bench.find((p) => p.id === inId)?.naturalRole ?? '') && <span className="sub-warn"> (beda posisi asli)</span>}
        </p>
        <button type="button" className="break-button" onClick={queue} disabled={!outId || !inId || errors.length > 0 || left <= 0}>
          Antrikan pergantian
        </button>
        {errors.length > 0 && <p className="team-msg team-msg--error">{errors.join('; ')}</p>}
        <p className="sub-when">{whenText(state)}</p>
        {team.subQueue.length > 0 && (
          <ul className="sub-queue">
            {team.subQueue.map((q, i) => (
              <li key={`${q.outId}-${q.inId}`}>
                ⏳ {name(q.outId)} ➜ {name(q.inId)}
                <button type="button" onClick={() => cancel(i)}>
                  Batal
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
