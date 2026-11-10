// Liga (10 Nov, keputusan pengguna): 10 klub, kandang-tandang (18 pekan), laga klub lain dihitung
// CEPAT dari kekuatan tim (tanpa gerak pemain), cukup klasemen, disimpan di perangkat. Pemain & pasar
// "seadanya dulu".
//
//   LIGA = { version, seed, season, week, userClubId, clubs, fixtures, budget, market, userTactics }
//   klub  = { id, name, colors, style, quality, players: [{ uid, fullName, shortName, role, stats }],
//             lineup: { nomor 1–11 → uid } }
//   jadwal = 18 pekan × 5 laga { home, away, result: { home, away } | null }
//
// Modul murni: setiap fungsi mengembalikan liga baru; tidak menyentuh penyimpanan atau UI.

import { createRng } from './rng.js';
import { createTeam, addBench } from './teams.js';
import { getFormation } from './formations.js';
import { CLUB_STYLES, getStyle } from './clubStyles.js';
import { TECHNICAL_STATS, GOALKEEPER_STATS, STAT_MIN, STAT_MAX } from './stats.js';

export const LEAGUE_VERSION = 1;
export const USER_CLUB = 'persada';

export const LEAGUE = Object.freeze({
  clubs: 10,
  startBudget: 40, // juta (mata uang karangan)
  squadMax: 25,
  squadMin: 18, // 11 starter + 7 cadangan
  benchInMatch: 7,
  marketSize: 12,
  marketRefresh: 3, // pemain bursa yang diganti tiap pekan
  sellRate: 0.7, // dijual = 70% nilai
  weeklyIncome: 2,
  // Hasil cepat (Poisson): λ = base · e^(k·selisih kekuatan) · (kandang ? homeEdge : 1).
  // k dari kalibrasi engine: 13 vs 11 → gol 1,92 vs 0,84 (rasio ±2,3 untuk selisih 2 → k ≈ 0,21).
  // base disetel agar rata-rata gol ≈ engine (10 Nov setelah lemparan tangan: 2,40/laga).
  quick: Object.freeze({ base: 1.05, k: 0.21, homeEdge: 1.1, maxGoals: 9 }),
});

// Klub karangan. Kualitas = rata-rata stat dasar (1–20); gaya dari clubStyles.js.
const CLUB_DEFS = Object.freeze([
  { id: USER_CLUB, name: 'Persada Bandung', colors: { shirt: '#1f4fbf', number: '#ffffff', goalkeeper: '#2f9e44' }, style: 'seimbang', quality: 12 },
  { id: 'garuda', name: 'Garuda Merah', colors: { shirt: '#c92a2a', number: '#ffffff', goalkeeper: '#f08c00' }, style: 'penguasaan', quality: 13 },
  { id: 'bintang', name: 'Bintang Samudra', colors: { shirt: '#0b7285', number: '#ffffff', goalkeeper: '#e67700' }, style: 'pressing', quality: 14 },
  { id: 'rajawali', name: 'Rajawali Timur', colors: { shirt: '#5f3dc4', number: '#ffffff', goalkeeper: '#2b8a3e' }, style: 'seranganBalik', quality: 12 },
  { id: 'benteng', name: 'Benteng Kota', colors: { shirt: '#495057', number: '#ffd43b', goalkeeper: '#e8590c' }, style: 'bertahan', quality: 11 },
  { id: 'angin', name: 'Angin Selatan', colors: { shirt: '#f59f00', number: '#212529', goalkeeper: '#1c7ed6' }, style: 'sayap', quality: 12 },
  { id: 'elang', name: 'Elang Utara', colors: { shirt: '#2b8a3e', number: '#ffffff', goalkeeper: '#c2255c' }, style: 'seimbang', quality: 13 },
  { id: 'ombak', name: 'Ombak Biru', colors: { shirt: '#74c0fc', number: '#1b1b1b', goalkeeper: '#e03131' }, style: 'sayap', quality: 10 },
  { id: 'batu', name: 'Batu Hitam', colors: { shirt: '#212529', number: '#ffffff', goalkeeper: '#fab005' }, style: 'bertahan', quality: 10 },
  { id: 'api', name: 'Api Nusantara', colors: { shirt: '#e8590c', number: '#ffffff', goalkeeper: '#1971c2' }, style: 'pressing', quality: 11 },
]);

const ROLE_GROUP = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' };
export const roleGroup = (role) => ROLE_GROUP[role] ?? 'MF';

