import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import MatchView from './components/MatchView.jsx';
import TeamTab from './components/TeamTab.jsx';
import { createDemoTeams } from './engine/teams.js';
import { createSimulation } from './engine/simulation.js';
import { gameClock } from './engine/state.js';
import { getPhilosophy } from './engine/philosophy.js';
import { CLUB_STYLES, STYLE_KEYS, styleTactics, randomStyle } from './engine/clubStyles.js';
import { buildMatchTeams, completeWeek, seasonOver, clubLogo, matchReportFromState, effectiveLineup, absentPlayers, clubById, userFixture, simulateToUserMatch, currentRound, isKnockout } from './engine/league.js';
import { roundLabel, dateLabel } from './components/compLabels.js';
import { roundDate } from './engine/calendar.js';
import { INJURY } from './engine/injury.js';
import { absenceText } from './components/Status.jsx';
import { defaultLogo } from './engine/logo.js';
import ClubLogo from './components/ClubLogo.jsx';
import LeagueTab from './components/LeagueTab.jsx';
import SquadMarketTab from './components/SquadMarketTab.jsx';
import { t, tk, LANGS } from './i18n.js';

const TEAM_SEED = 2026;
const SPEEDS = [1, 2, 4, 8];
const USER_TEAM = 'home'; // tim yang diatur pengguna; tim tamu diatur AI pelatih
const TEAM_VIEW_EVERY_TICKS = 5; // tab Tim diperbarui 2× per detik (cukup untuk bar tenaga)
const SUB_NOTICE_TICKS = 50;
// Tab (14 Nov): pergantian & bursa jadi tab sendiri supaya tidak perlu gulir jauh.
const TABS = ['league', 'match', 'team', 'subs', 'squad', 'market'];
const LEAGUE_ONLY_TABS = new Set(['league', 'squad', 'market']);
const TAB_LABEL = { league: tk('Kompetisi'), match: tk('Pertandingan'), team: tk('Taktik'), subs: tk('Pergantian'), squad: tk('Skuad'), market: tk('Bursa') };

// Gaya lawan (7 Nov): pilihan pengguna disimpan di perangkat; "acak" ditentukan dari seed laga
// (seed sama → gaya sama, jadi ?seed=… tetap memutar ulang laga yang sama).
const STYLE_KEY = 'menejer-bola:gaya-lawan';
function readStyleChoice() {
  try {
    const v = window.localStorage.getItem(STYLE_KEY);
    return v === 'acak' || STYLE_KEYS.includes(v) ? v : 'acak';
  } catch {
    return 'acak';
  }
}
function saveStyleChoice(v) {
  try {
    window.localStorage.setItem(STYLE_KEY, v);
  } catch {
    // penyimpanan tidak tersedia: abaikan
  }
}
// Taktik pengguna tersimpan dipasang lagi; bila merujuk pemain yang sudah tidak ada, pakai pilihan
// tim saja (formasi, garis, pressing, ...) tanpa instruksi per pemain.
function applyUserTactics(sim, saved) {
  if (!saved) return;
  try {
    sim.setTactics('home', saved);
  } catch {
    try {
      const { inPossession, outOfPossession, onLoss, onWin, corner, freeKick, baseFormation } = saved;
      sim.setTactics('home', { baseFormation, inPossession, outOfPossession, onLoss, onWin, corner, freeKick });
    } catch {
      // taktik lama tidak cocok sama sekali: pakai bawaan
    }
  }
}

function seededUnit(seed) {
  const x = Math.imul(seed >>> 0, 2654435761) >>> 0;
  return x / 4294967296;
}

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
  if (state.period === 'halftime') return t('Jeda');
  if (state.period === 'fulltime') return t('Selesai');
  return `${gameClock(state).minute}'`;
}

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

// Baris statistik: label + cara membaca angka satu tim dari state.stats.
const WHISTLE_SHOW_TICKS = 15; // 1,5 detik

