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
import { logoErrors, defaultLogo, contrastColor } from './logo.js';
import { INJURY, rollSeverity } from './injury.js';

export const NAME_MAX = 28;
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// v2 (14 Nov): profil karier — klub pilihan, nama klub, nama manajer, logo. v1 dimigrasi saat dimuat.
// v3 (14 Nov): absen (cedera, sakit, skorsing, izin), akumulasi kuning, kontrak (durasi + gaji),
//   pemasukan per pekan disetel dari gaji awal, kabar pekan. v2 dimigrasi saat dimuat.
export const LEAGUE_VERSION = 3;
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
  // Absen antar-laga per pemain per pekan (semua klub). Lihat bagian "absen & kontrak" di bawah.
  absence: Object.freeze({ illness: 0.006, illnessWeeks: [1, 2], personal: 0.003, personalWeeks: [1, 1], training: 0.004 }),
  // Laga klub AI dihitung cepat: cedera & kartu ikut diundi supaya mereka juga kehilangan pemain.
  aiMatch: Object.freeze({ injury: 0.2, yellowPerStarter: 0.12, red: 0.04 }),
  yellowLimit: 5, // akumulasi 5 kuning = skorsing 1 laga
  // Kontrak: gaji/pekan = nilai × wageRate (juta). Pemasukan/pekan = gaji awal skuad + incomeMargin.
  wageRate: 0.04,
  incomeMargin: 2,
  renewRaise: 0.1, // perpanjangan: gaji naik 10% (tidak pernah turun)
  contractSeasons: Object.freeze([1, 4]),
  buyContractSeasons: 2,
  renewMax: 3,
  youthQuality: Object.freeze([8, 10]), // pemain muda dipromosikan bila skuad di bawah minimum
  newsMax: 40,
});

export const ABSENCE_TYPES = Object.freeze(['cedera', 'sakit', 'skors', 'izin']);
const round1 = (n) => Math.round(n * 10) / 10;

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

// Pilihan klub untuk karier baru (tanpa skuad — skuad dibuat createLeague).
export const CLUB_CHOICES = Object.freeze(CLUB_DEFS.map((d) => Object.freeze({ id: d.id, name: d.name, style: d.style, quality: d.quality, colors: d.colors })));

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

// profile = { clubId, clubName, managerName, logo } — semuanya opsional (bawaan: Persada Bandung).
export function createLeague(seed = 2026, profile = {}) {
  if (!Number.isInteger(seed)) throw new TypeError('createLeague: seed harus bilangan bulat');
  const clubId = profile.clubId ?? USER_CLUB;
  const def = CLUB_DEFS.find((d) => d.id === clubId);
  if (!def) throw new RangeError(`createLeague: klub tidak dikenal ${clubId}`);
  const rng = createRng(seed);
  const used = new Set();
  // Nama punggung boleh sama antar-klub (hanya 40 nama belakang); keunikan dijaga per laga (buildMatchTeams).
  const clubs = CLUB_DEFS.map((def, i) => {
    if (used.size > 20) used.clear();
    return makeClub(def, seed + i * 7, used);
  });
  const fixtures = roundRobin(clubs.map((c) => c.id), rng);
  const market = { nextId: LEAGUE.marketSize, players: Array.from({ length: LEAGUE.marketSize }, (_, i) => makeFreeAgent(rng, i, used)) };
  // Kontrak memakai RNG sendiri: jadwal & bursa untuk seed yang sama tidak berubah dari versi lama.
  const contractRng = createRng(seed + 7777);
  const signed = clubs.map((c) => ({ ...c, players: c.players.map((p) => withSquadFields(p, contractRng)) }));
  const userDef = signed.find((c) => c.id === clubId);
  const base = { version: LEAGUE_VERSION, seed, season: 1, week: 0, userClubId: clubId, clubs: signed, fixtures, budget: LEAGUE.startBudget, income: round1(wageBill(userDef) + LEAGUE.incomeMargin), news: [], market, userTactics: null, rngState: rng.int(1, 1e9) };
  const name = cleanName(profile.clubName) || def.name;
  const league = updateProfile(
    { ...base, profile: { managerName: 'Manajer', logo: defaultLogo({ name, colors: def.colors }) } },
    { clubName: name, managerName: profile.managerName ?? 'Manajer', logo: profile.logo ?? defaultLogo({ name, colors: def.colors }) },
  );
  assertLeague(league);
  return league;
}

