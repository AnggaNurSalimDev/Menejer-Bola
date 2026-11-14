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
import { TECHNICAL_STATS, GOALKEEPER_STATS, PSYCHOLOGICAL_STATS, STAT_MIN, STAT_MAX } from './stats.js';
import { logoErrors, defaultLogo, contrastColor } from './logo.js';
import { INJURY, rollSeverity } from './injury.js';
import { CLUB_DEFS, GUEST_DEFS, FOREIGN_IDS, AMATEUR_IDS, TIERS, CLUBS_PER_TIER, USER_CLUB, isGuestId } from './clubs.js';
import { DEV, DEFAULT_TRAINING, INTENSITY_INJURY, trainingErrors, overall, rollAgePot, developMonth, retireChance, recover } from './development.js';
import { COMP, COMP_KEYS, seasonSkeleton, SKELETON_LENGTH, stagesOf, drawPairs, koWinner, shootout, tableOf, eliteGroups, groupMatchdays, roundDate } from './calendar.js';
import { matchRatings } from './playerStats.js';

export { USER_CLUB, TIERS, CLUBS_PER_TIER, COMP };
export const SEASON_ROUNDS = SKELETON_LENGTH;

export const NAME_MAX = 28;
const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// v2 (14 Nov): profil karier — klub pilihan, nama klub, nama manajer, logo. v1 dimigrasi saat dimuat.
// v3 (14 Nov): absen (cedera, sakit, skorsing, izin), akumulasi kuning, kontrak (durasi + gaji),
//   pemasukan per pekan disetel dari gaji awal, kabar pekan. v2 dimigrasi saat dimuat.
// v4 (15 Nov): 3 kasta × 20 klub, kalender musim 62 babak (liga + Piala Nasional, Piala Liga, Piala Super,
//   Kejuaraan Elite, play-off promosi), naik-turun kasta, sejarah juara. `week` = indeks babak kalender.
//   v3 dimigrasi: 10 klub lama jadi bagian Liga 1, musim berjalan dimulai ulang dengan kalender baru.
// v5 (15 Nov): umur, potensi, kondisi (fit) per pemain; latihan tim; statistik pemain per ajang
//   (pstats) & penghargaan akhir musim. v4 dimigrasi: umur/potensi diundi, kondisi 100, statistik kosong.
export const LEAGUE_VERSION = 5;