const STAT_ROWS = [
  { key: 'shots', label: tk('Tembakan (tepat sasaran)'), read: (s, id) => `${s.shots[id].total} (${s.shots[id].onTarget})` },
  { key: 'passes', label: tk('Operan sukses / dicoba'), read: (s, id) => `${s.passes[id].completed}/${s.passes[id].attempted}` },
  { key: 'tackles', label: tk('Tekel berhasil / dicoba'), read: (s, id) => `${s.tackles[id].won}/${s.tackles[id].attempted}` },
  { key: 'offsides', label: tk('Offside'), read: (s, id) => `${s.offsides[id]}` },
  { key: 'fouls', label: tk('Jumlah pelanggaran'), read: (s, id) => `${s.fouls[id]}` },
  { key: 'yellows', label: tk('Kartu kuning'), read: (s, id) => `${s.yellows[id]}` },
  { key: 'reds', label: tk('Kartu merah'), read: (s, id) => `${s.reds[id]}` },
  { key: 'crosses', label: tk('Umpan silang (sampai)'), read: (s, id) => `${s.crosses[id].attempted} (${s.crosses[id].won})` },
  { key: 'headers', label: tk('Sundulan ke gawang'), read: (s, id) => `${s.headers[id].shots}` },
  { key: 'longShots', label: tk('Tembakan luar kotak'), read: (s, id) => `${s.longShots[id].shots}` },
  { key: 'clearances', label: tk('Sapuan panik'), read: (s, id) => `${s.clearances[id]}` },
  {
    key: 'saves',
    label: tk('Penyelamatan kiper'),
    read: (s, id) => `${s.saves[id].caught + s.saves[id].parried}`,
  },
];

// Layar permainan (14 Nov: dibungkus Root — menu utama & slot simpanan). initialLeague = karier dari
// slot (null = hanya laga persahabatan); onSaveLeague(liga) → true bila tersimpan.
// Liga "diam" (15 Nov): babak tanpa klub pengguna langsung dihitung cepat, jadi babak berjalan selalu
// berisi laga pengguna — atau musim sudah selesai.
const atRest = (l) => (!l || seasonOver(l) || userFixture(l) ? l : simulateToUserMatch(l));