// Ubah profil karier: nama klub, nama manajer, logo. Warna jersey klub = warna utama logo.
export function updateProfile(league, { clubName, managerName, logo }) {
  const user = clubById(league, league.userClubId);
  const name = clubName === undefined ? user.name : cleanName(clubName);
  const manager = managerName === undefined ? league.profile.managerName : cleanName(managerName);
  const nextLogo = logo === undefined ? league.profile.logo : { ...logo };
  if (!name) throw new RangeError('updateProfile: nama klub kosong');
  if (!manager) throw new RangeError('updateProfile: nama manajer kosong');
  const le = logoErrors(nextLogo);
  if (le.length) throw new RangeError(`updateProfile: ${le[0]}`);
  if (league.clubs.some((c) => c.id !== user.id && c.name.toLowerCase() === name.toLowerCase())) throw new RangeError('updateProfile: nama klub sudah dipakai klub lain');
  const colors = { ...user.colors, shirt: nextLogo.primary, number: contrastColor(nextLogo.primary) };
  const next = {
    ...league,
    profile: { managerName: manager, logo: nextLogo },
    clubs: league.clubs.map((c) => (c.id === user.id ? { ...c, name, colors } : c)),
  };
  if (next.version === LEAGUE_VERSION) assertLeague(next);
  return next;
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
    for (const p of c.players) e.push(...squadFieldErrors(p).map((x) => `${c.id}/${p.uid}: ${x}`));
  }
  if (!(Number.isFinite(league.income) && league.income > 0)) e.push('pemasukan tidak valid');
  if (!Array.isArray(league.news)) e.push('kabar pekan tidak valid');
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
  // Anggaran boleh minus (gaji melebihi pemasukan); pembelian ditolak selama minus.
  if (!Number.isFinite(league.budget)) e.push('anggaran tidak valid');
  const pr = league.profile;
  if (!pr || typeof pr !== 'object') e.push('profil karier tidak ada');
  else {
    if (typeof pr.managerName !== 'string' || !pr.managerName.trim() || pr.managerName.length > NAME_MAX) e.push('nama manajer tidak valid');
    e.push(...logoErrors(pr.logo).map((x) => `profil: ${x}`));
  }
  const names = league.clubs.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) e.push('nama klub ganda');
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
    const l = migrateLeague(JSON.parse(text));
    return l && leagueErrors(l).length === 0 ? l : null;
  } catch {
    return null;
  }
}

// v1 → v2: tambah profil (manajer "Manajer", logo dari warna klub). v2 → v3: kontrak, absen, pemasukan.
export function migrateLeague(l) {
  if (!l || typeof l !== 'object') return null;
  if (l.version === 1) {
    const user = Array.isArray(l.clubs) ? l.clubs.find((c) => c.id === l.userClubId) : null;
    if (!user) return null;
    return migrateLeague({ ...l, version: 2, profile: { managerName: 'Manajer', logo: defaultLogo(user) } });
  }
  if (l.version === 2) {
    if (!Array.isArray(l.clubs)) return null;
    const rng = createRng((l.seed ?? 1) + 7777);
    const clubs = l.clubs.map((c) => ({ ...c, players: c.players.map((p) => withSquadFields(p, rng)) }));
    const user = clubs.find((c) => c.id === l.userClubId);
    if (!user) return null;
    return { ...l, version: 3, clubs, income: round1(wageBill(user) + LEAGUE.incomeMargin), news: [] };
  }
  return l;
}

// ---------------------------------------------------------------- hasil & klasemen

export const clubById = (league, id) => {
  const c = league.clubs.find((x) => x.id === id);
  if (!c) throw new RangeError(`klub tidak dikenal: ${id}`);
  return c;
};

// Logo yang ditampilkan untuk klub mana pun: klub pengguna = logo buatannya, klub AI = logo bawaan.
export function clubLogo(league, id) {
  if (id === league.userClubId) return league.profile.logo;
  return defaultLogo(clubById(league, id));
}