export const LEAGUE = Object.freeze({
  clubs: TIERS.length * CLUBS_PER_TIER,
  // Pemasukan dasar per babak menurut kasta; pindah kasta → pemasukan bergeser sebesar selisihnya.
  tierIncome: Object.freeze({ 1: 14, 2: 8, 3: 5 }),
  // Hadiah akhir musim liga: dasar − langkah × (posisi − 1), minimal 0.
  seasonPrize: Object.freeze({ 1: [40, 2], 2: [20, 1], 3: [10, 0.5] }),
  // Hadiah piala: tiap lolos satu babak gugur / menang laga grup, dan juara.
  koPrize: Object.freeze({ nasional: 1, ligaCup: 0.5, elite: 3, super: 0, playoff: 2 }),
  groupWinPrize: 2,
  trophyPrize: Object.freeze({ nasional: 15, ligaCup: 8, elite: 30, super: 3 }),
  historyMax: 400,
  awardMinApps: 12, // penghargaan rating: minimal laga liga
  youngAge: 21,
  aiSquadTarget: 20, // klub AI ditambah pemain muda sampai sebanyak ini
  youthQualityByTier: Object.freeze({ 1: [9, 11], 2: [8, 10], 3: [7, 9] }),
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

// Pilihan klub untuk karier baru (tanpa skuad — skuad dibuat createLeague).
export const CLUB_CHOICES = Object.freeze(CLUB_DEFS.map((d) => Object.freeze({ id: d.id, name: d.name, style: d.style, quality: d.quality, colors: d.colors, tier: d.tier })));

const ROLE_GROUP = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' };
export const roleGroup = (role) => ROLE_GROUP[role] ?? 'MF';

export { overall };

// Harga (juta): naik ±35% per poin nilai, nilai 10 ≈ 5 juta.
// Umur (15 Nov): yang muda dihargai menurut potensinya, yang tua (≥ 31) didiskon.
export function playerValue(player) {
  const ovr = overall(player);
  const age = player.age ?? 26;
  const pot = Number.isFinite(player.pot) ? player.pot : ovr;
  const eff = ovr + (age <= 23 ? 0.5 * Math.max(0, pot - ovr) : 0) - (age >= 31 ? 0.3 * (age - 30) : 0);
  return Math.max(1, Math.round(5 * 1.35 ** (eff - 10)));
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
  return { id: def.id, name: def.name, colors: def.colors, style: def.style, quality: def.quality, tier: def.tier, players, lineup };
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
  // Kandang/tandang (15 Nov, perbaikan: dulu satu klub bisa kandang 19 kali beruntun). Tiap pasangan,
  // tuan rumah = klub yang lebih "berhak": baru tandang di babak lalu, lalu yang kandangnya lebih sedikit.
  const homes = new Map(order.map((id) => [id, 0]));
  const lastHome = new Map(order.map((id) => [id, null]));
  const claim = (id) => (lastHome.get(id) === false ? -10 : lastHome.get(id) === true ? 10 : 0) + homes.get(id);
  const first = [];
  let rot = order.slice(1);
  for (let w = 0; w < n - 1; w += 1) {
    const all = [order[0], ...rot];
    const week = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = all[i];
      const b = all[n - 1 - i];
      const aHome = claim(a) < claim(b) || (claim(a) === claim(b) && (w + i) % 2 === 0);
      const [home, away] = aHome ? [a, b] : [b, a];
      week.push({ home, away, result: null });
    }
    for (const f of week) {
      homes.set(f.home, homes.get(f.home) + 1);
      lastHome.set(f.home, true);
      lastHome.set(f.away, false);
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
  const base = { uid: `fa${n}`, fullName: src.fullName, shortName: src.shortName, role: src.role, stats: { ...src.stats } };
  return { ...base, ...rollAgePot(base, rng), fit: 100 };
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
  const market = { nextId: LEAGUE.marketSize, players: Array.from({ length: LEAGUE.marketSize }, (_, i) => makeFreeAgent(rng, i, used)) };
  // Kontrak memakai RNG sendiri supaya urutan undian lain tidak bergeser.
  const contractRng = createRng(seed + 7777);
  const signed = clubs.map((c) => ({ ...c, players: c.players.map((p) => withSquadFields(p, contractRng)) }));
  const userDef = signed.find((c) => c.id === clubId);
  // Musim 1: peserta Elite & Piala Super = klub Liga 1 terkuat (belum ada klasemen).
  const top1 = signed.filter((c) => c.tier === 1).sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
  const cup = seasonCup(top1.slice(0, 4).map((c) => c.id), [top1[0].id, top1[1].id], rng);
  const calendar = buildCalendar(signed, cup, rng);
  const income = round1(Math.max(LEAGUE.tierIncome[userDef.tier], wageBill(userDef) + LEAGUE.incomeMargin));
  const base = { version: LEAGUE_VERSION, seed, season: 1, week: 0, userClubId: clubId, clubs: signed, calendar, cup, history: [], pstats: {}, training: { ...DEFAULT_TRAINING }, budget: LEAGUE.startBudget, income, news: [], market, userTactics: null, rngState: rng.int(1, 1e9) };
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
  for (const t of TIERS) if (league.clubs.filter((c) => c.tier === t).length !== CLUBS_PER_TIER) e.push(`Liga ${t} tidak berisi ${CLUBS_PER_TIER} klub`);
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
  e.push(...calendarErrors(league, ids));
  e.push(...trainingErrors(league.training));
  if (!league.pstats || typeof league.pstats !== 'object') e.push('statistik pemain tidak valid');
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
    const l = migrateLeague(unpackLeague(JSON.parse(text)));
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
    return migrateLeague({ ...l, version: 3, clubs, income: round1(wageBill(user) + LEAGUE.incomeMargin), news: [] });
  }
  if (l.version === 3) {
    // Dunia baru 3 kasta dengan seed & klub pilihan yang sama; 10 klub lama (skuad, susunan, nama,
    // warna) dipindahkan ke Liga 1. Musim berjalan dimulai ulang; anggaran, profil, bursa tetap.
    const fresh = createLeague(Number.isInteger(l.seed) ? l.seed : 1, { clubId: l.userClubId });
    const old = new Map(l.clubs.map((c) => [c.id, c]));
    const clubs = fresh.clubs.map((c) => (old.has(c.id) ? { ...old.get(c.id), tier: c.tier } : c));
    const user = clubs.find((c) => c.id === l.userClubId);
    // `fresh` sudah v5; klub lama (v3) belum punya umur/kondisi → lengkapi di sini.
    const rngAp = createRng((Number(l.seed) || 1) + 4242);
    for (let k = 0; k < clubs.length; k += 1) if (old.has(clubs[k].id)) clubs[k] = { ...clubs[k], players: clubs[k].players.map((p) => withSquadFields(p, rngAp)) };
    return {
      ...fresh,
      clubs,
      season: l.season,
      budget: l.budget,
      income: round1(Math.max(l.income ?? 0, LEAGUE.tierIncome[1], wageBill(user) + LEAGUE.incomeMargin)),
      news: l.news ?? [],
      market: { ...l.market, players: (l.market?.players ?? []).map((p) => (Number.isInteger(p.age) ? p : { ...p, ...rollAgePot(p, rngAp), fit: 100 })) },
      profile: l.profile,
      userTactics: l.userTactics ?? null,
      ...(l.userFormation ? { userFormation: l.userFormation } : {}),
    };
  }
  if (l.version === 4) {
    if (!Array.isArray(l.clubs)) return null;
    const rng = createRng((Number(l.seed) || 1) + 4242);
    const clubs = l.clubs.map((c) => ({ ...c, players: c.players.map((p) => withSquadFields(p, rng)) }));
    const market = { ...l.market, players: (l.market?.players ?? []).map((p) => (Number.isInteger(p.age) ? p : { ...p, ...rollAgePot(p, rng), fit: 100 })) };
    return { ...l, version: 5, clubs, market, pstats: {}, training: { ...DEFAULT_TRAINING } };
  }
  return l;
}

// ---------------------------------------------------------------- hasil & klasemen

export const clubById = (league, id) => {
  const c = league.clubs.find((x) => x.id === id);
  if (c) return c;
  if (isGuestId(id)) return guestClub(league, id);
  throw new RangeError(`klub tidak dikenal: ${id}`);
};

// Klub tamu (luar negeri / amatir): dibuat dari seed liga saat dibutuhkan, tidak disimpan, tanpa absen.
const guestCache = new Map();
export function guestClub(league, id) {
  const key = `${league.seed}:${id}`;
  if (!guestCache.has(key)) {
    const def = GUEST_DEFS.find((d) => d.id === id);
    if (!def) throw new RangeError(`guestClub: ${id} bukan klub tamu`);
    const salt = [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 1000003, 7);
    const c = makeClub(def, (Number(league.seed) || 1) * 13 + salt, new Set());
    const players = c.players.map((p) => ({ ...p, absence: null, yellows: 0, contract: { seasons: 1, wage: 0.1 } }));
    guestCache.set(key, Object.freeze({ ...c, players, tier: 0, guest: def.kind }));
  }
  return guestCache.get(key);
}

// Logo yang ditampilkan untuk klub mana pun: klub pengguna = logo buatannya, klub AI = logo bawaan.
export function clubLogo(league, id) {
  if (id === league.userClubId) return league.profile.logo;
  return defaultLogo(clubById(league, id));
}

// Kekuatan hitung cepat: rata-rata nilai 11 pemain yang benar-benar main (klub AI merotasi yang lelah),
// dikurangi kelelahan: nilai × (0,85 + 0,15 × kondisi).
export function clubStrength(club, { rotate = true } = {}) {
  const starters = Object.values(effectiveLineup(club, null, { rotate }).lineup).map((uid) => club.players.find((p) => p.uid === uid));
  return starters.reduce((s, p) => s + overall(p) * (0.85 + 0.15 * ((p.fit ?? 100) / 100)), 0) / starters.length;
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

export function quickResult(home, away, rng, { neutral = false } = {}) {
  const q = LEAGUE.quick;
  const diff = clubStrength(home) - clubStrength(away);
  const lh = q.base * Math.exp(q.k * diff) * (neutral ? 1 : q.homeEdge);
  const la = q.base * Math.exp(-q.k * diff);
  return { home: poisson(rng, lh, q.maxGoals), away: poisson(rng, la, q.maxGoals) };
}

export const currentRound = (league) => (league.week < league.calendar.length ? league.calendar[league.week] : null);

export function userFixture(league) {
  const r = currentRound(league);
  if (!r || !r.fixtures) return null;
  return r.fixtures.find((f) => f.home === league.userClubId || f.away === league.userClubId) ?? null;
}

export const isKnockout = (round) => round.comp !== COMP.liga && !(round.comp === COMP.elite && round.stage.startsWith('G'));

// Rekam hasil laga pengguna (skor dari sudut klub pengguna), hitung cepat laga lain, maju satu pekan.
// report (14 Nov, opsional) = laporan laga pengguna dari engine:
//   { injuries: [{ uid, severity }], yellows: [{ uid, n }], reds: [uid] }
// Tutup babak kalender saat ini. Skor pengguna (dari sudut klub pengguna) hanya dipakai bila klub
// pengguna main di babak ini; laga lain dihitung cepat. Laga gugur yang seri → adu penalti.
export function completeWeek(league, userGoals, oppGoals, userTactics = null, report = null) {
  const round = currentRound(league);
  if (!round) throw new Error('completeWeek: musim sudah selesai');
  if (!round.fixtures) throw new Error('completeWeek: babak belum diundi');
  const uf = userFixture(league);
  if (uf && !(Number.isInteger(userGoals) && Number.isInteger(oppGoals) && userGoals >= 0 && oppGoals >= 0)) throw new RangeError('completeWeek: skor tidak valid');
  const reportErr = uf ? matchReportErrors(league, report) : [];
  if (reportErr.length) throw new RangeError(`completeWeek: laporan laga tidak valid: ${reportErr[0]}`);
  if (!uf) report = null;
  const rng = createRng(league.rngState);
  const ko = isKnockout(round);
  const resolve = (f, result) => {
    if (!ko || result.home !== result.away) return result;
    const diff = clubStrength(clubById(league, f.home)) - clubStrength(clubById(league, f.away));
    return { ...result, pens: shootout(rng, diff) };
  };
  const neutral = round.stage === 'F' && round.comp !== COMP.liga;
  const roundFixtures = round.fixtures.map((f) => {
    if (f === uf) return { ...f, result: resolve(f, f.home === league.userClubId ? { home: userGoals, away: oppGoals } : { home: oppGoals, away: userGoals }) };
    return { ...f, result: resolve(f, quickResult(clubById(league, f.home), clubById(league, f.away), rng, { neutral })) };
  });
  const calendar = league.calendar.map((r, i) => (i === league.week ? { ...r, fixtures: roundFixtures } : r));
  // Absen & kartu (14 Nov). Urutan: (1) absen lama berkurang satu pekan (laga ini sudah mereka lewatkan),
  // (2) cedera & kartu dari laga ini, (3) undian absen antar-laga untuk pekan depan.
  const weekNo = league.week + 1;
  const news = [];
  const inRound = new Set(roundFixtures.flatMap((f) => [f.home, f.away]));
  const playedThisWeek = new Map(league.clubs.filter((c) => inRound.has(c.id)).map((c) => [c.id, new Set(Object.values(effectiveLineup(c, null, { rotate: c.id !== league.userClubId }).lineup))]));
  // Statistik pemain (15 Nov): laga pengguna dari laporan engine, laga lain diundi dari hasil.
  const pstats = recordRoundStats(league, round, roundFixtures, report, rng);
  // Kondisi (15 Nov): yang main kehilangan kondisi; semua pulih menurut jumlah hari ke babak berikutnya.
  const today = roundDate(league.season, league.week);
  const nextDay = roundDate(league.season, league.week + 1);
  const days = nextDay ? Math.round((nextDay - today) / 86400000) : 0;
  const monthTurn = nextDay !== null && new Date(nextDay).getUTCMonth() !== new Date(today).getUTCMonth();
  const userEnergy = new Map((report?.players ?? []).filter((x) => x.side === 'user' && Number.isFinite(x.energy)).map((x) => [x.uid, x.energy]));
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
    } else if (!isUser && playedThisWeek.has(c.id)) {
      // Klub AI: cedera & kartu diundi dari pemain yang main pekan ini.
      const xi = [...playedThisWeek.get(c.id)];
      const am = LEAGUE.aiMatch;
      const avgFit = xi.reduce((sum, u) => sum + (players[byUid(u)]?.fit ?? 100), 0) / Math.max(1, xi.length);
      if (rng.chance(Math.min(0.6, am.injury * (1 + (1 - avgFit / 100))))) {
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
      else if (r < ab.illness + ab.personal + ab.training * (isUser ? INTENSITY_INJURY[league.training.intensity] : 1)) {
        const sev = rollSeverity(rng);
        out = ['cedera', injuryWeeks(sev, rng), `latihan-${sev}`];
      }
      if (!out) return p;
      const q = withAbsence(p, out[0], out[1], out[2]);
      log(q, out[0], out[1], out[2]);
      return q;
    });
    // Kondisi: biaya laga lalu pemulihan harian; perkembangan bulanan bila bulan berganti.
    const played = playedThisWeek.get(c.id);
    const intensity = isUser ? league.training.intensity : 'normal';
    const starters = new Set(Object.values(effectiveLineup({ ...c, players }, isUser ? league.userFormation : null, { rotate: !isUser }).lineup));
    players = players.map((p) => {
      let fit = p.fit ?? 100;
      if (isUser && userEnergy.has(p.uid)) fit = Math.min(fit, Math.round(userEnergy.get(p.uid) * 100));
      else if (!isUser && played?.has(p.uid)) fit = Math.max(20, fit - rng.int(DEV.aiMatchCost[0], DEV.aiMatchCost[1]));
      let q = { ...p, fit: recover(fit, days, intensity) };
      if (monthTurn) q = developMonth(q, rng, { starter: starters.has(p.uid), training: isUser ? league.training : DEFAULT_TRAINING });
      return q;
    });
    return { ...c, players };
  });
  const user = clubs.find((c) => c.id === league.userClubId);
  // Piala: hadiah & kabar untuk klub pengguna, juara ke sejarah.
  let prize = 0;
  const history = [...league.history];
  const done = roundFixtures.find((f) => f.home === league.userClubId || f.away === league.userClubId);
  if (done && round.comp !== COMP.liga) {
    const opp = done.home === league.userClubId ? done.away : done.home;
    if (ko) {
      const won = koWinner(done) === league.userClubId;
      if (won) prize += LEAGUE.koPrize[round.comp] ?? 0;
      news.push({ week: weekNo, uid: '', name: clubById(league, opp).name, type: won ? 'lolos' : 'gugur', weeks: 0, detail: `${round.comp}:${round.stage}` });
    } else {
      const mine = done.home === league.userClubId ? done.result.home : done.result.away;
      const theirs = done.home === league.userClubId ? done.result.away : done.result.home;
      if (mine > theirs) prize += LEAGUE.groupWinPrize;
    }
  }
  if (round.stage === 'F' && round.comp !== COMP.playoff) {
    const champ = koWinner(roundFixtures[0]);
    history.push({ season: league.season, comp: round.comp, tier: 0, winner: champ, name: clubById(league, champ).name });
    if (champ === league.userClubId) {
      prize += LEAGUE.trophyPrize[round.comp] ?? 0;
      news.push({ week: weekNo, uid: '', name: '', type: 'juara', weeks: 0, detail: round.comp });
    }
  }
  const budget = round1(league.budget + league.income - wageBill(user) + prize);
  let next = {
    ...league,
    clubs,
    calendar,
    history: history.slice(-LEAGUE.historyMax),
    week: league.week + 1,
    budget,
    news: [...news, ...league.news].slice(0, LEAGUE.newsMax),
    pstats,
    userTactics: done ? (userTactics ?? league.userTactics) : league.userTactics,
    market: refreshMarket(league.market, rng),
  };
  next = prepareRound(next, rng);
  next = { ...next, rngState: rng.int(1, 1e9) };
  assertLeague(next);
  return next;
}