// Nilai keseluruhan pemain: kiper dari stat kiper + posisi, lainnya dari stat teknik (tanpa kecerobohan).
export function overall(player) {
  const s = player.stats;
  const keys = player.role === 'GK' ? [...GOALKEEPER_STATS, 'posisi', 'antisipasi'] : TECHNICAL_STATS.filter((k) => k !== 'kecerobohan');
  const vals = keys.map((k) => s[k]).filter(Number.isFinite);
  if (vals.length === 0) throw new Error(`overall: stat kosong untuk ${player.uid ?? player.id}`);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Harga (juta): naik ±35% per poin nilai, nilai 10 ≈ 5 juta.
export function playerValue(player) {
  return Math.max(1, Math.round(5 * 1.35 ** (overall(player) - 10)));
}

function makeClub(def, seed, usedNames) {
  const style = getStyle(def.style);
  // Tim dibuat dengan id sementara; uid pemain = id klub + nomor awal (stabil sepanjang musim).
  const team = addBench(createTeam({ usedShortNames: usedNames, id: def.id, name: def.name, colors: def.colors, formation: style.formation, quality: def.quality, philosophy: style.philosophy, seed }), {
    seed: seed + 50,
    usedShortNames: usedNames,
    quality: def.quality,
  });
  const players = [...team.players, ...team.bench].map((p) => ({ uid: p.id, fullName: p.fullName, shortName: p.shortName, role: p.role, stats: { ...p.stats } }));
  const lineup = Object.fromEntries(team.players.map((p) => [p.number, p.id]));
  return { id: def.id, name: def.name, colors: def.colors, style: def.style, quality: def.quality, players, lineup };
}

// Jadwal kandang-tandang dengan metode lingkaran: putaran 1 = n−1 pekan, putaran 2 = kebalikannya.
export function roundRobin(ids, rng) {
  if (ids.length % 2 !== 0 || ids.length < 2) throw new RangeError('roundRobin: jumlah klub harus genap ≥ 2');
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const n = order.length;
  const first = [];
  let rot = order.slice(1);
  for (let w = 0; w < n - 1; w += 1) {
    const all = [order[0], ...rot];
    const week = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = all[i];
      const b = all[n - 1 - i];
      // Bergantian kandang supaya tidak ada klub tandang terus.
      week.push((w + i) % 2 === 0 ? { home: a, away: b, result: null } : { home: b, away: a, result: null });
    }
    first.push(week);
    rot = [rot[rot.length - 1], ...rot.slice(0, -1)];
  }
  const second = first.map((week) => week.map((f) => ({ home: f.away, away: f.home, result: null })));
  return [...first, ...second];
}

function makeFreeAgent(rng, n, usedNames) {
  const roles = ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST'];
  const role = rng.pick(roles);
  const quality = rng.int(8, 15);
  const t = createTeam({ usedShortNames: new Set(), id: `fa${n}`, name: 'Bursa', colors: { shirt: '#000', number: '#fff' }, formation: '4-4-2', quality, philosophy: 'seimbang', seed: rng.int(1, 1e9) });
  const src = t.players.find((p) => p.role === role) ?? t.players[1];
  return { uid: `fa${n}`, fullName: src.fullName, shortName: src.shortName, role: src.role, stats: { ...src.stats } };
}

export function createLeague(seed = 2026) {
  if (!Number.isInteger(seed)) throw new TypeError('createLeague: seed harus bilangan bulat');
  const rng = createRng(seed);
  const used = new Set();
  // Nama punggung boleh sama antar-klub (hanya 40 nama belakang); keunikan dijaga per laga (buildMatchTeams).
  const clubs = CLUB_DEFS.map((def, i) => {
    if (used.size > 20) used.clear();
    return makeClub(def, seed + i * 7, used);
  });
  const fixtures = roundRobin(clubs.map((c) => c.id), rng);
  const market = { nextId: LEAGUE.marketSize, players: Array.from({ length: LEAGUE.marketSize }, (_, i) => makeFreeAgent(rng, i, used)) };
  const league = { version: LEAGUE_VERSION, seed, season: 1, week: 0, userClubId: USER_CLUB, clubs, fixtures, budget: LEAGUE.startBudget, market, userTactics: null, rngState: rng.int(1, 1e9) };
  assertLeague(league);
  return league;
}

// ---------------------------------------------------------------- validasi