export function clubStrength(club) {
  const starters = Object.values(effectiveLineup(club).lineup).map((uid) => club.players.find((p) => p.uid === uid));
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
// report (14 Nov, opsional) = laporan laga pengguna dari engine:
//   { injuries: [{ uid, severity }], yellows: [{ uid, n }], reds: [uid] }
export function completeWeek(league, userGoals, oppGoals, userTactics = null, report = null) {
  if (league.week >= league.fixtures.length) throw new Error('completeWeek: musim sudah selesai');
  if (!(Number.isInteger(userGoals) && Number.isInteger(oppGoals) && userGoals >= 0 && oppGoals >= 0)) throw new RangeError('completeWeek: skor tidak valid');
  const reportErr = matchReportErrors(league, report);
  if (reportErr.length) throw new RangeError(`completeWeek: laporan laga tidak valid: ${reportErr[0]}`);
  const rng = createRng(league.rngState);
  const week = league.fixtures[league.week].map((f) => {
    if (f.home === league.userClubId) return { ...f, result: { home: userGoals, away: oppGoals } };
    if (f.away === league.userClubId) return { ...f, result: { home: oppGoals, away: userGoals } };
    return { ...f, result: quickResult(clubById(league, f.home), clubById(league, f.away), rng) };
  });
  const fixtures = league.fixtures.map((w, i) => (i === league.week ? week : w));
  // Absen & kartu (14 Nov). Urutan: (1) absen lama berkurang satu pekan (laga ini sudah mereka lewatkan),
  // (2) cedera & kartu dari laga ini, (3) undian absen antar-laga untuk pekan depan.
  const weekNo = league.week + 1;
  const news = [];
  const playedThisWeek = new Map(league.clubs.map((c) => [c.id, new Set(Object.values(effectiveLineup(c).lineup))]));
  const clubs = league.clubs.map((c) => {
    const isUser = c.id === league.userClubId;
    const log = (p, type, weeks, detail = null) => isUser && news.push({ week: weekNo, uid: p.uid, name: p.fullName, type, weeks, detail });
    let players = c.players.map((p) => tickAbsence(p));
    const byUid = (uid) => players.findIndex((p) => p.uid === uid);
    const setP = (i, fn) => {
      players = players.map((p, k) => (k === i ? fn(p) : p));
    };
    if (isUser && report) {
      for (const inj of report.injuries ?? []) {
        const i = byUid(inj.uid);
        const weeks = injuryWeeks(inj.severity, rng);
        setP(i, (p) => withAbsence(p, 'cedera', weeks, inj.severity));
        log(players[i], 'cedera', weeks, inj.severity);
      }
      for (const uid of report.reds ?? []) {
        const i = byUid(uid);
        setP(i, (p) => withAbsence(p, 'skors', 1, 'merah'));
        log(players[i], 'skors', 1, 'merah');
      }
      for (const y of report.yellows ?? []) {
        const i = byUid(y.uid);
        const total = players[i].yellows + y.n;
        if (total >= LEAGUE.yellowLimit) {
          setP(i, (p) => ({ ...withAbsence(p, 'skors', 1, 'kuning'), yellows: total - LEAGUE.yellowLimit }));
          log(players[i], 'skors', 1, 'kuning');
        } else setP(i, (p) => ({ ...p, yellows: total }));
      }
    } else if (!isUser) {
      // Klub AI: cedera & kartu diundi dari pemain yang main pekan ini.
      const xi = [...playedThisWeek.get(c.id)];
      const am = LEAGUE.aiMatch;
      if (rng.chance(am.injury)) {
        const i = byUid(rng.pick(xi));
        setP(i, (p) => withAbsence(p, 'cedera', injuryWeeks(rollSeverity(rng), rng)));
      }
      if (rng.chance(am.red)) {
        const i = byUid(rng.pick(xi));
        setP(i, (p) => withAbsence(p, 'skors', 1, 'merah'));
      }
      for (const uid of xi) {
        if (!rng.chance(am.yellowPerStarter)) continue;
        const i = byUid(uid);
        const total = players[i].yellows + 1;
        setP(i, (p) => (total >= LEAGUE.yellowLimit ? { ...withAbsence(p, 'skors', 1, 'kuning'), yellows: 0 } : { ...p, yellows: total }));
      }
    }
    // Absen antar-laga (semua klub): sakit, izin pribadi, cedera latihan — hanya yang sedang tersedia.
    const ab = LEAGUE.absence;
    players = players.map((p) => {
      if (p.absence) return p;
      const r = rng.next();
      let out = null;
      if (r < ab.illness) out = ['sakit', rng.int(ab.illnessWeeks[0], ab.illnessWeeks[1]), null];
      else if (r < ab.illness + ab.personal) out = ['izin', rng.int(ab.personalWeeks[0], ab.personalWeeks[1]), null];
      else if (r < ab.illness + ab.personal + ab.training) {
        const sev = rollSeverity(rng);
        out = ['cedera', injuryWeeks(sev, rng), `latihan-${sev}`];
      }
      if (!out) return p;
      const q = withAbsence(p, out[0], out[1], out[2]);
      log(q, out[0], out[1], out[2]);
      return q;
    });
    return { ...c, players };
  });
  const user = clubs.find((c) => c.id === league.userClubId);
  const budget = round1(league.budget + league.income - wageBill(user));
  const next = {
    ...league,
    clubs,
    fixtures,
    week: league.week + 1,
    budget,
    news: [...news, ...league.news].slice(0, LEAGUE.newsMax),
    userTactics: userTactics ?? league.userTactics,
    market: refreshMarket(league.market, rng),
    rngState: rng.int(1, 1e9),
  };
  assertLeague(next);
  return next;
}

// ---------------------------------------------------------------- absen & kontrak (14 Nov)
//
//   pemain = { …, absence: null | { type: cedera|sakit|skors|izin, weeks ≥ 1, detail }, yellows 0–4,
//              contract: { seasons ≥ 1 (sisa musim, termasuk musim ini), wage (juta/pekan) } }
//   susunan tersimpan = PILIHAN; yang dipakai di laga = effectiveLineup (yang absen diganti otomatis).

export const isAvailable = (p) => !p.absence;

export function wageFor(player) {
  return Math.max(0.1, round1(playerValue(player) * LEAGUE.wageRate));
}

export function wageBill(club) {
  return round1(club.players.reduce((s, p) => s + (p.contract?.wage ?? 0), 0));
}

function withSquadFields(p, rng) {
  return {
    ...p,
    absence: p.absence ?? null,
    yellows: p.yellows ?? 0,
    contract: p.contract ?? { seasons: rng.int(LEAGUE.contractSeasons[0], LEAGUE.contractSeasons[1]), wage: wageFor(p) },
  };
}

function squadFieldErrors(p) {
  const e = [];
  if (p.absence !== null) {
    if (!p.absence || !ABSENCE_TYPES.includes(p.absence.type)) e.push('jenis absen tidak dikenal');
    else if (!(Number.isInteger(p.absence.weeks) && p.absence.weeks >= 1)) e.push('lama absen tidak valid');
  }
  if (!(Number.isInteger(p.yellows) && p.yellows >= 0 && p.yellows < LEAGUE.yellowLimit)) e.push('akumulasi kuning tidak valid');
  if (!p.contract || !(Number.isInteger(p.contract.seasons) && p.contract.seasons >= 1 && p.contract.seasons <= LEAGUE.contractSeasons[1])) e.push('sisa kontrak tidak valid');
  else if (!(p.contract.wage > 0)) e.push('gaji tidak valid');
  return e;
}

// Absen yang lebih lama menang (skorsing 1 laga tidak memperpendek cedera 4 pekan).
function withAbsence(p, type, weeks, detail = null) {
  if (!ABSENCE_TYPES.includes(type)) throw new RangeError(`withAbsence: jenis tidak dikenal ${type}`);
  if (!(Number.isInteger(weeks) && weeks >= 1)) throw new RangeError(`withAbsence: lama tidak valid ${weeks}`);
  if (p.absence && p.absence.weeks >= weeks) return p;
  return { ...p, absence: { type, weeks, detail } };
}

function tickAbsence(p) {
  if (!p.absence) return p;
  return p.absence.weeks <= 1 ? { ...p, absence: null } : { ...p, absence: { ...p.absence, weeks: p.absence.weeks - 1 } };
}

// Lama absen cedera menurut tingkat (sama dengan cedera saat laga di engine).
function injuryWeeks(severity, rng) {
  const sev = String(severity).replace(/^latihan-/, '');
  const s = INJURY.severities.find((x) => x.key === sev);
  if (!s) throw new RangeError(`injuryWeeks: tingkat tidak dikenal ${severity}`);
  return rng.int(s.weeks[0], s.weeks[1]);
}

// Susunan yang benar-benar dipakai: pemain inti yang absen diganti cadangan tersedia terbaik
// (kiper → kiper bila ada; lainnya utamakan kelompok posisi yang sama).
export function effectiveLineup(club, formation = null) {
  const slots = getFormation(formation ?? getStyle(club.style).formation);
  const byUid = new Map(club.players.map((p) => [p.uid, p]));
  const lineup = { ...club.lineup };
  const used = new Set(Object.values(lineup).filter((u) => byUid.get(u) && isAvailable(byUid.get(u))));
  const changes = [];
  for (const s of slots) {
    const cur = byUid.get(lineup[s.number]);
    if (cur && isAvailable(cur)) continue;
    const free = club.players.filter((p) => isAvailable(p) && !used.has(p.uid));
    const want = roleGroup(s.role);
    const pool = s.role === 'GK' ? free.filter((p) => p.role === 'GK') : free.filter((p) => p.role !== 'GK');
    const pick =
      [...pool].sort((a, b) => (roleGroup(b.role) === want) - (roleGroup(a.role) === want) || overall(b) - overall(a) || a.uid.localeCompare(b.uid))[0] ??
      [...free].sort((a, b) => overall(b) - overall(a) || a.uid.localeCompare(b.uid))[0];
    if (!pick) continue; // skuad habis: biarkan (tidak terjadi dengan skuad minimal 18)
    changes.push({ number: s.number, outUid: lineup[s.number], inUid: pick.uid });
    lineup[s.number] = pick.uid;
    used.add(pick.uid);
  }
  return { lineup, changes };
}

// Cadangan yang ikut laga: 7 pemain tersedia terbaik, dengan satu kiper bila ada.
export function matchBench(club, lineup) {
  const starters = new Set(Object.values(lineup));
  const free = club.players.filter((p) => isAvailable(p) && !starters.has(p.uid)).sort((a, b) => overall(b) - overall(a) || a.uid.localeCompare(b.uid));
  let bench = free.slice(0, LEAGUE.benchInMatch);
  const gk = free.find((p) => p.role === 'GK');
  if (gk && !bench.includes(gk)) bench = [...bench.slice(0, LEAGUE.benchInMatch - 1), gk];
  return bench;
}

export function absentPlayers(club) {
  return club.players.filter((p) => !isAvailable(p));
}

function matchReportErrors(league, report) {
  if (report === null || report === undefined) return [];
  if (typeof report !== 'object') return ['bukan objek'];
  const uids = new Set(clubById(league, league.userClubId).players.map((p) => p.uid));
  const e = [];
  for (const x of report.injuries ?? []) if (!uids.has(x.uid) || !INJURY.severities.some((s) => s.key === x.severity)) e.push(`cedera ${x.uid}`);
  for (const uid of report.reds ?? []) if (!uids.has(uid)) e.push(`merah ${uid}`);
  for (const y of report.yellows ?? []) if (!uids.has(y.uid) || !(Number.isInteger(y.n) && y.n >= 1 && y.n <= 2)) e.push(`kuning ${y.uid}`);
  return e;
}

// Laporan laga dari state akhir engine (pemain pengguna berid 'home-<uid>').
export function matchReportFromState(state, simTeamId = 'home') {
  const prefix = `${simTeamId}-`;
  const mine = (p) => p.teamId === simTeamId && String(p.id).startsWith(prefix);
  const uid = (p) => String(p.id).slice(prefix.length);
  const everyone = [...state.players, ...(state.subbedOff ?? []), ...(state.sentOff ?? [])].filter(mine);
  const seen = new Set();
  const report = { injuries: [], yellows: [], reds: [] };
  for (const p of everyone) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.injury) report.injuries.push({ uid: uid(p), severity: p.injury.severity });
    const sentRed = (state.sentOff ?? []).find((q) => q.id === p.id && q.card !== 'injury');
    if (sentRed) report.reds.push(uid(p));
    else if (p.discipline?.yellows > 0) report.yellows.push({ uid: uid(p), n: Math.min(2, p.discipline.yellows) });
  }
  return report;
}