// ---------------------------------------------------------------- statistik pemain (15 Nov)
//   league.pstats[ajang][uid] = [main, gol, assist, jumlah rating × 10, idKlub]
//   ajang: 'liga1'/'liga2'/'liga3' atau kunci piala (nasional, ligaCup, elite, super, playoff)
export const statKey = (round, fixture) => (round.comp === COMP.liga ? `liga${fixture.tier}` : round.comp);

function addStat(table, uid, clubId, { goals = 0, assists = 0, rating }) {
  const cur = table[uid] ?? [0, 0, 0, 0, clubId];
  table[uid] = [cur[0] + 1, cur[1] + goals, cur[2] + assists, cur[3] + Math.round(rating * 10), clubId];
}

// Laga hitung cepat: pencetak gol dari pemain inti (bobot posisi × finishing), assist 70% (bobot
// posisi × passing), rating 6,3 ± hasil ± acak + gol/assist, kiper ± kebobolan.
function quickPlayerStats(league, club, gf, ga, rng) {
  const lineup = effectiveLineup(club, null, { rotate: !club.guest && club.id !== league.userClubId }).lineup;
  const xi = Object.values(lineup).map((u) => club.players.find((p) => p.uid === u)).filter(Boolean);
  const out = new Map(xi.map((p) => [p.uid, { goals: 0, assists: 0 }]));
  const pickBy = (wf) => {
    const w = xi.map((p) => Math.max(0, wf(p)));
    let r = rng.next() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < xi.length; i += 1) if ((r -= w[i]) <= 0) return xi[i];
    return xi[xi.length - 1];
  };
  const G = { FW: 0.55, MF: 0.32, DF: 0.12, GK: 0 };
  const A = { FW: 0.35, MF: 0.45, DF: 0.2, GK: 0.02 };
  for (let g = 0; g < gf; g += 1) {
    const scorer = pickBy((p) => G[roleGroup(p.role)] * (p.stats.finishing ?? 8));
    out.get(scorer.uid).goals += 1;
    if (rng.chance(0.7)) {
      const helper = pickBy((p) => (p.uid === scorer.uid ? 0 : A[roleGroup(p.role)] * (p.stats.passing ?? 8)));
      if (helper.uid !== scorer.uid) out.get(helper.uid).assists += 1;
    }
  }
  const res = gf > ga ? 0.4 : gf < ga ? -0.4 : 0;
  return xi.map((p) => {
    const o = out.get(p.uid);
    let r = 6.3 + res + rng.normal(0, 0.45) + o.goals * 1.0 + o.assists * 0.6;
    if (p.role === 'GK') r += ga === 0 ? 0.6 : -0.3 * ga;
    return { uid: p.uid, goals: o.goals, assists: o.assists, rating: Math.round(Math.min(10, Math.max(3, r)) * 10) / 10 };
  });
}

