// Hari demi hari & karier manajer (16 Nov, keputusan pengguna):
//   - hari berjalan otomatis, berhenti saat ada event penting atau hari laga;
//   - tawaran melatih klub lain → bisa pindah klub di tengah musim, rekam jejak ikut;
//   - dewan direksi punya target & kepercayaan; terlalu rendah → dipecat (langsung pilih tawaran baru);
//   - sesi latihan taktik dijadwalkan pengguna (hari dalam pekan), hasilnya acak menurut kecerdasan pemain.
//
//   league.career = {
//     day,                        // hari ini (ms UTC, tengah malam) — selalu ≤ tanggal babak berjalan
//     rep,                        // reputasi manajer 0–100
//     stints: [{ clubId, name, tier, start:{season,week}, end:null|{season,week,why}, w,d,l,gf,ga,
//                trophies:[{season,comp,tier}], seasons:[{season,tier,pos}] }],   // terakhir = klub sekarang
//     board: { season, expected, conf, warned },                                     // conf 0–100
//     pending: null | { type:'tawaran', clubId } | { type:'dipecat', offers:[clubId] },
//     diary: [{ day, type, ... }],  // terbaru di depan
//     tacticDays: [0–6],           // hari sesi taktik (0 = Minggu)
//     lastMatchDay,                // tanggal laga pengguna terakhir (hari sesudahnya = pemulihan)
//   }
//
//   alur:  [laga pengguna] ─closeUserRound─▶ hari laga ─advanceDay─▶ hari+1 ─▶ … ─▶ hari laga berikutnya
//                                                  │ babak AI yang tanggalnya lewat → completeWeek(0,0)
//                                                  └ event harian: sakit/izin, cedera latihan, sesi taktik, tawaran
//
// Modul murni: tiap fungsi mengembalikan liga baru. Bergantung pada league.js (bukan sebaliknya).

import { createRng } from './rng.js';
import { defaultLogo } from './logo.js';
import { roundDate, koWinner } from './calendar.js';
import { DEV, INTENSITY_INJURY } from './development.js';
import { FAMILIARITY, learnRate, iqOf, TEMPLATE_KEYS } from './tacticTemplates.js';
import { rollSeverity } from './injury.js';
import { MASTERY } from './simulation.js';
import { drillGain } from './drill.js';
import {
  LEAGUE,
  TIERS,
  COMP,
  completeWeek,
  newSeason,
  seasonOver,
  userFixture,
  currentRound,
  clubById,
  standings,
  clubStrength,
  leagueErrors,
  withAbsence,
  injuryWeeks,
  starterPlayers,
  wageBill,
  isKnockout,
} from './league.js';

export const DAY = 86400000;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export const CAREER = Object.freeze({
  preseasonDays: 5, // hari latihan sebelum babak pertama musim
  diaryMax: 40,
  tacticDaysMax: 3,
  defaultTacticDays: Object.freeze([3]), // Rabu
  // Peluang harian per pemain (dari peluang per babak liga.js × 62 babak / ±290 hari musim).
  illness: 0.0013,
  personal: 0.0006,
  trainingInjury: 0.0012, // hanya hari latihan, × intensitas
  // Sesi taktik: tambahan keakraban template aktif (× kecepatan belajar pemain inti).
  session: Object.freeze({ bagus: 3, biasa: 1.6, buruk: 0.4 }),
  // Tawaran: peluang per hari bila ada klub yang cocok; tidak di 14 hari pertama di klub.
  offerPerDay: 0.006,
  offerCooldownDays: 30, // setelah tawaran (diterima/ditolak) tidak ada tawaran baru selama ini
  offerSettleDays: 14,
  offerRepSlack: 8, // klub boleh sedikit di atas reputasi
  // Prestise klub: dasar kasta + peringkat kekuatan di kastanya.
  tierPrestige: Object.freeze({ 1: 55, 2: 30, 3: 8 }),
  prestigeSpan: 25,
  // Reputasi.
  rep: Object.freeze({ win: 0.4, draw: 0.1, loss: -0.4, trophy: 6, eliteTrophy: 10, superTrophy: 2, title: 8, topTitle: 12, promotion: 6, relegation: -8, sacked: -8, startBelowPrestige: 10, minStart: 15 }),
  // Dewan: harapan poin/laga dari peringkat kekuatan; kepercayaan ditarik ke target posisi.
  board: Object.freeze({ start: 60, pull: 0.25, perPoint: 2.5, posStep: 4, minGames: 5, sackBelow: 15, sackMinGames: 8, warnBelow: 30, relegationSackBelow: 45, koLoss: -3, trophy: 15, carry: 0.5, carryBase: 30 }),
  switchBudget: Object.freeze({ 1: 60, 2: 35, 3: 20 }),
  labFitCost: 3,
  masteryMax: 40,
  labResultsMax: 24,
});