// Perpanjang kontrak pemain pengguna: `seasons` musim mulai musim ini; gaji naik, tidak pernah turun.
export function renewContract(league, uid, seasons) {
  if (!(Number.isInteger(seasons) && seasons >= 1 && seasons <= LEAGUE.renewMax)) throw new RangeError(`renewContract: lama ${seasons} di luar 1–${LEAGUE.renewMax}`);
  const club = userClub(league);
  const p = club.players.find((x) => x.uid === uid);
  if (!p) throw new RangeError(`renewContract: pemain ${uid} tidak ada`);
  if (p.contract.seasons >= seasons) return { league, error: 'Kontrak sekarang sudah sepanjang itu' };
  const wage = Math.max(p.contract.wage, round1(wageFor(p) * (1 + LEAGUE.renewRaise)));
  const next = withUserClub(league, { ...club, players: club.players.map((x) => (x.uid === uid ? { ...x, contract: { seasons, wage } } : x)) });
  assertLeague(next);
  return { league: next, error: null };
}

export function renewWage(player) {
  return Math.max(player.contract.wage, round1(wageFor(player) * (1 + LEAGUE.renewRaise)));
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
  // Pergantian musim (14 Nov): kuning & skorsing dihapus, cedera tetap. Kontrak berkurang satu musim:
  // pemain pengguna yang kontraknya habis PERGI; klub AI memperpanjang otomatis.
  const news = [];
  let market = league.market;
  const clubs = league.clubs.map((c) => {
    const isUser = c.id === league.userClubId;
    let players = c.players.map((p) => ({ ...p, yellows: 0, absence: p.absence?.type === 'skors' ? null : p.absence }));
    players = players
      .map((p) => {
        const left = p.contract.seasons - 1;
        if (left >= 1) return { ...p, contract: { ...p.contract, seasons: left } };
        if (!isUser) return { ...p, contract: { seasons: rng.int(1, LEAGUE.renewMax), wage: wageFor(p) } };
        news.push({ week: 0, season: league.season + 1, uid: p.uid, name: p.fullName, type: 'pergi', weeks: 0, detail: null });
        return null;
      })
      .filter(Boolean);
    // Skuad di bawah minimum → pemain muda dipromosikan (kontrak 1 musim, gaji kecil).
    while (players.length < LEAGUE.squadMin) {
      const kid = makeYouth(rng, market.nextId, c.id);
      market = { ...market, nextId: market.nextId + 1 };
      players.push(kid);
      if (isUser) news.push({ week: 0, season: league.season + 1, uid: kid.uid, name: kid.fullName, type: 'muda', weeks: 0, detail: null });
    }
    return { ...c, players, lineup: repairLineup({ ...c, players }) };
  });
  const next = { ...league, clubs, market, news: [...news, ...league.news].slice(0, LEAGUE.newsMax), season: league.season + 1, week: 0, fixtures: roundRobin(league.clubs.map((c) => c.id), rng), budget: round1(league.budget + prize), rngState: rng.int(1, 1e9) };
  assertLeague(next);
  return next;
}

