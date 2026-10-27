import { useMemo, useState, useCallback, useRef } from 'react';
import MatchView from './components/MatchView.jsx';
import { createDemoTeams } from './engine/teams.js';
import { createSimulation } from './engine/simulation.js';
import { TICK_RATE } from './engine/constants.js';

const TEAM_SEED = 2026;
const SPEEDS = [1, 2, 4, 8];

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

function formatClock(tick) {
  const totalSeconds = Math.floor(tick / TICK_RATE);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function formatPasses({ attempted, completed }) {
  return `${completed}/${attempted}`;
}

export default function App() {
  const [matchSeed, setMatchSeed] = useState(randomSeed);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const clockRef = useRef(null);
  const statRefs = {
    homePossession: useRef(null),
    awayPossession: useRef(null),
    possessionBar: useRef(null),
    homePasses: useRef(null),
    awayPasses: useRef(null),
  };

  const { home, away, simulation } = useMemo(() => {
    const teams = createDemoTeams(TEAM_SEED);
    return { ...teams, simulation: createSimulation(teams.home, teams.away, matchSeed) };
  }, [matchSeed]);

  // Jam dan statistik diperbarui langsung di DOM, tanpa render ulang React setiap tick.
  const handleTick = useCallback(
    (state) => {
      if (clockRef.current) clockRef.current.textContent = formatClock(state.tick);

      const { possessionTicks, passes } = state.stats;
      const total = possessionTicks[home.id] + possessionTicks[away.id];
      const homeShare = percent(possessionTicks[home.id], total);
      const set = (ref, text) => {
        if (ref.current) ref.current.textContent = text;
      };
      set(statRefs.homePossession, `${homeShare}%`);
      set(statRefs.awayPossession, `${total > 0 ? 100 - homeShare : 0}%`);
      if (statRefs.possessionBar.current) statRefs.possessionBar.current.style.width = `${total > 0 ? homeShare : 50}%`;
      set(statRefs.homePasses, formatPasses(passes[home.id]));
      set(statRefs.awayPasses, formatPasses(passes[away.id]));
    },
    // statRefs berisi ref yang stabil; home/away berubah hanya saat simulasi baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home.id, away.id],
  );

  function restart() {
    if (clockRef.current) clockRef.current.textContent = formatClock(0);
    setMatchSeed(randomSeed());
    setRunning(true);
  }

  return (
    <main className="app">
      <header className="scoreboard">
        <TeamLabel team={home} align="right" />
        <div className="score">
          0 – 0
          <span ref={clockRef} className="clock">
            00:00
          </span>
        </div>
        <TeamLabel team={away} align="left" />
      </header>

      <MatchView simulation={simulation} running={running} speed={speed} onTick={handleTick} />

      <section className="match-stats" aria-label="Statistik pertandingan">
        <div className="stat-row">
          <span ref={statRefs.homePossession} className="stat-value">0%</span>
          <span className="stat-label">Penguasaan bola</span>
          <span ref={statRefs.awayPossession} className="stat-value stat-value--away">0%</span>
        </div>
        <div className="possession-track" style={{ background: away.colors.shirt }}>
          <div ref={statRefs.possessionBar} className="possession-fill" style={{ background: home.colors.shirt }} />
        </div>
        <div className="stat-row">
          <span ref={statRefs.homePasses} className="stat-value">0/0</span>
          <span className="stat-label">Operan sukses / dicoba</span>
          <span ref={statRefs.awayPasses} className="stat-value stat-value--away">0/0</span>
        </div>
      </section>

      <div className="controls">
        <button type="button" onClick={() => setRunning((r) => !r)}>
          {running ? 'Jeda' : 'Lanjut'}
        </button>
        <div className="speed-group" role="group" aria-label="Kecepatan">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={s === speed ? 'is-active' : undefined}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
        <button type="button" onClick={restart}>
          Ulang (seed baru)
        </button>
        <span className="stage-note">Tahap 3 — penguasaan & operan. Seed: {matchSeed}</span>
      </div>
    </main>
  );
}

function TeamLabel({ team, align }) {
  return (
    <div className={`team-label team-label--${align}`}>
      <span className="team-swatch" style={{ background: team.colors.shirt }} />
      <span className="team-name">{team.name}</span>
      <span className="team-formation">{team.formation}</span>
    </div>
  );
}