function recordRoundStats(league, round, fixtures, report, rng) {
  const pstats = { ...league.pstats };
  for (const f of fixtures) {
    const key = statKey(round, f);
    const table = { ...(pstats[key] ?? {}) };
    const isUserFixture = f.home === league.userClubId || f.away === league.userClubId;
    if (isUserFixture && report?.players?.length) {
      const opp = f.home === league.userClubId ? f.away : f.home;
      for (const x of report.players) addStat(table, x.uid, x.side === 'user' ? league.userClubId : opp, x);
    } else {
      for (const [clubId, gf, ga] of [
        [f.home, f.result.home, f.result.away],
        [f.away, f.result.away, f.result.home],
      ]) {
        for (const x of quickPlayerStats(league, clubById(league, clubId), gf, ga, rng)) addStat(table, x.uid, clubId, x);
      }
    }
    pstats[key] = table;
  }
  return pstats;
}

// Daftar pemain teratas satu ajang. by: 'goals' | 'assists' | 'rating' (minimal minApps laga).
export function topPlayers(league, key, by = 'goals', { limit = 10, minApps = 1, role = null, maxAge = null } = {}) {
  const table = league.pstats?.[key] ?? {};
  const findPlayer = (uid, clubId) => {
    try {
      return clubById(league, clubId).players.find((p) => p.uid === uid) ?? null;
    } catch {
      return null;
    }
  };
  const rows = Object.entries(table)
    .map(([uid, [apps, goals, assists, rsum, clubId]]) => ({ uid, apps, goals, assists, rating: apps ? rsum / 10 / apps : 0, clubId, player: findPlayer(uid, clubId) }))
    .filter((r) => r.player && r.apps >= minApps && (!role || (role === 'GK') === (r.player.role === 'GK')) && (maxAge === null || r.player.age <= maxAge));
  const val = (r) => (by === 'rating' ? r.rating : r[by]);
  return rows.sort((a, b) => val(b) - val(a) || b.goals - a.goals || b.rating - a.rating || a.uid.localeCompare(b.uid)).filter((r) => by === 'rating' || val(r) > 0).slice(0, limit);
}