function makeYouth(rng, n, clubId) {
  const roles = ['GK', 'CB', 'LB', 'RB', 'CM', 'CM', 'LM', 'RM', 'ST'];
  const role = rng.pick(roles);
  const quality = rng.int(LEAGUE.youthQuality[0], LEAGUE.youthQuality[1]);
  const t = createTeam({ usedShortNames: new Set(), id: `y${n}`, name: 'Muda', colors: { shirt: '#000', number: '#fff' }, formation: '4-4-2', quality, philosophy: 'seimbang', seed: rng.int(1, 1e9) });
  const src = t.players.find((p) => p.role === role) ?? t.players[1];
  const p = { uid: `${clubId}-y${n}`, fullName: src.fullName, shortName: src.shortName, role: src.role, stats: { ...src.stats } };
  return { ...p, absence: null, yellows: 0, contract: { seasons: 1, wage: wageFor(p) } };
}

// Susunan tersimpan yang menunjuk pemain yang sudah pergi: isi dengan pemain terbaik yang tersisa.
function repairLineup(club) {
  const uids = new Set(club.players.map((p) => p.uid));
  const lineup = { ...club.lineup };
  const slots = getFormation(getStyle(club.style).formation);
  const numbers = Object.keys(lineup).map(Number);
  for (const n of numbers) {
    if (uids.has(lineup[n])) continue;
    const role = slots.find((s) => s.number === n)?.role ?? 'CM';
    const taken = new Set(Object.values(lineup));
    const free = club.players.filter((p) => !taken.has(p.uid));
    const pool = role === 'GK' ? free.filter((p) => p.role === 'GK') : free.filter((p) => p.role !== 'GK');
    const pick = [...(pool.length ? pool : free)].sort((a, b) => (roleGroup(b.role) === roleGroup(role)) - (roleGroup(a.role) === roleGroup(role)) || overall(b) - overall(a) || a.uid.localeCompare(b.uid))[0];
    if (!pick) throw new Error(`repairLineup: ${club.id} kehabisan pemain`);
    lineup[n] = pick.uid;
  }
  return lineup;
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
  if (price > league.budget) return { league, error: `Anggaran kurang (butuh ${price} jt, ada ${round1(league.budget)} jt)` };
  if (club.players.length >= LEAGUE.squadMax) return { league, error: `Skuad penuh (maks ${LEAGUE.squadMax})` };
  const newUid = `${club.id}-b${league.market.nextId}-${uid}`;
  const next = withUserClub({ ...league, budget: league.budget - price, market: { ...league.market, players: league.market.players.filter((x) => x.uid !== uid) } }, { ...club, players: [...club.players, { ...p, uid: newUid, absence: null, yellows: 0, contract: { seasons: LEAGUE.buyContractSeasons, wage: wageFor(p) } }] });
  assertLeague(next);
  return { league: next, error: null };
}

