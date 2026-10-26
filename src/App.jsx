import { useMemo } from 'react';
import MatchView from './components/MatchView.jsx';
import { createDemoTeams } from './engine/teams.js';
import { createMatchState } from './engine/state.js';

const MATCH_SEED = 2026;

export default function App() {
  const { home, away, state } = useMemo(() => {
    const teams = createDemoTeams(MATCH_SEED);
    return { ...teams, state: createMatchState(teams.home, teams.away) };
  }, []);

  return (
    <main className="app">
      <header className="scoreboard">
        <TeamLabel team={home} align="right" />
        <div className="score">0 – 0</div>
        <TeamLabel team={away} align="left" />
      </header>

      <MatchView state={state} />

      <p className="stage-note">Tahap 1 — posisi kick-off. Seed: {MATCH_SEED}</p>
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