export const STOP_EVENTS = Object.freeze(['cedera', 'tawaran', 'dipecat', 'peringatan']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (n) => Math.round(n * 10) / 10;
const dayOf = (ms) => Math.floor(ms / DAY) * DAY;
export const weekday = (ms) => new Date(ms).getUTCDay();
const career = (league) => {
  if (!league.career) throw new Error('karier belum diisi (panggil withCareer)');
  return league.career;
};
export const currentStint = (league) => career(league).stints[career(league).stints.length - 1];

// ---------------------------------------------------------------- prestise, harapan, reputasi

// Peringkat kekuatan klub di kastanya (1 = terkuat).
export function strengthRank(league, clubId) {
  const tier = clubById(league, clubId).tier;
  const ranked = league.clubs
    .filter((c) => c.tier === tier)
    .map((c) => ({ id: c.id, s: clubStrength(c, { rotate: false }) }))
    .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
  const i = ranked.findIndex((r) => r.id === clubId);
  if (i < 0) throw new RangeError(`strengthRank: ${clubId} tidak di Liga ${tier}`);
  return i + 1;
}

export function prestige(league, clubId) {
  const c = clubById(league, clubId);
  const n = league.clubs.filter((x) => x.tier === c.tier).length;
  return round1(CAREER.tierPrestige[c.tier] + ((n - strengthRank(league, clubId)) / Math.max(1, n - 1)) * CAREER.prestigeSpan);
}

// Target dewan dari posisi yang diharapkan.
export function boardTarget(expected) {
  if (expected <= 2) return 'juara';
  if (expected <= 6) return 'atas';
  if (expected <= 14) return 'tengah';
  return 'bertahan';
}
const expectedPpg = (expected) => 2.3 - (expected - 1) * 0.09;

function freshBoard(league, clubId, conf = CAREER.board.start) {
  return { season: league.season, expected: strengthRank(league, clubId), conf: round1(clamp(conf, 0, 100)), warned: false };
}

function newStint(league, clubId, day) {
  const c = clubById(league, clubId);
  if (!Number.isFinite(day)) throw new RangeError('newStint: hari mulai tidak valid');
  return { clubId, name: c.name, tier: c.tier, start: { season: league.season, week: league.week, day }, end: null, w: 0, d: 0, l: 0, gf: 0, ga: 0, trophies: [], seasons: [] };
}

// Isi karier untuk liga baru / simpanan lama (v6). Idempoten.
export function withCareer(league) {
  if (!league || league.career) return league;
  const firstDay = roundDate(league.season, 0);
  const at = seasonOver(league) ? roundDate(league.season, league.calendar.length - 1) : roundDate(league.season, league.week);
  // Liga baru: beberapa hari pramusim. Simpanan lama: tepat di hari laga yang sedang menunggu.
  const day = league.week === 0 && league.season === 1 && !league.calendar[0].fixtures?.some((f) => f.result) ? firstDay - CAREER.preseasonDays * DAY : at;
  const rep = round1(Math.max(CAREER.rep.minStart, prestige(league, league.userClubId) - CAREER.rep.startBelowPrestige));
  const next = {
    ...league,
    career: { day: dayOf(day), rep, stints: [newStint(league, league.userClubId, dayOf(day))], board: freshBoard(league, league.userClubId), pending: null, diary: [], tacticDays: [...CAREER.defaultTacticDays], lastMatchDay: null },
  };
  assertCareer(next);
  return next;
}

// ---------------------------------------------------------------- validasi

export function careerErrors(league) {
  const e = [];
  const c = league.career;
  if (!c || typeof c !== 'object') return ['karier kosong'];
  if (!Number.isFinite(c.day) || c.day % DAY !== 0) e.push('hari tidak valid');
  if (!seasonOver(league) && c.day > roundDate(league.season, league.week)) e.push('hari melewati babak berjalan');
  if (!(c.rep >= 0 && c.rep <= 100)) e.push('reputasi di luar 0–100');
  if (!Array.isArray(c.stints) || c.stints.length === 0) e.push('rekam jejak kosong');
  else {
    const cur = c.stints[c.stints.length - 1];
    if (cur.clubId !== league.userClubId || cur.end !== null) e.push('masa jabatan terakhir bukan klub sekarang');
    for (const s of c.stints) {
      if (![s.w, s.d, s.l, s.gf, s.ga].every((n) => Number.isInteger(n) && n >= 0)) e.push(`rekam jejak ${s.clubId}: angka tidak valid`);
      if (!Array.isArray(s.trophies) || !Array.isArray(s.seasons)) e.push(`rekam jejak ${s.clubId}: daftar tidak valid`);
    }
    if (c.stints.slice(0, -1).some((s) => !s.end)) e.push('masa jabatan lama belum ditutup');
  }
  const b = c.board;
  if (!b || !(b.conf >= 0 && b.conf <= 100) || !(Number.isInteger(b.expected) && b.expected >= 1)) e.push('dewan tidak valid');
  const p = c.pending;
  if (p !== null) {
    if (p?.type === 'tawaran') {
      if (!league.clubs.some((x) => x.id === p.clubId) || p.clubId === league.userClubId) e.push('tawaran: klub tidak valid');
    } else if (p?.type === 'dipecat') {
      if (!Array.isArray(p.offers) || p.offers.length === 0 || p.offers.some((id) => id === league.userClubId || !league.clubs.some((x) => x.id === id))) e.push('dipecat: pilihan klub tidak valid');
    } else e.push('event tertunda tidak dikenal');
  }
  if (!Array.isArray(c.diary)) e.push('catatan harian tidak valid');
  if (c.labResults !== undefined && (typeof c.labResults !== 'object' || c.labResults === null || Object.values(c.labResults).some((r) => !(r.completed >= 0 && r.completed <= r.started)))) e.push('hasil uji skema tidak valid');
  if (!Array.isArray(c.tacticDays) || c.tacticDays.length > CAREER.tacticDaysMax || c.tacticDays.some((d) => !WEEKDAYS.includes(d)) || new Set(c.tacticDays).size !== c.tacticDays.length) e.push('hari latihan taktik tidak valid');
  return e;
}

function assertCareer(league) {
  const e = [...leagueErrors(league), ...careerErrors(league)];
  if (e.length) throw new Error(`karier tidak valid: ${e.slice(0, 3).join('; ')}`);
}

// ---------------------------------------------------------------- status hari

// Hari ini hari laga pengguna (laga harus dimainkan sebelum hari bisa maju).
export const isMatchDay = (league) => !seasonOver(league) && Boolean(userFixture(league)) && career(league).day >= roundDate(league.season, league.week);

// Laga pengguna berikutnya yang sudah terjadwal: { index, date, fixture } | null. Babak piala yang
// belum diundi dilewati (belum pasti), jadi ini "paling cepat yang sudah pasti".
export function nextUserMatch(league) {
  for (let i = league.week; i < league.calendar.length; i += 1) {
    const f = league.calendar[i].fixtures?.find((x) => x.home === league.userClubId || x.away === league.userClubId);
    if (f) return { index: i, date: roundDate(league.season, i), fixture: f };
  }
  return null;
}
export const nextUserMatchDate = (league) => nextUserMatch(league)?.date ?? null;

export function dayKind(league, day = career(league).day) {
  if (!seasonOver(league) && userFixture(league) && day === roundDate(league.season, league.week)) return 'laga';
  const last = career(league).lastMatchDay;
  if (last !== null && day === last) return 'laga';
  if (last !== null && day - last === DAY) return 'pemulihan';
  return 'latihan';
}

const pushDiary = (c, entries) => ({ ...c, diary: [...entries.slice().reverse(), ...c.diary].slice(0, CAREER.diaryMax) });

// ---------------------------------------------------------------- laga pengguna selesai

// Pengganti completeWeek untuk babak yang berisi laga pengguna: tutup babak lalu catat karier.
export function closeUserRound(league, userGoals, oppGoals, userTactics = null, report = null) {
  const c0 = career(league);
  if (c0.pending) throw new Error('closeUserRound: masih ada keputusan tertunda');
  if (!isMatchDay(league)) throw new Error('closeUserRound: bukan hari laga');
  const round = currentRound(league);
  const day = roundDate(league.season, league.week);
  const historyBefore = league.history.length;
  let next = completeWeek(league, userGoals, oppGoals, userTactics, report);
  const fx = next.calendar[league.week].fixtures.find((f) => f.home === league.userClubId || f.away === league.userClubId);
  if (!fx?.result) throw new Error('closeUserRound: hasil laga pengguna tidak tercatat');
  const mine = fx.home === league.userClubId ? fx.result.home : fx.result.away;
  const theirs = fx.home === league.userClubId ? fx.result.away : fx.result.home;
  const outcome = mine > theirs ? 'w' : mine < theirs ? 'l' : 'd';
  const R = CAREER.rep;
  const B = CAREER.board;
  let rep = c0.rep + (outcome === 'w' ? R.win : outcome === 'd' ? R.draw : R.loss);
  const stint = { ...currentStint(league), [outcome]: currentStint(league)[outcome] + 1, gf: currentStint(league).gf + mine, ga: currentStint(league).ga + theirs, trophies: [...currentStint(league).trophies] };
  let board = { ...c0.board };
  const opp = fx.home === league.userClubId ? fx.away : fx.home;
  const diary = [{ day, type: 'hasil', comp: round.comp, opp, gf: mine, ga: theirs, pens: fx.result.pens ?? null }];
  // Piala yang dimenangi pengguna di babak ini.
  for (const h of next.history.slice(historyBefore)) {
    if (h.winner !== league.userClubId || h.comp === 'award') continue;
    stint.trophies.push({ season: league.season, comp: h.comp, tier: h.tier });
    rep += h.comp === COMP.elite ? R.eliteTrophy : h.comp === COMP.super ? R.superTrophy : R.trophy;
    board.conf += B.trophy;
    diary.push({ day, type: 'trofi', comp: h.comp });
  }
  if (round.comp === COMP.liga) {
    const table = standings(next);
    const row = table.find((r) => r.id === league.userClubId);
    const pos = table.indexOf(row) + 1;
    const pts = outcome === 'w' ? 3 : outcome === 'd' ? 1 : 0;
    const target = row.p >= B.minGames ? 55 + (board.expected - pos) * B.posStep : 55;
    board.conf += B.pull * (target - board.conf) + (pts - expectedPpg(board.expected)) * B.perPoint;
  } else if (isKnockout(round) && koWinner(fx) !== league.userClubId) {
    board.conf += B.koLoss;
  }
  board.conf = round1(clamp(board.conf, 0, 100));
  let pending = null;
  const games = standings(next).find((r) => r.id === league.userClubId).p;
  if (round.comp === COMP.liga && games >= B.sackMinGames && board.conf < B.sackBelow) {
    rep += R.sacked;
    pending = { type: 'dipecat', offers: sackOffers(next, clamp(rep, 0, 100)) };
    diary.push({ day, type: 'dipecat', clubId: league.userClubId });
  } else if (board.conf < B.warnBelow && !board.warned) {
    board = { ...board, warned: true };
    diary.push({ day, type: 'peringatan', conf: board.conf });
  } else if (board.conf >= B.warnBelow + 10 && board.warned) board = { ...board, warned: false };
  const stints = [...c0.stints.slice(0, -1), stint];
  next = { ...next, career: pushDiary({ ...c0, day, rep: round1(clamp(rep, 0, 100)), stints, board, pending, lastMatchDay: day }, diary) };
  assertCareer(next);
  return next;
}

// ---------------------------------------------------------------- tawaran & pindah klub

function offerCandidates(league, rep) {
  const cur = prestige(league, league.userClubId);
  return league.clubs
    .filter((c) => c.id !== league.userClubId)
    .map((c) => ({ id: c.id, p: prestige(league, c.id) }))
    .filter((x) => x.p > cur && x.p <= rep + CAREER.offerRepSlack);
}

// Setelah dipecat: 1–3 klub yang mau menerima (prestise ≤ reputasi), selalu minimal satu.
export function sackOffers(league, rep) {
  const all = league.clubs.filter((c) => c.id !== league.userClubId).map((c) => ({ id: c.id, p: prestige(league, c.id) }));
  let pool = all.filter((x) => x.p <= rep).sort((a, b) => b.p - a.p || a.id.localeCompare(b.id));
  if (pool.length === 0) pool = all.sort((a, b) => a.p - b.p || a.id.localeCompare(b.id));
  const picks = pool.slice(0, 3).map((x) => x.id);
  if (picks.length === 0) throw new Error('sackOffers: tidak ada klub lain');
  return picks;
}

export function switchClub(league, clubId, why) {
  const c0 = career(league);
  if (!['pindah', 'dipecat'].includes(why)) throw new RangeError(`switchClub: alasan tidak dikenal ${why}`);
  if (clubId === league.userClubId) throw new RangeError('switchClub: sudah melatih klub ini');
  const club = league.clubs.find((c) => c.id === clubId);
  if (!club) throw new RangeError(`switchClub: klub tidak dikenal ${clubId}`);
  const closed = { ...currentStint(league), end: { season: league.season, week: league.week, why } };
  const moved = { ...league, userClubId: clubId };
  const stints = [...c0.stints.slice(0, -1), closed, newStint(moved, clubId, c0.day)];
  const income = round1(Math.max(LEAGUE.tierIncome[club.tier], wageBill(club) + LEAGUE.incomeMargin));
  const news = [{ week: league.week, uid: '', name: club.name, type: 'pindah', weeks: 0, detail: why }, ...league.news].slice(0, LEAGUE.newsMax);
  const next = {
    ...moved,
    profile: { ...league.profile, logo: defaultLogo(club) },
    tactic: { template: 'kustom', fam: {} },
    userTactics: null,
    budget: CAREER.switchBudget[club.tier],
    income,
    news,
    career: pushDiary({ ...c0, stints, board: freshBoard(moved, clubId), pending: null }, [{ day: c0.day, type: 'pindah', clubId, why }]),
  };
  delete next.userFormation;
  assertCareer(next);
  return next;
}

export function answerOffer(league, accept) {
  const p = career(league).pending;
  if (p?.type !== 'tawaran') throw new Error('answerOffer: tidak ada tawaran');
  if (accept) return switchClub(league, p.clubId, 'pindah');
  const next = { ...league, career: pushDiary({ ...league.career, pending: null }, [{ day: league.career.day, type: 'tolak', clubId: p.clubId }]) };
  assertCareer(next);
  return next;
}

export function chooseAfterSack(league, clubId) {
  const p = career(league).pending;
  if (p?.type !== 'dipecat') throw new Error('chooseAfterSack: tidak sedang dipecat');
  if (!p.offers.includes(clubId)) throw new RangeError(`chooseAfterSack: ${clubId} tidak menawarkan`);
  return switchClub(league, clubId, 'dipecat');
}

// ---------------------------------------------------------------- jadwal latihan taktik

// ---------------------------------------------------------------- latihan skema (17 Nov)
//   Uji cepat (scriptLab) gratis tanpa efek. Latihan beranimasi (drill.js) = sesi latihan hari itu:
//   syarat: hari latihan (bukan hari laga / pemulihan), sekali per hari, tidak ada keputusan tertunda
//   efek  : penguasaan skema itu += (3 per ulangan berhasil, 1 per gagal) × kecepatan belajar;
//           kondisi pemain inti −labFitCost
//   league.tactic.mastery { idSkema: 0–100 } (belum ada = MASTERY.default)

export function labBlocker(league) {
  const c = career(league);
  if (c.pending) return 'keputusan';
  if (seasonOver(league)) return 'musim';
  const kind = dayKind(league);
  if (kind === 'laga') return 'hariLaga';
  if (kind === 'pemulihan') return 'pemulihan';
  if (c.labDay === c.day) return 'sudah';
  return null;
}

export const masteryOf = (league, scriptId) => league.tactic.mastery?.[scriptId] ?? MASTERY.default;

export function drillSession(league, { scriptId, name, results }) {
  const why = labBlocker(league);
  if (why) throw new Error(`drillSession: tidak bisa latihan hari ini (${why})`);
  if (typeof scriptId !== 'string' || !scriptId) throw new TypeError('drillSession: id skema wajib');
  if (typeof name !== 'string' || !name) throw new TypeError('drillSession: nama skema wajib');
  if (!Array.isArray(results) || results.length === 0) throw new RangeError('drillSession: belum ada ulangan');
  const c = career(league);
  const starters = starterPlayers(league);
  const xi = new Set(starters.map((p) => p.uid));
  const cur = masteryOf(league, scriptId);
  const val = round1(Math.min(100, cur + drillGain(results) * learnRate(starters)));
  const ok = results.filter((r) => r.ok).length;
  const clubs = league.clubs.map((cl) => (cl.id !== league.userClubId ? cl : { ...cl, players: cl.players.map((p) => (xi.has(p.uid) ? { ...p, fit: Math.max(20, (p.fit ?? 100) - CAREER.labFitCost) } : p)) }));
  const mastery = { ...(league.tactic.mastery ?? {}), [scriptId]: val };
  const keys = Object.keys(mastery);
  while (keys.length > CAREER.masteryMax) delete mastery[keys.shift()];
  const next = {
    ...league,
    clubs,
    tactic: { ...league.tactic, mastery },
    career: pushDiary({ ...c, labDay: c.day }, [{ day: c.day, type: 'latihanSkema', name, ok, reps: results.length, gain: round1(val - cur), mastery: val }]),
  };
  assertCareer(next);
  return next;
}

// Hasil uji disimpan per isi skema (scriptLab.scriptKey); uji ulang menambah data.
export function saveLabResult(league, key, entry) {
  if (typeof key !== 'string' || !key) throw new TypeError('saveLabResult: kunci wajib');
  if (!entry || !Array.isArray(entry.rows) || !(entry.started >= 0) || !(entry.completed >= 0) || entry.completed > entry.started) throw new RangeError('saveLabResult: hasil tidak valid');
  const c = career(league);
  const all = { ...(c.labResults ?? {}) };
  delete all[key];
  const keys = Object.keys(all);
  while (keys.length >= CAREER.labResultsMax) delete all[keys.shift()];
  const next = { ...league, career: { ...c, labResults: { ...all, [key]: entry } } };
  assertCareer(next);
  return next;
}

export function setTacticDays(league, days) {
  if (!Array.isArray(days)) throw new TypeError('setTacticDays: harus daftar');
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  if (uniq.length > CAREER.tacticDaysMax || uniq.some((d) => !WEEKDAYS.includes(d))) throw new RangeError(`setTacticDays: maksimal ${CAREER.tacticDaysMax} hari 0–6`);
  const next = { ...league, career: { ...career(league), tacticDays: uniq } };
  assertCareer(next);
  return next;
}

// Hasil sesi taktik: makin cerdas pemain inti, makin sering "bagus".
export function sessionOdds(starters) {
  const iq = starters.length ? starters.reduce((a, p) => a + iqOf(p), 0) / starters.length : 0.5; // 0–1
  const good = clamp(0.15 + (iq - 0.4) * 0.8, 0.05, 0.6);
  const bad = clamp(0.3 - (iq - 0.4) * 0.6, 0.05, 0.4);
  return { bagus: round1(good * 100) / 100, buruk: round1(bad * 100) / 100, biasa: round1((1 - good - bad) * 100) / 100 };
}

// ---------------------------------------------------------------- maju satu hari

const dayRng = (league, day) => createRng(((league.rngState ?? 1) + Math.floor(day / DAY) * 7919) % 1000000007);

// → { league, events, stop } — stop = alasan berhenti otomatis (event penting / hari laga / akhir musim) atau null.
export function advanceDay(league) {
  const c0 = career(league);
  if (c0.pending) throw new Error('advanceDay: selesaikan keputusan tertunda dulu');
  if (seasonOver(league)) throw new Error('advanceDay: musim sudah selesai');
  if (isMatchDay(league)) throw new Error('advanceDay: hari laga — mainkan laganya dulu');
  const day = c0.day + DAY;
  let l = { ...league, career: { ...c0, day } };
  // Babak tanpa pengguna yang tanggalnya sudah tiba: hitung cepat (hari tetap).
  for (let guard = 0; guard < 80 && !seasonOver(l) && !userFixture(l) && roundDate(l.season, l.week) <= day; guard += 1) l = completeWeek(l, 0, 0);
  if (seasonOver(l)) {
    const next = { ...l, career: pushDiary(l.career, [{ day, type: 'akhirMusim' }]) };
    assertCareer(next);
    return { league: next, events: [], stop: 'akhirMusim' };
  }
  const kind = dayKind(l, day);
  const rng = dayRng(l, day);
  const events = [];
  const user = clubById(l, l.userClubId);
  let players = user.players;
  const news = [];
  // Absen harian: sakit & izin tiap hari, cedera latihan hanya hari latihan.
  if (kind !== 'laga') {
    players = players.map((p) => {
      if (p.absence) return p;
      const r = rng.next();
      let out = null;
      const inj = CAREER.trainingInjury * INTENSITY_INJURY[l.training.intensity];
      if (r < CAREER.illness) out = ['sakit', rng.int(LEAGUE.absence.illnessWeeks[0], LEAGUE.absence.illnessWeeks[1]), null];
      else if (r < CAREER.illness + CAREER.personal) out = ['izin', 1, null];
      else if (kind === 'latihan' && r < CAREER.illness + CAREER.personal + inj) {
        const sev = rollSeverity(rng);
        out = ['cedera', injuryWeeks(sev, rng), `latihan-${sev}`];
      }
      if (!out) return p;
      const q = withAbsence(p, out[0], out[1], out[2]);
      events.push({ day, type: out[0], uid: p.uid, name: p.fullName, weeks: out[1], detail: out[2] });
      news.push({ week: l.week, uid: p.uid, name: p.fullName, type: out[0], weeks: out[1], detail: out[2] });
      return q;
    });
  }
  let tactic = l.tactic;
  // Sesi latihan taktik terjadwal.
  if (kind === 'latihan' && c0.tacticDays.includes(weekday(day))) {
    const starters = starterPlayers({ ...l, clubs: l.clubs.map((c) => (c.id === user.id ? { ...c, players } : c)) });
    const odds = sessionOdds(starters);
    const r = rng.next();
    const result = r < odds.bagus ? 'bagus' : r < odds.bagus + odds.buruk ? 'buruk' : 'biasa';
    const key = tactic.template;
    const cur = tactic.fam?.[key] ?? FAMILIARITY.base;
    const gain = round1(CAREER.session[result] * learnRate(starters));
    const val = round1(Math.min(100, cur + gain));
    if (!(key === 'kustom' || TEMPLATE_KEYS.includes(key))) throw new Error(`sesi taktik: template ${key}`);
    tactic = { ...tactic, fam: { ...tactic.fam, [key]: val } };
    events.push({ day, type: 'sesiTaktik', result, template: key, gain: round1(val - cur), fam: val });
  } else if (kind === 'pemulihan' && c0.tacticDays.includes(weekday(day))) {
    events.push({ day, type: 'sesiBatal' });
  }
  // Tawaran klub lain.
  let pending = null;
  const settled = day - currentStint(l).start.day >= CAREER.offerSettleDays * DAY;
  const cooled = c0.lastOfferDay == null || day - c0.lastOfferDay >= CAREER.offerCooldownDays * DAY;
  if (kind !== 'laga' && settled && cooled && rng.chance(CAREER.offerPerDay)) {
    const cands = offerCandidates(l, c0.rep);
    if (cands.length) {
      const pick = rng.pick(cands);
      pending = { type: 'tawaran', clubId: pick.id };
      events.push({ day, type: 'tawaran', clubId: pick.id });
    }
  }
  if (kind === 'laga') events.push({ day, type: 'hariLaga' });
  const clubs = l.clubs.map((c) => (c.id === user.id ? { ...c, players } : c));
  const next = {
    ...l,
    clubs,
    tactic,
    news: [...news, ...l.news].slice(0, LEAGUE.newsMax),
    career: pushDiary({ ...l.career, pending, lastOfferDay: pending ? day : (l.career.lastOfferDay ?? null) }, events.filter((e) => e.type !== 'hariLaga')),
  };
  assertCareer(next);
  const stop = events.find((e) => STOP_EVENTS.includes(e.type))?.type ?? (kind === 'laga' ? 'hariLaga' : null);
  return { league: next, events, stop };
}

// Maju terus sampai berhenti (untuk uji & tombol "lompat"). maxDays sebagai pengaman.
export function advanceUntilStop(league, maxDays = 60) {
  let l = league;
  const all = [];
  for (let i = 0; i < maxDays; i += 1) {
    const r = advanceDay(l);
    l = r.league;
    all.push(...r.events);
    if (r.stop) return { league: l, events: all, stop: r.stop };
  }
  return { league: l, events: all, stop: null };
}

// ---------------------------------------------------------------- akhir musim

export function startSeason(league) {
  const c0 = career(league);
  if (c0.pending) throw new Error('startSeason: masih ada keputusan tertunda');
  if (!seasonOver(league)) throw new Error('startSeason: musim belum selesai');
  const user = clubById(league, league.userClubId);
  const tierOld = user.tier;
  const table = standings(league, tierOld);
  const pos = table.findIndex((r) => r.id === league.userClubId) + 1;
  const R = CAREER.rep;
  const B = CAREER.board;
  let rep = c0.rep + (c0.board.expected - pos) * 0.5;
  const stint = { ...currentStint(league), seasons: [...currentStint(league).seasons, { season: league.season, tier: tierOld, pos }], trophies: [...currentStint(league).trophies] };
  const diary = [];
  if (pos === 1) {
    stint.trophies.push({ season: league.season, comp: COMP.liga, tier: tierOld });
    rep += tierOld === 1 ? R.topTitle : R.title;
    diary.push({ type: 'trofi', comp: COMP.liga, tier: tierOld });
  }
  let next = newSeason(league);
  const tierNew = clubById(next, next.userClubId).tier;
  if (tierNew < tierOld) {
    rep += R.promotion;
    diary.push({ type: 'naik', tier: tierNew });
  } else if (tierNew > tierOld) {
    rep += R.relegation;
    diary.push({ type: 'turun', tier: tierNew });
  }
  const conf = B.carry * c0.board.conf + B.carryBase + (c0.board.expected - pos) * 1.5;
  // Degradasi padahal tidak diperkirakan turun, dan dewan sudah ragu → dipecat di akhir musim.
  const sackedAtEnd = tierNew > tierOld && c0.board.expected <= 14 && c0.board.conf < B.relegationSackBelow;
  if (sackedAtEnd) {
    rep += R.sacked;
    diary.push({ type: 'dipecat', clubId: league.userClubId });
  }
  const day = dayOf(roundDate(next.season, 0) - CAREER.preseasonDays * DAY);
  const stints = [...c0.stints.slice(0, -1), stint];
  const repFinal = round1(clamp(rep, 0, 100));
  const pending = sackedAtEnd ? { type: 'dipecat', offers: sackOffers(next, repFinal) } : null;
  next = { ...next, career: pushDiary({ ...c0, day, rep: repFinal, stints, pending, lastMatchDay: null, board: freshBoard(next, next.userClubId, conf) }, diary.map((d) => ({ ...d, day }))) };
  assertCareer(next);
  return next;
}

// ---------------------------------------------------------------- ringkasan untuk profil

export function careerSummary(league) {
  const c = career(league);
  const sum = (k) => c.stints.reduce((a, s) => a + s[k], 0);
  const games = sum('w') + sum('d') + sum('l');
  return {
    rep: c.rep,
    games,
    w: sum('w'),
    d: sum('d'),
    l: sum('l'),
    winPct: games ? Math.round((sum('w') / games) * 100) : 0,
    trophies: c.stints.flatMap((s) => s.trophies.map((t) => ({ ...t, club: s.name }))),
    sacked: c.stints.filter((s) => s.end?.why === 'dipecat').length,
    clubs: c.stints.length,
  };
}

export { TIERS, DEV };
