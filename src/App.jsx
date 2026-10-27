import { useMemo, useState, useCallback, useRef } from 'react';
import MatchView from './components/MatchView.jsx';
import { createDemoTeams } from './engine/teams.js';
import { createSimulation } from './engine/simulation.js';
import { gameClock } from './engine/state.js';

const TEAM_SEED = 2026;
const SPEEDS = [1, 2, 4, 8];

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

// ?seed=123 di alamat halaman memutar ulang pertandingan tertentu (untuk melacak bug).
function initialSeed() {
  try {
    const fromUrl = Number(new URLSearchParams(window.location.search).get('seed'));
    if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl;
  } catch {
    // Alamat tidak bisa dibaca: pakai seed acak.
  }
  return randomSeed();
}

// Jam pertandingan: 0'–45' di babak 1, 45'–90' di babak 2 (dipercepat).
function formatClock(state) {
  if (state.period === 'halftime') return 'Jeda';
  if (state.period === 'fulltime') return 'Selesai';
  return `${gameClock(state).minute}'`;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// Baris statistik: label + cara membaca angka satu tim dari state.stats.
const STAT_ROWS = [
  { key: 'shots', label: 'Tembakan (tepat sasaran)', read: (s, id) => `${s.shots[id].total} (${s.shots[id].onTarget})` },
  { key: 'passes', label: 'Operan sukses / dicoba', read: (s, id) => `${s.passes[id].completed}/${s.passes[id].attempted}` },
  { key: 'tackles', label: 'Tekel berhasil / dicoba', read: (s, id) => `${s.tackles[id].won}/${s.tackles[id].attempted}` },
  { key: 'offsides', label: 'Offside', read: (s, id) => `${s.offsides[id]}` },
  {
    key: 'saves',
    label: 'Penyelamatan kiper',
    read: (s, id) => `${s.saves[id].caught + s.saves[id].parried}`,
  },
];

export default function App() {
  const [matchSeed, setMatchSeed] = useState(initialSeed);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  // Snapshot state saat jeda babak / peluit akhir (null = sedang bermain).
  // Hanya berubah dua kali per pertandingan, jadi aman memakai state React.
  const [breakState, setBreakState] = useState(null);

  const clockRef = useRef(null);
  const scoreRef = useRef(null);
  const goalBannerRef = useRef(null);
  const possessionRefs = { home: useRef(null), away: useRef(null), bar: useRef(null) };
  const rowRefs = useRef({});

  const { home, away, simulation, namesById } = useMemo(() => {
    const teams = createDemoTeams(TEAM_SEED);
    const names = new Map(
      [...teams.home.players, ...teams.away.players].map((p) => [p.id, p.shortName]),
    );
    return { ...teams, namesById: names, simulation: createSimulation(teams.home, teams.away, matchSeed) };
  }, [matchSeed]);

  // Semua angka diperbarui langsung di DOM, tanpa render ulang React setiap tick.
  const handleTick = useCallback(
    (state) => {
      const set = (el, text) => {
        if (el && el.textContent !== text) el.textContent = text;
      };
      const { stats } = state;

      if (state.period === 'halftime' || state.period === 'fulltime') {
        setBreakState((current) => (current?.period === state.period ? current : state));
      }

      set(clockRef.current, formatClock(state));
      set(scoreRef.current, `${stats.goals[home.id]} – ${stats.goals[away.id]}`);

      const total = stats.possessionTicks[home.id] + stats.possessionTicks[away.id];
      const homeShare = percent(stats.possessionTicks[home.id], total);
      set(possessionRefs.home.current, `${homeShare}%`);
      set(possessionRefs.away.current, `${total > 0 ? 100 - homeShare : 0}%`);
      if (possessionRefs.bar.current) possessionRefs.bar.current.style.width = `${total > 0 ? homeShare : 50}%`;

      for (const row of STAT_ROWS) {
        set(rowRefs.current[`${row.key}-home`], row.read(stats, home.id));
        set(rowRefs.current[`${row.key}-away`], row.read(stats, away.id));
      }

      // Tulisan GOL! selama jeda setelah gol.
      const banner = goalBannerRef.current;
      if (banner) {
        const showing = state.pauseTicks > 0 && state.lastGoal !== null;
        banner.hidden = !showing;
        if (showing) {
          const goal = state.lastGoal;
          const team = goal.teamId === home.id ? home : away;
          const scorer = goal.scorerId ? namesById.get(goal.scorerId) : null;
          const who = goal.ownGoal ? 'gol bunuh diri' : (scorer ?? team.name);
          set(banner.querySelector('.goal-banner__detail'), `${who} · ${team.name}`);
          banner.style.setProperty('--goal-color', team.colors.shirt);
        }
      }
    },
    // Ref di atas stabil; home/away/namesById berubah hanya saat simulasi baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, away, namesById],
  );

  function restart() {
    if (clockRef.current) clockRef.current.textContent = "0'";
    if (scoreRef.current) scoreRef.current.textContent = '0 – 0';
    if (goalBannerRef.current) goalBannerRef.current.hidden = true;
    setBreakState(null);
    setMatchSeed(randomSeed());
    setRunning(true);
  }

  function startSecondHalf() {
    if (simulation.getState().period !== 'halftime') return;
    simulation.startSecondHalf();
    setBreakState(null);
    setRunning(true);
  }

  return (
    <main className="app">
      <header className="scoreboard">
        <TeamLabel team={home} align="right" />
        <div className="score">
          <span ref={scoreRef}>0 – 0</span>
          <span ref={clockRef} className="clock">
            0'
          </span>
        </div>
        <TeamLabel team={away} align="left" />
      </header>

      <div className="pitch-wrap">
        <MatchView simulation={simulation} running={running} speed={speed} onTick={handleTick} />
        <div ref={goalBannerRef} className="goal-banner" hidden aria-live="polite">
          <span className="goal-banner__title">GOL!</span>
          <span className="goal-banner__detail" />
        </div>
        {breakState && (
          <BreakScreen
            state={breakState}
            home={home}
            away={away}
            onContinue={breakState.period === 'halftime' ? startSecondHalf : restart}
          />
        )}
      </div>

      <section className="match-stats" aria-label="Statistik pertandingan">
        <div className="stat-row">
          <span ref={possessionRefs.home} className="stat-value">0%</span>
          <span className="stat-label">Penguasaan bola</span>
          <span ref={possessionRefs.away} className="stat-value stat-value--away">0%</span>
        </div>
        <div className="possession-track" style={{ background: away.colors.shirt }}>
          <div ref={possessionRefs.bar} className="possession-fill" style={{ background: home.colors.shirt }} />
        </div>
        {STAT_ROWS.map((row) => (
          <div key={row.key} className="stat-row">
            <span ref={(el) => (rowRefs.current[`${row.key}-home`] = el)} className="stat-value">
              –
            </span>
            <span className="stat-label">{row.label}</span>
            <span ref={(el) => (rowRefs.current[`${row.key}-away`] = el)} className="stat-value stat-value--away">
              –
            </span>
          </div>
        ))}
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
        <span className="stage-note">Tahap 5b — offside, lari & umpan terobosan. Seed: {matchSeed}</span>
      </div>
    </main>
  );
}

// Layar jeda babak dan layar akhir pertandingan. Di tahap layer manager,
// layar jeda ini menjadi tempat mengubah taktik dan formasi.
function BreakScreen({ state, home, away, onContinue }) {
  const isHalftime = state.period === 'halftime';
  const { stats } = state;
  const total = stats.possessionTicks[home.id] + stats.possessionTicks[away.id];
  const homeShare = percent(stats.possessionTicks[home.id], total);
  const rows = [
    { label: 'Penguasaan bola', home: `${homeShare}%`, away: `${100 - homeShare}%` },
    ...STAT_ROWS.map((row) => ({ label: row.label, home: row.read(stats, home.id), away: row.read(stats, away.id) })),
  ];

  return (
    <div className="break-screen" role="dialog" aria-label={isHalftime ? 'Jeda babak' : 'Pertandingan selesai'}>
      <div className="break-card">
        <p className="break-title">{isHalftime ? 'Turun minum' : 'Pertandingan selesai'}</p>
        <p className="break-score">
          <span>{home.name}</span>
          <strong>
            {stats.goals[home.id]} – {stats.goals[away.id]}
          </strong>
          <span>{away.name}</span>
        </p>
        <dl className="break-stats">
          {rows.map((row) => (
            <div key={row.label} className="break-row">
              <dd>{row.home}</dd>
              <dt>{row.label}</dt>
              <dd>{row.away}</dd>
            </div>
          ))}
        </dl>
        {isHalftime && <p className="break-note">Pengaturan taktik akan tersedia di sini setelah layer manager dibuat.</p>}
        <button type="button" className="break-button" onClick={onContinue} autoFocus>
          {isHalftime ? 'Lanjut babak 2' : 'Main lagi (seed baru)'}
        </button>
      </div>
    </div>
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