export function sellPlayer(league, uid) {
  const club = userClub(league);
  const p = club.players.find((x) => x.uid === uid);
  if (!p) throw new RangeError(`sellPlayer: pemain ${uid} tidak ada`);
  if (Object.values(club.lineup).includes(uid)) return { league, error: 'Pemain inti tidak bisa dijual — ganti dulu dari susunan' };
  if (club.players.length <= LEAGUE.squadMin) return { league, error: `Skuad minimal ${LEAGUE.squadMin} pemain` };
  const next = withUserClub({ ...league, budget: round1(league.budget + Math.round(playerValue(p) * LEAGUE.sellRate)) }, { ...club, players: club.players.filter((x) => x.uid !== uid) });
  assertLeague(next);
  return { league: next, error: null };
}

// Cadangan uid menggantikan pemain inti di nomor `number` (posisi di formasi tetap).
export function setStarter(league, number, uid) {
  const club = userClub(league);
  if (!(String(number) in club.lineup)) throw new RangeError(`setStarter: nomor ${number} bukan posisi inti`);
  const chosen = club.players.find((p) => p.uid === uid);
  if (!chosen) throw new RangeError(`setStarter: pemain ${uid} tidak ada`);
  if (!isAvailable(chosen)) throw new RangeError(`setStarter: pemain ${uid} sedang absen (${chosen.absence.type})`);
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
    const { lineup } = effectiveLineup(club, formation);
    const players = slots.map((s) => {
      const p = byUid.get(lineup[s.number]);
      if (!p) throw new Error(`buildMatchTeams: posisi ${s.number} ${club.id} kosong`);
      return { id: `${simId}-${p.uid}`, number: s.number, role: s.role, fullName: p.fullName, shortName: unique(p), stats: p.stats };
    });
    const bench = matchBench(club, lineup).map((p, i) => ({ id: `${simId}-${p.uid}`, number: 12 + i, role: p.role, fullName: p.fullName, shortName: unique(p), stats: p.stats }));
    return { id: simId, name: club.name, colors: club.colors, formation, philosophy, players, bench };
  };
  const oppStyle = getStyle(opp.style);
  const userStyle = getStyle(user.style);
  const userFormation = league.userFormation ?? userStyle.formation;
  const away = toTeam(opp, 'away', oppStyle.formation, oppStyle.philosophy);
  // Warna jersey bertabrakan (logo pengguna bisa berwarna apa saja) → lawan memakai jersey kedua.
  if (colorDistance(user.colors.shirt, opp.colors.shirt) < KIT_CLASH) {
    const alt = colorDistance(user.colors.shirt, '#f1f3f5') < KIT_CLASH ? '#212529' : '#f1f3f5';
    away.colors = { ...away.colors, shirt: alt, number: contrastColor(alt) };
  }
  return {
    fixture: f,
    userIsHome: f.home === user.id,
    opponent: opp,
    home: toTeam(user, 'home', userFormation, userStyle.philosophy),
    away,
  };
}

// Jarak warna sederhana (RGB berbobot, 0–~765) untuk mendeteksi jersey yang mirip.
const KIT_CLASH = 120;
export function colorDistance(a, b) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) throw new RangeError('colorDistance: warna tidak valid');
  const [x, y] = [rgb(a), rgb(b)];
  return Math.abs(x[0] - y[0]) * 0.9 + Math.abs(x[1] - y[1]) * 1.2 + Math.abs(x[2] - y[2]) * 0.9;
}
