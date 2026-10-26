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

export default function App() {
  const [matchSeed, setMatchSeed] = useState(randomSeed);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const clockRef = useRef(null);

  const { home, away, simulation } = useMemo(() => {
    const teams = createDemoTeams(TEAM_SEED);
    return { ...teams, simulation: createSimulation(teams.home, teams.away, matchSeed) };
  }, [matchSeed]);

  // Jam diperbarui langsung di DOM, tanpa render ulang React setiap tick.
  const handleTick = useCallback((tick) => {
    if (clockRef.current) clockRef.current.textContent = formatClock(tick);
  }, []);

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
        <span className="stage-note">Tahap 2 — uji gerak. Seed: {matchSeed}</span>
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