// Statistik musim ini seorang pemain di liga (untuk tab Skuad).
export function seasonLine(league, uid) {
  let apps = 0;
  let goals = 0;
  let assists = 0;
  let rsum = 0;
  for (const table of Object.values(league.pstats ?? {})) {
    const row = table[uid];
    if (!row) continue;
    apps += row[0];
    goals += row[1];
    assists += row[2];
    rsum += row[3];
  }
  return { apps, goals, assists, rating: apps ? rsum / 10 / apps : null };
}

// Hitung cepat semua babak tanpa klub pengguna sampai laga pengguna berikutnya / akhir musim.
export function simulateToUserMatch(league) {
  let l = league;
  for (let guard = 0; guard < SKELETON_LENGTH + 2 && !seasonOver(l) && !userFixture(l); guard += 1) l = completeWeek(l, 0, 0);
  return l;
}

// ---------------------------------------------------------------- kalender & piala (15 Nov)

function seasonCup(eliteIds, superPair, rng) {
  if (eliteIds.length !== 4 || new Set(eliteIds).size !== 4) throw new RangeError('seasonCup: butuh 4 peserta Elite berbeda');
  if (superPair.length !== 2 || superPair[0] === superPair[1]) throw new RangeError('seasonCup: Piala Super butuh 2 klub berbeda');
  return { eliteIds: [...eliteIds], superPair: [...superPair], groups: eliteGroups(eliteIds, [...FOREIGN_IDS], rng) };
}

function buildCalendar(clubs, cup, rng) {
  const perTier = Object.fromEntries(TIERS.map((t) => [t, roundRobin(clubs.filter((c) => c.tier === t).map((c) => c.id), rng)]));
  const groupDays = cup.groups.map((g, gi) => groupMatchdays(g, gi));
  return seasonSkeleton().map(({ comp, stage }) => {
    let fixtures = null;
    if (comp === COMP.liga) {
      const n = Number(stage.slice(1)) - 1;
      fixtures = TIERS.flatMap((t) => perTier[t][n].map((f) => ({ ...f, tier: t })));
    } else if (comp === COMP.super) fixtures = [{ home: cup.superPair[0], away: cup.superPair[1], result: null }];
    else if (comp === COMP.elite && stage.startsWith('G')) fixtures = groupDays.flatMap((g) => g[Number(stage.slice(1)) - 1]);
    return { comp, stage, fixtures };
  });
}

const prevStage = (comp, stage) => {
  const list = stagesOf(comp);
  const i = list.indexOf(stage);
  if (i <= 0) throw new RangeError(`prevStage: ${comp} ${stage} tidak punya babak sebelumnya`);
  return list[i - 1];
};

function winnersOf(league, comp, stage) {
  const r = league.calendar.find((x) => x.comp === comp && x.stage === stage);
  if (!r || !r.fixtures || r.fixtures.some((f) => !f.result)) throw new Error(`winnersOf: ${comp} ${stage} belum selesai`);
  return r.fixtures.map((f) => ({ id: koWinner(f), tier: f.tier }));
}

export function eliteTables(league) {
  const fixtures = league.calendar.filter((r) => r.comp === COMP.elite && r.stage.startsWith('G')).flatMap((r) => r.fixtures ?? []);
  return league.cup.groups.map((g, gi) => tableOf(fixtures.filter((f) => f.group === gi), g, (id) => clubById(league, id).name));
}

// Undi babak saat ini bila belum (babak gugur bergantung pada hasil babak sebelumnya).
function prepareRound(league, rng) {
  const round = currentRound(league);
  if (!round || round.fixtures) return league;
  const { comp, stage } = round;
  let fixtures;
  if (comp === COMP.nasional && stage === 'R64') fixtures = drawPairs([...league.clubs.map((c) => c.id), ...AMATEUR_IDS], rng);
  else if (comp === COMP.ligaCup && stage === 'R1') fixtures = drawPairs(league.clubs.map((c) => c.id).filter((id) => !league.cup.eliteIds.includes(id)), rng);
  else if (comp === COMP.ligaCup && stage === 'R2') fixtures = drawPairs([...winnersOf(league, comp, 'R1').map((w) => w.id), ...league.cup.eliteIds], rng);
  else if (comp === COMP.elite && stage === 'QF') {
    const t = eliteTables(league);
    fixtures = [
      [t[0][0].id, t[1][1].id],
      [t[1][0].id, t[0][1].id],
      [t[2][0].id, t[3][1].id],
      [t[3][0].id, t[2][1].id],
    ].map(([home, away]) => ({ home, away, result: null }));
  } else if (comp === COMP.playoff && stage === 'SF') {
    fixtures = [2, 3].flatMap((tier) => {
      const t = standings(league, tier);
      return [
        { home: t[2].id, away: t[5].id, result: null, tier },
        { home: t[3].id, away: t[4].id, result: null, tier },
      ];
    });
  } else if (comp === COMP.playoff && stage === 'F') {
    const w = winnersOf(league, comp, 'SF');
    fixtures = [2, 3].map((tier) => {
      const pair = w.filter((x) => x.tier === tier).map((x) => x.id);
      return { home: pair[0], away: pair[1], result: null, tier };
    });
  } else fixtures = drawPairs(winnersOf(league, comp, prevStage(comp, stage)).map((w) => w.id), rng);
  return { ...league, calendar: league.calendar.map((r, i) => (i === league.week ? { ...r, fixtures } : r)) };
}