export default function App({ initialLeague, onSaveLeague, onExitToMenu, lang, onChooseLang }) {
  const chooseLang = onChooseLang;
  const [matchSeed, setMatchSeed] = useState(initialSeed);
  const [styleChoice, setStyleChoice] = useState(readStyleChoice);
  const [league, setLeagueState] = useState(() => atRest(initialLeague));
  const [leagueNotice, setLeagueNotice] = useState(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const leagueRef = useRef(league);
  leagueRef.current = league;
  // 'liga' = laga liga pengguna; 'bebas' = laga persahabatan (gaya lawan dipilih, hasil tidak dicatat).
  const [matchKind, setMatchKind] = useState(() => (initialLeague && !seasonOver(initialLeague) ? 'liga' : 'bebas'));
  const [leagueMatchId, setLeagueMatchId] = useState(0); // naik = bangun laga liga baru dari data liga terkini
  const recordedRef = useRef(null);
  const [running, setRunning] = useState(() => !initialLeague);
  const [speed, setSpeed] = useState(1);
  // Snapshot state saat jeda babak / peluit akhir (null = sedang bermain).
  // Hanya berubah dua kali per pertandingan, jadi aman memakai state React.
  const [breakState, setBreakState] = useState(null);
  // Dua tab (29 Okt): keduanya hidup; simulasi tetap berjalan saat tab Tim dibuka.
  const [tab, setTab] = useState(initialLeague ? 'league' : 'match');
  const [teamView, setTeamView] = useState(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const subToastRef = useRef(null);
  const scriptChipRef = useRef(null);

  const clockRef = useRef(null);
  const scoreRef = useRef(null);
  const goalBannerRef = useRef(null);
  const whistleRef = useRef(null);
  const mentalityRefs = { home: useRef(null), away: useRef(null) };
  const formationRefs = { home: useRef(null), away: useRef(null) };
  const possessionRefs = { home: useRef(null), away: useRef(null), bar: useRef(null) };
  const rowRefs = useRef({});

  const { home, away, simulation, namesById, awayStyle, leagueMatch } = useMemo(() => {
    const lg = leagueRef.current;
    if (matchKind === 'liga' && lg && !seasonOver(lg) && userFixture(lg)) {
      const m = buildMatchTeams(lg);
      const names = new Map([...m.home.players, ...m.home.bench, ...m.away.players, ...m.away.bench].map((p) => [p.id, p.shortName]));
      const sim = createSimulation(m.home, m.away, matchSeed, { aiTeams: ['away'] });
      const st = sim.getState();
      sim.setTactics('away', styleTactics(m.opponent.style, st.players.filter((p) => p.teamId === 'away'), st.teams.away.tactics));
      applyUserTactics(sim, lg.userTactics);
      return {
        home: m.home,
        away: m.away,
        namesById: names,
        simulation: sim,
        awayStyle: m.opponent.style,
        leagueMatch: {
          key: `${lg.season}-${lg.week}-${leagueMatchId}`,
          season: lg.season,
          week: lg.week,
          label: `${roundLabel(currentRound(lg), clubById(lg, lg.userClubId).tier)} · ${dateLabel(roundDate(lg.season, lg.week), { year: false })}`,
          knockout: isKnockout(currentRound(lg)),
          userIsHome: m.userIsHome,
          opponentId: m.opponent.id,
          // Absen (14 Nov): pemain inti pengguna yang diganti otomatis, dan pemain lawan yang absen.
          autoSubs: (() => {
            const user = clubById(lg, lg.userClubId);
            const byUid = new Map(user.players.map((p) => [p.uid, p]));
            return effectiveLineup(user, lg.userFormation).changes.map((c) => ({ out: byUid.get(c.outUid), in: byUid.get(c.inUid) }));
          })(),
          oppAbsent: absentPlayers(m.opponent),
        },
      };
    }
    const styleKey = styleChoice === 'acak' ? randomStyle(() => seededUnit(matchSeed)) : styleChoice;
    const style = CLUB_STYLES[styleKey];
    const teams = createDemoTeams(TEAM_SEED, { awayFormation: style.formation, awayPhilosophy: style.philosophy });
    const names = new Map(
      [...teams.home.players, ...teams.home.bench, ...teams.away.players, ...teams.away.bench].map((p) => [p.id, p.shortName]),
    );
    const sim = createSimulation(teams.home, teams.away, matchSeed, { aiTeams: ['away'] });
    const st = sim.getState();
    sim.setTactics('away', styleTactics(styleKey, st.players.filter((p) => p.teamId === 'away'), st.teams.away.tactics));
    return { ...teams, namesById: names, simulation: sim, awayStyle: styleKey, leagueMatch: null };
    // leagueRef dibaca saat laga dibangun; laga liga baru hanya lewat leagueMatchId (bukan tiap perubahan liga)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchSeed, styleChoice, matchKind, leagueMatchId]);

  function setLeague(raw) {
    const next = atRest(raw);
    setLeagueState(next);
    if (!onSaveLeague(next)) setLeagueNotice(tk('Penyimpanan perangkat tidak tersedia — progres liga hilang bila halaman ditutup.'));
  }

  // Laga liga selesai → catat hasil + taktik pengguna, tutup pekan (laga lain dihitung cepat). Sekali per laga.
  useEffect(() => {
    if (!leagueMatch || breakState?.period !== 'fulltime' || recordedRef.current === leagueMatch.key) return;
    const lg = leagueRef.current;
    if (lg.season !== leagueMatch.season || lg.week !== leagueMatch.week) return; // liga berubah di tengah jalan: jangan catat
    recordedRef.current = leagueMatch.key;
    const g = breakState.stats.goals;
    const final = simulation.getState();
    setLeague(completeWeek(lg, g.home, g.away, final.teams.home.tactics, matchReportFromState(final, 'home')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakState, leagueMatch]);

  // Laga liga dianggap berjalan sejak mulai diputar (atau sudah lewat menit 0) sampai peluit akhir.
  const leagueInProgress = Boolean(leagueMatch) && breakState?.period !== 'fulltime' && (running || simulation.getState().tick > 0);

  // Skuad liga berubah sebelum kick-off → bangun ulang laga liga dengan susunan baru.
  function changeLeague(next) {
    setLeague(next);
    if (leagueMatch && simulation.getState().tick === 0) {
      leagueRef.current = next;
      setLeagueMatchId((n) => n + 1);
    }
  }

  function nextLeagueMatch() {
    resetBoard();
    setMatchKind(leagueRef.current && !seasonOver(leagueRef.current) ? 'liga' : 'bebas');
    setLeagueMatchId((n) => n + 1);
    setMatchSeed(randomSeed());
    setRunning(false);
    setTab('league');
  }

  function toFriendly() {
    resetBoard();
    setMatchKind('bebas');
    setMatchSeed(randomSeed());
    setRunning(true);
  }

  function toLeague() {
    resetBoard();
    setMatchKind('liga');
    setLeagueMatchId((n) => n + 1);
    setMatchSeed(randomSeed());
    setRunning(false);
  }

  // Semua angka diperbarui langsung di DOM, tanpa render ulang React setiap tick.
  const handleTick = useCallback(
    (state) => {
      const set = (el, text) => {
        if (el && el.textContent !== text) el.textContent = text;
      };
      const { stats } = state;

      if ((tabRef.current === 'team' || tabRef.current === 'subs') && state.tick % TEAM_VIEW_EVERY_TICKS === 0) setTeamView(state);

      // Pemberitahuan pergantian pemain (kedua tim), tampil beberapa detik.
      const toast = subToastRef.current;
      if (toast) {
        const recent = (state.subNotices ?? []).filter((n) => state.tick - n.tick <= SUB_NOTICE_TICKS);
        // Cedera (14 Nov): pemberitahuan sampai pemain diganti; untuk tim pengguna ada petunjuknya.
        const hurt = state.players.filter((p) => p.injury);
        const limpedOff = (state.sentOff ?? []).filter((p) => p.card === 'injury' && state.tick - p.tick <= SUB_NOTICE_TICKS);
        const teamName = (id) => (id === home.id ? home.name : away.name);
        const lines = [
          ...hurt.map((p) => {
            const left = Math.max(0, Math.ceil((INJURY.userGraceTicks - (state.tick - p.injury.tick)) / 10));
            return p.teamId === USER_TEAM
              ? `🩹 ${t('{p} cedera — pilih pengganti di tab Pergantian (otomatis dalam {s} dtk)', { p: p.shortName, s: left })}`
              : `🩹 ${teamName(p.teamId)}: ${t('{p} cedera', { p: p.shortName })}`;
          }),
          ...limpedOff.map((p) => `🩹 ${teamName(p.teamId)}: ${t('{p} keluar cedera tanpa pengganti', { p: p.shortName })}`),
          ...recent.map((n) => {
            const team = teamName(n.teamId);
            return n.status === 'masuk'
              ? `🔁 ${team}: ${namesById.get(n.outId) ?? n.outId} ➜ ${namesById.get(n.inId) ?? n.inId}`
              : `⚠️ ${team}: ${t('pergantian {p} dibatalkan', { p: namesById.get(n.outId) ?? n.outId })}`;
          }),
        ];
        toast.hidden = lines.length === 0;
        set(toast, lines.join('   '));
      }

      // Strategi detil: skema tim pengguna yang sedang berjalan.
      const chip = scriptChipRef.current;
      if (chip) {
        const run = state.teams[USER_TEAM]?.script;
        const sc = run ? (state.teams[USER_TEAM].activeTactics?.scripts ?? []).find((x) => x.id === run.id) : null;
        chip.hidden = !sc;
        set(chip, sc ? `🧩 ${t('Skema "{n}" · langkah {a}/{b}', { n: sc.name, a: Math.min(run.step, sc.steps.length), b: sc.steps.length })}` : '');
      }

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

      // Mentalitas tim (AI pelatih): tampil hanya saat berubah dari "Seimbang".
      for (const [key, team] of [
        ['home', home],
        ['away', away],
      ]) {
        const tac = state.teams[team.id]?.activeTactics;
        const fOut = tac?.outOfPossession.formation ?? team.formation;
        const fIn = tac?.inPossession.formation ?? team.formation;
        set(formationRefs[key].current, fOut === fIn ? fOut : `${fOut} / ${fIn}`);
        const el = mentalityRefs[key].current;
        if (!el) continue;
        // Chip: kalah jumlah pemain (dan garis rendah AI pelatih bila ada).
        const players = state.players.filter((p) => p.teamId === team.id).length;
        const low = tac?.outOfPossession.line === 'rendah';
        el.hidden = players >= 11 && !low;
        set(el, `${low ? t('Garis rendah') : ''}${low && players < 11 ? ' · ' : ''}${players < 11 ? t('{n} pemain', { n: players }) : ''}`);
      }

      // Peluit (tahap 7a) & insiden di jeda setelah pelanggaran (tahap 7b-2).
      const whistleEl = whistleRef.current;
      if (whistleEl) {
        const w = state.whistle;
        const incident = state.incident;
        const showingIncident = incident !== null && (state.pauseReason === 'foul' || state.pauseReason === 'penalty');
        // (insiden 'restart' — lemparan/pojok/tendangan gawang — tidak menampilkan tulisan)
        const showing = showingIncident || (w !== null && state.tick - w.tick < WHISTLE_SHOW_TICKS);
        whistleEl.hidden = !showing;
        if (showing) {
          const name = (id) => (id ? (namesById.get(id) ?? '') : '');
          const cardIcon = (c) =>
            c === 'yellow' ? ' 🟨' : c === 'secondYellow' ? ` 🟨🟨→🟥 ${t('KARTU MERAH')}` : c === 'red' ? ` 🟥 ${t('KARTU MERAH')}` : '';
          let text;
          if (showingIncident) {
            // Hanya satu baris singkat di LUAR lapangan (masukan 29 Okt: tulisan besar menutupi drama).
            const cardIcon2 = cardIcon(incident.card);
            // Kartu merah karena protes/pertikaian (bukan karena pelanggarannya) diutamakan.
            const otherRed = (incident.cards ?? []).find((c) => c.card === 'red' || c.card === 'secondYellow');
            text =
              incident.kind === 'restart'
                ? ''
                : otherRed
                  ? `${otherRed.card === 'red' ? '🟥' : '🟨🟨→🟥'} ${t('KARTU MERAH')} — ${name(otherRed.id)} (${otherRed.reason === 'protest' ? t('protes') : t('pertikaian')})`
                  : incident.kind === 'offside'
                    ? `🚩 ${t('Offside')} — ${name(incident.offenderId)}`
                    : `${t('PRIIIT!')} ${incident.penalty ? t('PENALTI') : t('Pelanggaran')} — ${name(incident.offenderId)}${cardIcon2}`;
          } else {
            const offender = name(w.playerId);
            const card = cardIcon(w.card);
            text =
              w.kind === 'offside'
                ? `🚩 ${t('PRIIIT!')} ${t('Offside')}${offender ? ` — ${offender}` : ''}`
                : w.kind === 'foul'
                  ? `${t('PRIIIT!')} ${w.penalty ? t('PENALTI') : t('Pelanggaran')} — ${offender}${card}`
                  : w.kind === 'penalty'
                    ? `${t('PRIIIT!')} ${t('Tendangan penalti')}`
                    : w.kind === 'freeKick'
                      ? `${t('PRIIIT!')} ${t('Tendangan bebas')}`
                      : w.kind === 'advantage'
                        ? `${t('Keuntungan! Pelanggaran')} ${offender}${card}`
                        : `${t('PRIIIT!')} ${t('Kick-off')}`;
          }
          whistleEl.hidden = !text;
          set(whistleEl, text || '');
        }
      }

      // Tulisan GOL! selama jeda setelah gol.
      const banner = goalBannerRef.current;
      if (banner) {
        const showing = state.pauseReason === 'goal' && state.lastGoal !== null;
        banner.hidden = !showing;
        if (showing) {
          const goal = state.lastGoal;
          const team = goal.teamId === home.id ? home : away;
          const scorer = goal.scorerId ? namesById.get(goal.scorerId) : null;
          const who = goal.ownGoal
            ? t('gol bunuh diri')
            : `${scorer ?? team.name}${goal.header ? ` (${t('sundulan')})` : goal.penalty ? ` (${t('penalti')})` : goal.freeKick ? ` (${t('tendangan bebas')})` : goal.longShot ? ` (${t('dari luar kotak')})` : ''}`;
          set(banner.querySelector('.goal-banner__detail'), `${who} · ${team.name}`);
          banner.style.setProperty('--goal-color', team.colors.shirt);
        }
      }
    },
    // Ref di atas stabil; home/away/namesById berubah hanya saat simulasi baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [home, away, namesById],
  );

  function resetBoard() {
    if (clockRef.current) clockRef.current.textContent = "0'";
    if (scoreRef.current) scoreRef.current.textContent = '0 – 0';
    if (goalBannerRef.current) goalBannerRef.current.hidden = true;
    if (whistleRef.current) whistleRef.current.hidden = true;
    setBreakState(null);
    setTeamView(null);
  }

  function restart() {
    if (leagueMatch) return nextLeagueMatch(); // laga liga tidak bisa diulang (hasil sudah / akan dicatat)
    if (clockRef.current) clockRef.current.textContent = "0'";
    if (scoreRef.current) scoreRef.current.textContent = '0 – 0';
    if (goalBannerRef.current) goalBannerRef.current.hidden = true;
    if (whistleRef.current) whistleRef.current.hidden = true;
    setBreakState(null);
    setTeamView(null);
    setMatchSeed(randomSeed());
    setRunning(true);
  }

  function chooseStyle(v) {
    if (v !== 'acak' && !STYLE_KEYS.includes(v)) return;
    saveStyleChoice(v);
    setStyleChoice(v);
    restart();
  }

  function openTab(k) {
    if (!TABS.includes(k)) throw new RangeError(`openTab: tab tidak dikenal ${k}`);
    if (LEAGUE_ONLY_TABS.has(k) && !league) return;
    if (k === 'team' || k === 'subs') setTeamView(simulation.getState());
    setTab(k);
  }

  function startSecondHalf() {
    if (simulation.getState().period !== 'halftime') return;
    const next = simulation.startSecondHalf();
    setTeamView(next);
    setBreakState(null);
    setRunning(true);
  }

  return (
    <main className="app">
      <header className="scoreboard">
        <TeamLabel team={home} align="right" mentalityRef={mentalityRefs.home} formationRef={formationRefs.home} logo={leagueMatch && league ? league.profile.logo : defaultLogo(home)} />
        <div className="score">
          <span ref={scoreRef}>0 – 0</span>
          <span ref={clockRef} className="clock">
            0'
          </span>
        </div>
        <TeamLabel team={away} align="left" mentalityRef={mentalityRefs.away} formationRef={formationRefs.away} logo={leagueMatch && league ? clubLogo(league, leagueMatch.opponentId) : defaultLogo(away)} />
      </header>

      {leagueNotice && (
        <p className="zone-notice" role="status">
          {t(leagueNotice)}{' '}
          <button type="button" className="link-btn" onClick={() => setLeagueNotice(null)}>
            {t('tutup')}
          </button>
        </p>
      )}
      {leagueMatch ? (
        <div className="scout-bar">
          <span>
            🏆 {leagueMatch.label} · {t('musim {s}', { s: leagueMatch.season })}
            {leagueMatch.knockout ? ` · ${t('gugur: seri → adu penalti')}` : ''} · {leagueMatch.userIsHome ? t('kandang') : t('tandang')} · {t('lawan:')}{' '}
            <b>{t(CLUB_STYLES[awayStyle].label)}</b> · {CLUB_STYLES[awayStyle].formation}
          </span>
          <button type="button" className="link-btn" disabled={leagueInProgress} onClick={toFriendly} title={leagueInProgress ? t('Selesaikan laga liga dulu') : undefined}>
            {t('Laga persahabatan')}
          </button>
          {(leagueMatch.autoSubs.length > 0 || leagueMatch.oppAbsent.length > 0) && (
            <span className="absence-line">
              {leagueMatch.autoSubs.map((c) => (
                <span key={c.out.uid}>
                  {t('{a} absen ({r}) → diganti {b}', { a: c.out.shortName, r: absenceText(c.out.absence), b: c.in.shortName })}
                </span>
              ))}
              {leagueMatch.oppAbsent.length > 0 && (
                <span>
                  {t('Lawan tanpa')}: {leagueMatch.oppAbsent.map((p) => `${p.shortName} (${absenceText(p.absence)})`).join(', ')}
                </span>
              )}
            </span>
          )}
        </div>
      ) : (
      <div className="scout-bar">
        <span>
          {t('Persahabatan')} · {t('lawan:')} <b>{t(CLUB_STYLES[awayStyle].label)}</b> · {CLUB_STYLES[awayStyle].formation} · {t('filosofi')}{' '}
          {t(getPhilosophy(CLUB_STYLES[awayStyle].philosophy).label).toLowerCase()}
        </span>
        {league && !seasonOver(league) && (
          <button type="button" className="link-btn" onClick={toLeague}>
            {t('Kembali ke liga')}
          </button>
        )}
        <label>
          {t('Gaya lawan')}{' '}
          <select value={styleChoice} onChange={(e) => chooseStyle(e.target.value)}>
            <option value="acak">{t('Acak')}</option>
            {STYLE_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(CLUB_STYLES[k].label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      )}

      {/* Satu baris (14 Nov): tab di kiri, menu/manajer/bahasa di kanan — hemat satu baris layar. */}
      <div className="tabs-bar">
        <nav className="tabs" role="tablist" aria-label={t('Tampilan')}>
          {TABS.filter((k) => league || !LEAGUE_ONLY_TABS.has(k)).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={tab === k ? 'is-active' : undefined}
              onClick={() => openTab(k)}
            >
              {t(TAB_LABEL[k])}
            </button>
          ))}
        </nav>
        <div className="lang-switch" role="group" aria-label="Bahasa / Language">
          {confirmExit ? (
            <span className="exit-confirm">
              {t('Laga liga belum selesai — keluar akan mengulang laga pekan ini.')}{' '}
              <button type="button" onClick={onExitToMenu}>
                {t('Keluar ke menu')}
              </button>
              <button type="button" onClick={() => setConfirmExit(false)}>
                {t('Batal')}
              </button>
            </span>
          ) : (
            <button type="button" className="menu-link" onClick={() => (leagueInProgress ? setConfirmExit(true) : onExitToMenu())}>
              ☰ {t('Menu utama')}
            </button>
          )}
          {league && (
            <span className="manager-chip">
              {t('Manajer')}: {league.profile.managerName}
            </span>
          )}
          {LANGS.map((l) => (
            <button key={l} type="button" className={l === lang ? 'is-active' : undefined} onClick={() => chooseLang(l)} aria-pressed={l === lang}>
              {l === 'id' ? 'ID' : 'EN'}
            </button>
          ))}
        </div>
      </div>

      <div ref={whistleRef} className="whistle-banner" hidden aria-live="polite" />
      <div ref={subToastRef} className="sub-toast" hidden aria-live="polite" />
      <div ref={scriptChipRef} className="script-chip" hidden aria-live="polite" />

      {league && (
        <div hidden={tab !== 'league'}>
          <LeagueTab
            league={league}
            onChange={changeLeague}
            locked={leagueInProgress}
            onGoMatch={() => {
              if (!leagueMatch) toLeague();
              setTab('match');
            }}
          />
        </div>
      )}

      {league && (
        <div hidden={tab !== 'squad'}>
          <SquadMarketTab league={league} onChange={changeLeague} locked={leagueInProgress} part="squad" />
        </div>
      )}
      {league && (
        <div hidden={tab !== 'market'}>
          <SquadMarketTab league={league} onChange={changeLeague} locked={leagueInProgress} part="market" />
        </div>
      )}

      {/* Tab Taktik & Pergantian: simulasi tetap berjalan di belakang. */}
      <div hidden={tab !== 'team' && tab !== 'subs'}>
        <TeamTab state={teamView} teamId={USER_TEAM} simulation={simulation} onChange={setTeamView} namesById={namesById} view={tab === 'subs' ? 'subs' : 'tactics'} />
        {breakState?.period === 'halftime' && (
          <div className="team-break">
            <span>{t('Turun minum. Antrian pergantian dijalankan saat babak 2 dimulai.')}</span>
            <button type="button" className="break-button" onClick={startSecondHalf}>
              {t('Lanjut babak 2')}
            </button>
          </div>
        )}
      </div>

      {/* Tab Pertandingan. Disembunyikan (bukan dilepas) supaya loop & canvas tetap hidup. */}
      <div hidden={tab !== 'match'} className="match-layout">
        <div className="pitch-wrap">
          <MatchView simulation={simulation} running={running} speed={speed} onTick={handleTick} />
          <div ref={goalBannerRef} className="goal-banner" hidden aria-live="polite">
            <span className="goal-banner__title">{t('GOL!')}</span>
            <span className="goal-banner__detail" />
          </div>
          {breakState && (
            <BreakScreen
              state={breakState}
              home={home}
              away={away}
              onContinue={breakState.period === 'halftime' ? startSecondHalf : restart}
              continueLabel={breakState.period === 'fulltime' && leagueMatch ? t('Hasil tersimpan · ke tab Liga') : null}
            />
          )}
        </div>

        <section className="match-stats" aria-label={t('Statistik pertandingan')}>
          <div className="stat-row">
            <span ref={possessionRefs.home} className="stat-value">
              0%
            </span>
            <span className="stat-label">{t('Penguasaan bola')}</span>
            <span ref={possessionRefs.away} className="stat-value stat-value--away">
              0%
            </span>
          </div>
          <div className="possession-track" style={{ background: away.colors.shirt }}>
            <div ref={possessionRefs.bar} className="possession-fill" style={{ background: home.colors.shirt }} />
          </div>
          {STAT_ROWS.map((row) => (
            <div key={row.key} className="stat-row">
              <span ref={(el) => (rowRefs.current[`${row.key}-home`] = el)} className="stat-value">
                –
              </span>
              <span className="stat-label">{t(row.label)}</span>
              <span ref={(el) => (rowRefs.current[`${row.key}-away`] = el)} className="stat-value stat-value--away">
                –
              </span>
            </div>
          ))}
          <p className="stage-note">{t('Bayangan = bola melambung · bar = tenaga menipis · titik merah = kurang percaya diri · titik oranye = on fire.')}</p>
        </section>
      </div>

      <div className="controls">
        <button type="button" onClick={() => setRunning((r) => !r)}>
          {running ? t('Jeda') : t('Lanjut')}
        </button>
        <div className="speed-group" role="group" aria-label={t('Kecepatan')}>
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={s === speed ? 'is-active' : undefined} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {!leagueMatch && (
          <button type="button" onClick={restart}>
            {t('Ulang (seed baru)')}
          </button>
        )}
        <span className="stage-note">Seed: {matchSeed}</span>
      </div>
    </main>
  );
}

// Layar jeda babak dan layar akhir pertandingan. Di tahap layer manager,
// layar jeda ini menjadi tempat mengubah taktik dan formasi.
function BreakScreen({ state, home, away, onContinue, continueLabel }) {
  const isHalftime = state.period === 'halftime';
  const { stats } = state;
  const total = stats.possessionTicks[home.id] + stats.possessionTicks[away.id];
  const homeShare = percent(stats.possessionTicks[home.id], total);
  const rows = [
    { label: t('Penguasaan bola'), home: `${homeShare}%`, away: `${100 - homeShare}%` },
    ...STAT_ROWS.map((row) => ({ label: t(row.label), home: row.read(stats, home.id), away: row.read(stats, away.id) })),
  ];

  return (
    <div className="break-screen" role="dialog" aria-label={isHalftime ? t('Jeda babak') : t('Pertandingan selesai')}>
      <div className="break-card">
        <p className="break-title">{isHalftime ? t('Turun minum') : t('Pertandingan selesai')}</p>
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
        {isHalftime && <p className="break-note">{t('Atur taktik dan pergantian di tab Taktik & Pergantian sebelum babak 2.')}</p>}
        <button type="button" className="break-button" onClick={onContinue} autoFocus>
          {isHalftime ? t('Lanjut babak 2') : (continueLabel ?? t('Main lagi (seed baru)'))}
        </button>
      </div>
    </div>
  );
}

function TeamLabel({ team, align, mentalityRef, formationRef, logo }) {
  return (
    <div className={`team-label team-label--${align}`}>
      {logo ? <ClubLogo logo={logo} size={22} title={team.name} /> : <span className="team-swatch" style={{ background: team.colors.shirt }} />}
      <span className="team-name">{team.name}</span>
      <span ref={formationRef} className="team-formation">
        {team.formation}
      </span>
      <span className="team-philosophy" title={t('Filosofi pelatih')}>
        {t(getPhilosophy(team.philosophy ?? 'seimbang').label)}
      </span>
      {/* Mentalitas dari AI pelatih: hanya tampil bila bukan "Seimbang" (mis. bertahan saat 10 orang). */}
      <span ref={mentalityRef} className="team-mentality" title={t('Keadaan tim')} hidden />
    </div>
  );
}