export function leagueErrors(league) {
  const e = [];
  if (!league || typeof league !== 'object') return ['liga bukan objek'];
  if (league.version !== LEAGUE_VERSION) e.push(`versi liga ${league.version} ≠ ${LEAGUE_VERSION}`);
  if (!Array.isArray(league.clubs) || league.clubs.length !== LEAGUE.clubs) return [...e, 'jumlah klub salah'];
  const ids = new Set(league.clubs.map((c) => c.id));
  if (ids.size !== LEAGUE.clubs) e.push('id klub ganda');
  if (!ids.has(league.userClubId)) e.push('klub pengguna tidak ada');
  for (const c of league.clubs) {
    if (!CLUB_STYLES[c.style]) e.push(`${c.id}: gaya tidak dikenal`);
    const uids = new Set(c.players.map((p) => p.uid));
    if (uids.size !== c.players.length) e.push(`${c.id}: uid pemain ganda`);
    const lineupUids = Object.values(c.lineup ?? {});
    if (lineupUids.length !== 11 || new Set(lineupUids).size !== 11 || lineupUids.some((u) => !uids.has(u))) e.push(`${c.id}: susunan 11 pemain tidak valid`);
    const numbers = Object.keys(c.lineup ?? {}).map(Number).sort((a, b) => a - b);
    const formNums = getFormation(getStyle(c.style).formation).map((s) => s.number).sort((a, b) => a - b);
    if (c.id !== league.userClubId && numbers.join() !== formNums.join()) e.push(`${c.id}: nomor susunan tidak cocok formasi`);
    if (c.players.length < LEAGUE.squadMin || c.players.length > LEAGUE.squadMax) e.push(`${c.id}: ukuran skuad ${c.players.length}`);
    for (const p of c.players) for (const v of Object.values(p.stats)) if (!(v >= STAT_MIN && v <= STAT_MAX)) e.push(`${c.id}/${p.uid}: stat di luar 1–20`);
  }
  if (!Array.isArray(league.fixtures) || league.fixtures.length !== 2 * (LEAGUE.clubs - 1)) e.push('jumlah pekan salah');
  else
    league.fixtures.forEach((week, w) => {
      const seen = new Set();
      for (const f of week) {
        if (!ids.has(f.home) || !ids.has(f.away) || f.home === f.away) e.push(`pekan ${w + 1}: laga tidak valid`);
        if (seen.has(f.home) || seen.has(f.away)) e.push(`pekan ${w + 1}: klub main dua kali`);
        seen.add(f.home);
        seen.add(f.away);
        if (f.result !== null && !(Number.isInteger(f.result.home) && Number.isInteger(f.result.away) && f.result.home >= 0 && f.result.away >= 0)) e.push(`pekan ${w + 1}: skor tidak valid`);
        if (w < league.week && f.result === null) e.push(`pekan ${w + 1} sudah lewat tapi ada laga tanpa hasil`);
        if (w > league.week && f.result !== null) e.push(`pekan ${w + 1} belum dimainkan tapi ada hasil`);
      }
    });
  if (!(league.week >= 0 && league.week <= 2 * (LEAGUE.clubs - 1))) e.push('pekan di luar jadwal');
  if (!(league.budget >= 0)) e.push('anggaran negatif');
  return e;
}

function assertLeague(league) {
  const e = leagueErrors(league);
  if (e.length > 0) throw new Error(`liga tidak valid: ${e.slice(0, 3).join('; ')}`);
}

// Muat dari teks tersimpan: null bila rusak / versi lama (pemanggil membuat liga baru).
export function parseLeague(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    const l = JSON.parse(text);
    return leagueErrors(l).length === 0 ? l : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- hasil & klasemen

export const clubById = (league, id) => {
  const c = league.clubs.find((x) => x.id === id);
  if (!c) throw new RangeError(`klub tidak dikenal: ${id}`);
  return c;
};

export function clubStrength(club) {
  const starters = Object.values(club.lineup).map((uid) => club.players.find((p) => p.uid === uid));
  return starters.reduce((s, p) => s + overall(p), 0) / starters.length;
}

function poisson(rng, lambda, max) {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rng.next();
  } while (p > l && k <= max);
  return Math.min(max, k - 1);
}

export function quickResult(home, away, rng) {
  const q = LEAGUE.quick;
  const diff = clubStrength(home) - clubStrength(away);
  const lh = q.base * Math.exp(q.k * diff) * q.homeEdge;
  const la = q.base * Math.exp(-q.k * diff);
  return { home: poisson(rng, lh, q.maxGoals), away: poisson(rng, la, q.maxGoals) };
}