function calendarErrors(league, leagueIds) {
  const e = [];
  const cal = league.calendar;
  if (!Array.isArray(cal) || cal.length !== SKELETON_LENGTH) return ['kalender musim tidak valid'];
  if (!(Number.isInteger(league.week) && league.week >= 0 && league.week <= cal.length)) e.push('babak di luar kalender');
  const cup = league.cup;
  if (!cup || !Array.isArray(cup.eliteIds) || cup.eliteIds.length !== 4 || !cup.eliteIds.every((id) => leagueIds.has(id))) e.push('peserta Elite tidak valid');
  if (!cup || !Array.isArray(cup.groups) || cup.groups.length !== 4 || cup.groups.some((g) => g.length !== 4)) e.push('grup Elite tidak valid');
  if (!Array.isArray(league.history)) e.push('sejarah juara tidak valid');
  const known = (id) => leagueIds.has(id) || isGuestId(id);
  cal.forEach((r, i) => {
    const tag = `babak ${i + 1} (${r.comp} ${r.stage})`;
    if (!COMP_KEYS.includes(r.comp)) e.push(`${tag}: ajang tidak dikenal`);
    if (r.fixtures === null) {
      if (i === league.week) e.push(`${tag}: babak berjalan belum diundi`);
      if (i < league.week) e.push(`${tag}: babak lewat tanpa laga`);
      return;
    }
    if (!Array.isArray(r.fixtures) || r.fixtures.length === 0) {
      e.push(`${tag}: daftar laga kosong`);
      return;
    }
    const seen = new Set();
    for (const f of r.fixtures) {
      if (!known(f.home) || !known(f.away) || f.home === f.away) e.push(`${tag}: laga tidak valid`);
      if (seen.has(f.home) || seen.has(f.away)) e.push(`${tag}: klub main dua kali`);
      seen.add(f.home);
      seen.add(f.away);
      const res = f.result;
      if (i < league.week && !res) e.push(`${tag}: sudah lewat tapi ada laga tanpa hasil`);
      if (i >= league.week && res) e.push(`${tag}: belum dimainkan tapi ada hasil`);
      if (res && !(Number.isInteger(res.home) && Number.isInteger(res.away) && res.home >= 0 && res.away >= 0)) e.push(`${tag}: skor tidak valid`);
      if (res && isKnockout(r) && res.home === res.away && !(res.pens && res.pens.home !== res.pens.away)) e.push(`${tag}: laga gugur seri tanpa adu penalti`);
    }
  });
  return e;
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
  const ap = Number.isInteger(p.age) && Number.isFinite(p.pot) ? { age: p.age, pot: p.pot } : rollAgePot(p, rng);
  return {
    ...p,
    ...ap,
    fit: Number.isFinite(p.fit) ? p.fit : 100,
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
  if (!(Number.isInteger(p.age) && p.age >= 14 && p.age <= 40)) e.push('umur tidak valid');
  if (!(Number.isFinite(p.pot) && p.pot >= 1 && p.pot <= 20)) e.push('potensi tidak valid');
  if (!(Number.isFinite(p.fit) && p.fit >= 0 && p.fit <= 100)) e.push('kondisi tidak valid');
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
// rotate (15 Nov, klub AI): pemain inti dengan kondisi < DEV.aiRestBelow diistirahatkan bila ada
// pengganti segar (≥ DEV.freshFrom) yang nilainya tidak jauh di bawah (≤ 2,5).
export function effectiveLineup(club, formation = null, { rotate = false } = {}) {
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
  if (rotate) {
    for (const s of slots) {
      const cur = byUid.get(lineup[s.number]);
      if (!cur || (cur.fit ?? 100) >= DEV.aiRestBelow) continue;
      const fresh = club.players
        .filter((p) => isAvailable(p) && !used.has(p.uid) && (p.fit ?? 100) >= DEV.freshFrom && (s.role === 'GK') === (p.role === 'GK') && roleGroup(p.role) === roleGroup(s.role) && overall(p) >= overall(cur) - 2.5)
        .sort((a, b) => overall(b) - overall(a) || a.uid.localeCompare(b.uid))[0];
      if (!fresh) continue;
      changes.push({ number: s.number, outUid: cur.uid, inUid: fresh.uid, rest: true });
      used.delete(cur.uid);
      lineup[s.number] = fresh.uid;
      used.add(fresh.uid);
    }
  }
  return { lineup, changes };
}

// Tombol "istirahatkan yang lelah" (pengguna): inti dengan kondisi < batas diganti pemain segar
// terbaik di kelompok posisi yang sama, lalu disimpan sebagai susunan baru.
export function restTired(league, threshold = DEV.tiredBelow) {
  const club = userClub(league);
  const byUid = new Map(club.players.map((p) => [p.uid, p]));
  const slots = getFormation(league.userFormation ?? getStyle(club.style).formation);
  const lineup = { ...club.lineup };
  const used = new Set(Object.values(lineup));
  const swaps = [];
  for (const s of slots) {
    const cur = byUid.get(lineup[s.number]);
    if (!cur || (cur.fit ?? 100) >= threshold) continue;
    const fresh = club.players
      .filter((p) => isAvailable(p) && !used.has(p.uid) && (p.fit ?? 100) >= DEV.freshFrom && (s.role === 'GK') === (p.role === 'GK') && roleGroup(p.role) === roleGroup(s.role))
      .sort((a, b) => overall(b) - overall(a) || a.uid.localeCompare(b.uid))[0];
    if (!fresh) continue;
    swaps.push({ number: s.number, outUid: cur.uid, inUid: fresh.uid });
    used.delete(cur.uid);
    used.add(fresh.uid);
    lineup[s.number] = fresh.uid;
  }
  if (swaps.length === 0) return { league, swaps };
  const next = withUserClub({ ...league, userTactics: null }, { ...club, lineup });
  assertLeague(next);
  return { league: next, swaps };
}

export function setTraining(league, training) {
  const t = { ...league.training, ...training };
  const e = trainingErrors(t);
  if (e.length) throw new RangeError(`setTraining: ${e[0]}`);
  const next = { ...league, training: t };
  assertLeague(next);
  return next;
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
  for (const x of report.players ?? []) {
    if (x.side === 'user' && !uids.has(x.uid)) e.push(`statistik ${x.uid}`);
    if (!(x.rating >= 1 && x.rating <= 10) || !(Number.isInteger(x.goals) && x.goals >= 0) || !(Number.isInteger(x.assists) && x.assists >= 0)) e.push(`statistik ${x.uid} tidak valid`);
  }
  return e;
}

// Laporan laga dari state akhir engine (pemain pengguna berid 'home-<uid>').
export function matchReportFromState(state, simTeamId = 'home') {
  const prefix = `${simTeamId}-`;
  const mine = (p) => p.teamId === simTeamId && String(p.id).startsWith(prefix);
  const uid = (p) => String(p.id).slice(prefix.length);
  const everyone = [...state.players, ...(state.subbedOff ?? []), ...(state.sentOff ?? [])].filter(mine);
  const seen = new Set();
  const report = { injuries: [], yellows: [], reds: [], players: [] };
  // Rating & gol/assist semua pemain (kedua tim); uid tanpa awalan 'home-'/'away-'.
  for (const [id, r] of Object.entries(matchRatings(state))) {
    const side = String(id).startsWith(prefix) ? 'user' : 'opp';
    const u = String(id).replace(/^(home|away)-/, '');
    report.players.push({ uid: u, side, rating: r.rating, goals: r.goals, assists: r.assists, minutes: r.minutes, energy: r.energy });
  }
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

// Klasemen satu kasta (bawaan: kasta klub pengguna).
export function standings(league, tier = clubById(league, league.userClubId).tier) {
  if (!TIERS.includes(tier)) throw new RangeError(`standings: kasta ${tier} tidak ada`);
  const ids = league.clubs.filter((c) => c.tier === tier).map((c) => c.id);
  const fixtures = league.calendar.filter((r) => r.comp === COMP.liga).flatMap((r) => (r.fixtures ?? []).filter((f) => f.tier === tier));
  return tableOf(fixtures, ids, (id) => clubById(league, id).name);
}

export const seasonOver = (league) => league.week >= league.calendar.length;

// Musim baru: jadwal baru, skuad & anggaran dipertahankan, hadiah posisi.
export function newSeason(league) {
  if (!seasonOver(league)) throw new Error('newSeason: musim belum selesai');
  const tables = Object.fromEntries(TIERS.map((t) => [t, standings(league, t)]));
  const userTierOld = clubById(league, league.userClubId).tier;
  const pos = tables[userTierOld].findIndex((r) => r.id === league.userClubId);
  const [base, step] = LEAGUE.seasonPrize[userTierOld];
  const prize = Math.max(0, base - step * pos);
  const rng = createRng(league.rngState);
  // Naik-turun kasta: 3 terbawah turun; 2 teratas naik langsung + pemenang play-off.
  const poFinal = league.calendar.find((r) => r.comp === COMP.playoff && r.stage === 'F');
  const poWinner = (tier) => koWinner(poFinal.fixtures.find((f) => f.tier === tier));
  const moves = new Map();
  for (const t of TIERS) {
    if (t < TIERS[TIERS.length - 1]) for (const r of tables[t].slice(-3)) moves.set(r.id, t + 1);
    if (t > TIERS[0]) {
      for (const r of tables[t].slice(0, 2)) moves.set(r.id, t - 1);
      moves.set(poWinner(t), t - 1);
    }
  }
  const history = [...league.history, ...TIERS.map((t) => ({ season: league.season, comp: COMP.liga, tier: t, winner: tables[t][0].id, name: tables[t][0].name }))];
  // Penghargaan per kasta (15 Nov): pemain terbaik, top skor, kiper terbaik, pemain muda terbaik.
  for (const t of TIERS) {
    const key = `liga${t}`;
    const min = LEAGUE.awardMinApps;
    const picks = [
      ['terbaik', topPlayers(league, key, 'rating', { limit: 1, minApps: min })[0], (r) => r.rating],
      ['topskor', topPlayers(league, key, 'goals', { limit: 1 })[0], (r) => r.goals],
      ['kiper', topPlayers(league, key, 'rating', { limit: 1, minApps: min, role: 'GK' })[0], (r) => r.rating],
      ['muda', topPlayers(league, key, 'rating', { limit: 1, minApps: min, maxAge: LEAGUE.youngAge })[0], (r) => r.rating],
    ];
    for (const [kind, r, val] of picks) {
      if (!r) continue;
      history.push({ season: league.season, comp: 'award', tier: t, kind, winner: r.clubId, name: r.player.fullName, club: clubById(league, r.clubId).name, value: Math.round(val(r) * 100) / 100 });
    }
  }
  const nasionalWinner = koWinner(league.calendar.find((r) => r.comp === COMP.nasional && r.stage === 'F').fixtures[0]);
  const champ = tables[1][0].id;
  const superPair = [champ, nasionalWinner === champ || !league.clubs.some((c) => c.id === nasionalWinner) ? tables[1][1].id : nasionalWinner];
  // Pergantian musim (14 Nov): kuning & skorsing dihapus, cedera tetap. Kontrak berkurang satu musim:
  // pemain pengguna yang kontraknya habis PERGI; klub AI memperpanjang otomatis.
  const news = [];
  let market = league.market;
  const clubs = league.clubs.map((c) => {
    const isUser = c.id === league.userClubId;
    // Umur +1, kondisi pulih penuh; yang tua bisa pensiun (pemain pengguna: masuk kabar).
    let players = c.players
      .map((p) => ({ ...p, age: p.age + 1, fit: 100, yellows: 0, absence: p.absence?.type === 'skors' ? null : p.absence }))
      .filter((p) => {
        if (!rng.chance(retireChance(p.age))) return true;
        if (isUser) news.push({ week: 0, season: league.season + 1, uid: p.uid, name: p.fullName, type: 'pensiun', weeks: p.age, detail: null });
        return false;
      });
    players = players
      .map((p) => {
        const left = p.contract.seasons - 1;
        if (left >= 1) return { ...p, contract: { ...p.contract, seasons: left } };
        if (!isUser) return { ...p, contract: { seasons: rng.int(1, LEAGUE.renewMax), wage: wageFor(p) } };
        news.push({ week: 0, season: league.season + 1, uid: p.uid, name: p.fullName, type: 'pergi', weeks: 0, detail: null });
        return null;
      })
      .filter(Boolean);
    // Pemain muda: klub AI diisi sampai LEAGUE.aiSquadTarget, klub pengguna dapat satu dari akademi
    // (bila ada tempat), dan siapa pun yang di bawah minimum diisi sampai minimum.
    const intake = isUser ? Math.max(LEAGUE.squadMin - players.length, players.length < LEAGUE.squadMax ? 1 : 0) : Math.max(0, LEAGUE.aiSquadTarget - players.length);
    for (let k = 0; k < intake; k += 1) {
      const kid = makeYouth(rng, market.nextId, c.id, moves.get(c.id) ?? c.tier);
      market = { ...market, nextId: market.nextId + 1 };
      players.push(kid);
      if (isUser) news.push({ week: 0, season: league.season + 1, uid: kid.uid, name: kid.fullName, type: 'muda', weeks: kid.age, detail: null });
    }
    return { ...c, tier: moves.get(c.id) ?? c.tier, players, lineup: repairLineup({ ...c, players }) };
  });
  const userTierNew = clubs.find((c) => c.id === league.userClubId).tier;
  if (userTierNew !== userTierOld) news.push({ week: 0, season: league.season + 1, uid: '', name: '', type: userTierNew < userTierOld ? 'naik' : 'turun', weeks: userTierNew, detail: null });
  const income = round1(Math.max(1, league.income + LEAGUE.tierIncome[userTierNew] - LEAGUE.tierIncome[userTierOld]));
  const cup = seasonCup(tables[1].slice(0, 4).map((r) => r.id), superPair, rng);
  const calendar = buildCalendar(clubs, cup, rng);
  const next = {
    ...league,
    clubs,
    market,
    cup,
    calendar,
    income,
    history: history.slice(-LEAGUE.historyMax),
    pstats: {},
    news: [...news, ...league.news].slice(0, LEAGUE.newsMax),
    season: league.season + 1,
    week: 0,
    budget: round1(league.budget + prize),
    rngState: rng.int(1, 1e9),
  };
  assertLeague(next);
  return next;
}

function makeYouth(rng, n, clubId, tier = 3) {
  const roles = ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'LM', 'RM', 'LW', 'RW', 'ST', 'ST'];
  const role = rng.pick(roles);
  const [qlo, qhi] = LEAGUE.youthQualityByTier[tier] ?? LEAGUE.youthQuality;
  const quality = rng.int(qlo, qhi);
  const t = createTeam({ usedShortNames: new Set(), id: `y${n}`, name: 'Muda', colors: { shirt: '#000', number: '#fff' }, formation: '4-4-2', quality, philosophy: 'seimbang', seed: rng.int(1, 1e9) });
  const src = t.players.find((p) => p.role === role) ?? t.players[1];
  const p = { uid: `${clubId}-y${n}`, fullName: src.fullName, shortName: src.shortName, role: src.role, stats: { ...src.stats } };
  const age = rng.int(DEV.youthAge[0], DEV.youthAge[1]);
  const pot = Math.round(Math.min(19, overall(p) + rng.range(2, 6)) * 10) / 10;
  return { ...p, age, pot, fit: 100, absence: null, yellows: 0, contract: { seasons: 2, wage: wageFor(p) } };
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
  const startEnergy = {};
  const toTeam = (club, simId, formation, philosophy, rotate) => {
    const slots = getFormation(formation);
    const byUid = new Map(club.players.map((p) => [p.uid, p]));
    const { lineup } = effectiveLineup(club, formation, { rotate });
    for (const p of club.players) startEnergy[`${simId}-${p.uid}`] = Math.max(0.2, Math.min(1, (p.fit ?? 100) / 100));
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
  const away = toTeam(opp, 'away', oppStyle.formation, oppStyle.philosophy, true);
  // Warna jersey bertabrakan (logo pengguna bisa berwarna apa saja) → lawan memakai jersey kedua.
  if (colorDistance(user.colors.shirt, opp.colors.shirt) < KIT_CLASH) {
    const alt = colorDistance(user.colors.shirt, '#f1f3f5') < KIT_CLASH ? '#212529' : '#f1f3f5';
    away.colors = { ...away.colors, shirt: alt, number: contrastColor(alt) };
  }
  return {
    fixture: f,
    userIsHome: f.home === user.id,
    opponent: opp,
    home: toTeam(user, 'home', userFormation, userStyle.philosophy, false),
    away,
    startEnergy,
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

// ---------------------------------------------------------------- simpanan padat (15 Nov)
// 60 klub × ±18 pemain: stat disimpan sebagai larik berurutan (0 = stat tidak ada) supaya muat di
// localStorage (3 slot; di itch.io satu origin dipakai bersama banyak game).
const PACK_KEYS = Object.freeze([...TECHNICAL_STATS, ...PSYCHOLOGICAL_STATS, ...GOALKEEPER_STATS]); // urutan sama dengan generator stat
const packPlayer = (p) => {
  for (const k of Object.keys(p.stats)) if (!PACK_KEYS.includes(k)) throw new Error(`packLeague: stat tak dikenal ${k}`);
  return { ...p, stats: PACK_KEYS.map((k) => p.stats[k] ?? 0) };
};
const unpackPlayer = (p) => {
  if (!Array.isArray(p.stats)) return p;
  if (p.stats.length !== PACK_KEYS.length) throw new Error('unpackLeague: panjang stat salah');
  return { ...p, stats: Object.fromEntries(PACK_KEYS.map((k, i) => [k, p.stats[i]]).filter(([, v]) => v > 0)) };
};
export function packLeague(league) {
  return {
    ...league,
    packed: 1,
    clubs: league.clubs.map((c) => ({ ...c, players: c.players.map(packPlayer) })),
    market: { ...league.market, players: league.market.players.map(packPlayer) },
  };
}
export function unpackLeague(data) {
  if (!data || data.packed !== 1) return data;
  const { packed, ...rest } = data;
  return {
    ...rest,
    clubs: rest.clubs.map((c) => ({ ...c, players: c.players.map(unpackPlayer) })),
    market: { ...rest.market, players: rest.market.players.map(unpackPlayer) },
  };
}