export function userFixture(league) {
  if (league.week >= league.fixtures.length) return null;
  return league.fixtures[league.week].find((f) => f.home === league.userClubId || f.away === league.userClubId) ?? null;
}

// Rekam hasil laga pengguna (skor dari sudut klub pengguna), hitung cepat laga lain, maju satu pekan.
export function completeWeek(league, userGoals, oppGoals, userTactics = null) {
  if (league.week >= league.fixtures.length) throw new Error('completeWeek: musim sudah selesai');
  if (!(Number.isInteger(userGoals) && Number.isInteger(oppGoals) && userGoals >= 0 && oppGoals >= 0)) throw new RangeError('completeWeek: skor tidak valid');
  const rng = createRng(league.rngState);
  const week = league.fixtures[league.week].map((f) => {
    if (f.home === league.userClubId) return { ...f, result: { home: userGoals, away: oppGoals } };
    if (f.away === league.userClubId) return { ...f, result: { home: oppGoals, away: userGoals } };
    return { ...f, result: quickResult(clubById(league, f.home), clubById(league, f.away), rng) };
  });
  const fixtures = league.fixtures.map((w, i) => (i === league.week ? week : w));
  const next = { ...league, fixtures, week: league.week + 1, budget: league.budget + LEAGUE.weeklyIncome, userTactics: userTactics ?? league.userTactics, market: refreshMarket(league.market, rng), rngState: rng.int(1, 1e9) };
  assertLeague(next);
  return next;
}

export function standings(league) {
  const rows = new Map(league.clubs.map((c) => [c.id, { id: c.id, name: c.name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]));
  for (const week of league.fixtures)
    for (const f of week) {
      if (!f.result) continue;
      const h = rows.get(f.home);
      const a = rows.get(f.away);
      const { home: gh, away: ga } = f.result;
      h.p += 1;
      a.p += 1;
      h.gf += gh;
      h.ga += ga;
      a.gf += ga;
      a.ga += gh;
      const [rh, ra] = gh > ga ? ['M', 'K'] : gh < ga ? ['K', 'M'] : ['S', 'S'];
      for (const [row, r] of [[h, rh], [a, ra]]) {
        row[r === 'M' ? 'w' : r === 'S' ? 'd' : 'l'] += 1;
        row.pts += r === 'M' ? 3 : r === 'S' ? 1 : 0;
        row.form.push(r);
      }
    }
  return [...rows.values()]
    .map((r) => ({ ...r, gd: r.gf - r.ga, form: r.form.slice(-5) }))
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name));
}

export const seasonOver = (league) => league.week >= league.fixtures.length;

// Musim baru: jadwal baru, skuad & anggaran dipertahankan, hadiah posisi.
export function newSeason(league) {
  if (!seasonOver(league)) throw new Error('newSeason: musim belum selesai');
  const table = standings(league);
  const pos = table.findIndex((r) => r.id === league.userClubId);
  const prize = Math.max(0, 20 - pos * 2);
  const rng = createRng(league.rngState);
  const next = { ...league, season: league.season + 1, week: 0, fixtures: roundRobin(league.clubs.map((c) => c.id), rng), budget: league.budget + prize, rngState: rng.int(1, 1e9) };
  assertLeague(next);
  return next;
}

// ---------------------------------------------------------------- pasar & skuad (pengguna saja)

function refreshMarket(market, rng) {
  const players = [...market.players];
  let nextId = market.nextId;
  for (let i = 0; i < LEAGUE.marketRefresh && players.length > 0; i += 1) players.splice(rng.int(0, players.length - 1), 1);
  while (players.length < LEAGUE.marketSize) {
    players.push(makeFreeAgent(rng, nextId, new Set()));
    nextId += 1;
  }
  return { nextId, players };
}

const userClub = (league) => clubById(league, league.userClubId);
const withUserClub = (league, club) => ({ ...league, clubs: league.clubs.map((c) => (c.id === club.id ? club : c)) });

export function buyPlayer(league, uid) {
  const p = league.market.players.find((x) => x.uid === uid);
  if (!p) throw new RangeError(`buyPlayer: pemain bursa ${uid} tidak ada`);
  const price = playerValue(p);
  const club = userClub(league);
  if (price > league.budget) return { league, error: `Anggaran kurang (butuh ${price} jt, ada ${league.budget} jt)` };
  if (club.players.length >= LEAGUE.squadMax) return { league, error: `Skuad penuh (maks ${LEAGUE.squadMax})` };
  const newUid = `${club.id}-b${league.market.nextId}-${uid}`;
  const next = withUserClub({ ...league, budget: league.budget - price, market: { ...league.market, players: league.market.players.filter((x) => x.uid !== uid) } }, { ...club, players: [...club.players, { ...p, uid: newUid }] });
  assertLeague(next);
  return { league: next, error: null };
}

export function sellPlayer(league, uid) {
  const club = userClub(league);
  const p = club.players.find((x) => x.uid === uid);
  if (!p) throw new RangeError(`sellPlayer: pemain ${uid} tidak ada`);
  if (Object.values(club.lineup).includes(uid)) return { league, error: 'Pemain inti tidak bisa dijual — ganti dulu dari susunan' };
  if (club.players.length <= LEAGUE.squadMin) return { league, error: `Skuad minimal ${LEAGUE.squadMin} pemain` };
  const next = withUserClub({ ...league, budget: league.budget + Math.round(playerValue(p) * LEAGUE.sellRate) }, { ...club, players: club.players.filter((x) => x.uid !== uid) });
  assertLeague(next);
  return { league: next, error: null };
}

// Cadangan uid menggantikan pemain inti di nomor `number` (posisi di formasi tetap).
export function setStarter(league, number, uid) {
  const club = userClub(league);
  if (!(String(number) in club.lineup)) throw new RangeError(`setStarter: nomor ${number} bukan posisi inti`);
  if (!club.players.some((p) => p.uid === uid)) throw new RangeError(`setStarter: pemain ${uid} tidak ada`);
  const lineup = { ...club.lineup };
  const already = Object.entries(lineup).find(([, u]) => u === uid);
  if (already) lineup[already[0]] = lineup[number]; // tukar dua pemain inti
  lineup[number] = uid;
  const next = withUserClub({ ...league, userTactics: null }, { ...club, lineup });
  assertLeague(next);
  return next;
}

// ---------------------------------------------------------------- laga pengguna

// Tim untuk engine: pengguna selalu id 'home' (taktik tersimpan merujuk 'home-<uid>'), lawan 'away'.
// Nomor punggung starter = nomor posisi formasi; cadangan 12+. Nama punggung dijaga unik per laga.
export function buildMatchTeams(league) {
  const f = userFixture(league);
  if (!f) throw new Error('buildMatchTeams: tidak ada laga tersisa');
  const user = userClub(league);
  const opp = clubById(league, f.home === user.id ? f.away : f.home);
  const used = new Set();
  const unique = (p) => {
    let name = p.shortName;
    if (used.has(name)) name = `${p.fullName.split(' ')[0][0]}. ${p.shortName}`;
    let k = 2;
    while (used.has(name)) name = `${p.shortName} ${k++}`;
    used.add(name);
    return name;
  };
  const toTeam = (club, simId, formation, philosophy) => {
    const slots = getFormation(formation);
    const byUid = new Map(club.players.map((p) => [p.uid, p]));
    const players = slots.map((s) => {
      const p = byUid.get(club.lineup[s.number]);
      if (!p) throw new Error(`buildMatchTeams: posisi ${s.number} ${club.id} kosong`);
      return { id: `${simId}-${p.uid}`, number: s.number, role: s.role, fullName: p.fullName, shortName: unique(p), stats: p.stats };
    });
    const starters = new Set(Object.values(club.lineup));
    const bench = club.players
      .filter((p) => !starters.has(p.uid))
      .slice(0, LEAGUE.benchInMatch)
      .map((p, i) => ({ id: `${simId}-${p.uid}`, number: 12 + i, role: p.role, fullName: p.fullName, shortName: unique(p), stats: p.stats }));
    return { id: simId, name: club.name, colors: club.colors, formation, philosophy, players, bench };
  };
  const oppStyle = getStyle(opp.style);
  const userStyle = getStyle(user.style);
  const userFormation = league.userFormation ?? userStyle.formation;
  return {
    fixture: f,
    userIsHome: f.home === user.id,
    opponent: opp,
    home: toTeam(user, 'home', userFormation, 'fisik'),
    away: toTeam(opp, 'away', oppStyle.formation, oppStyle.philosophy),
  };
}
