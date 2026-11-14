// Kalender musim & kompetisi (15 Nov, keputusan pengguna: 3 kasta, Piala Nasional, Piala Liga,
// Piala Super, Kejuaraan Elite; naik-turun kasta seperti Inggris).
//
//   musim = 62 babak berurutan (satu babak = satu "pekan" untuk absen, gaji, bursa):
//     Super ─ L1 L2 [PL-R1] L3 [E-G1] L4 L5 [PL-R2] L6 [E-G2] L7 [PN-R64] … L38 [PN-F] [PO-SF] [PO-F]
//   liga   : 3 kasta × 20 klub, kandang-tandang (38 babak), semua kasta main di babak yang sama
//   PN     : Piala Nasional, 60 klub liga + 4 amatir = 64 → gugur 6 babak
//   PL     : Piala Liga, 56 klub (tanpa 4 peserta Elite) → 28 + 4 Elite = 32 → gugur
//   E      : Kejuaraan Elite, 4 teratas Liga 1 + 12 klub luar negeri, 4 grup × 4 (6 laga), lalu 8 besar
//   Super  : juara Liga 1 vs juara Piala Nasional musim lalu (satu laga)
//   PO     : play-off promosi Liga 2 & Liga 3: peringkat 3 v 6, 4 v 5, lalu final
//
// Modul murni: semua undian lewat rng yang diberikan pemanggil. Babak gugur diundi saat babak itu
// tiba (pemenang babak sebelumnya baru diketahui saat itu).

export const COMP = Object.freeze({ liga: 'liga', nasional: 'nasional', ligaCup: 'ligaCup', super: 'super', elite: 'elite', playoff: 'playoff' });
export const COMP_KEYS = Object.freeze(Object.values(COMP));
export const LEAGUE_ROUNDS = 38;

const KO_NASIONAL = ['R64', 'R32', 'R16', 'QF', 'SF', 'F'];
const KO_LIGACUP = ['R1', 'R2', 'R16', 'QF', 'SF', 'F'];
const ELITE = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'QF', 'SF', 'F'];

// Setelah babak liga ke-n (1–38), sisipkan babak piala berikut.
const AFTER_LEAGUE = {
  2: [[COMP.ligaCup, 'R1']],
  3: [[COMP.elite, 'G1']],
  5: [[COMP.ligaCup, 'R2']],
  6: [[COMP.elite, 'G2']],
  7: [[COMP.nasional, 'R64']],
  9: [[COMP.ligaCup, 'R16']],
  10: [[COMP.elite, 'G3']],
  12: [[COMP.nasional, 'R32']],
  13: [[COMP.elite, 'G4']],
  14: [[COMP.ligaCup, 'QF']],
  16: [[COMP.elite, 'G5']],
  17: [[COMP.nasional, 'R16']],
  19: [[COMP.ligaCup, 'SF']],
  20: [[COMP.elite, 'G6']],
  22: [[COMP.nasional, 'QF']],
  24: [[COMP.ligaCup, 'F']],
  26: [[COMP.elite, 'QF']],
  28: [[COMP.nasional, 'SF']],
  31: [[COMP.elite, 'SF']],
  35: [[COMP.elite, 'F']],
  38: [[COMP.nasional, 'F'], [COMP.playoff, 'SF'], [COMP.playoff, 'F']],
};

export function seasonSkeleton() {
  const out = [{ comp: COMP.super, stage: 'F' }];
  for (let n = 1; n <= LEAGUE_ROUNDS; n += 1) {
    out.push({ comp: COMP.liga, stage: `L${n}` });
    for (const [comp, stage] of AFTER_LEAGUE[n] ?? []) out.push({ comp, stage });
  }
  return out;
}

export const SKELETON_LENGTH = seasonSkeleton().length; // 62
export const stagesOf = (comp) => ({ nasional: KO_NASIONAL, ligaCup: KO_LIGACUP, elite: ELITE, super: ['F'], playoff: ['SF', 'F'] })[comp] ?? [];

export function shuffle(ids, rng) {
  const list = [...ids];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Undian gugur: pasangan acak, yang terundi pertama jadi tuan rumah.
export function drawPairs(ids, rng, extra = {}) {
  if (ids.length % 2 !== 0 || ids.length === 0) throw new RangeError(`drawPairs: jumlah peserta ${ids.length} harus genap`);
  if (new Set(ids).size !== ids.length) throw new RangeError('drawPairs: peserta ganda');
  const list = shuffle(ids, rng);
  const out = [];
  for (let i = 0; i < list.length; i += 2) out.push({ home: list[i], away: list[i + 1], result: null, ...extra });
  return out;
}

// Pemenang laga gugur (skor, lalu adu penalti).
export function koWinner(f) {
  if (!f.result) return null;
  const { home, away, pens } = f.result;
  if (home !== away) return home > away ? f.home : f.away;
  if (!pens || pens.home === pens.away) throw new Error(`koWinner: laga gugur ${f.home}–${f.away} seri tanpa adu penalti`);
  return pens.home > pens.away ? f.home : f.away;
}

export const koLoser = (f) => {
  const w = koWinner(f);
  return w === null ? null : w === f.home ? f.away : f.home;
};

// Adu penalti: 5 tendangan bergantian, lalu sudden death. strengthDiff = kekuatan tuan rumah − tamu.
export function shootout(rng, strengthDiff = 0) {
  const pHome = Math.min(0.9, Math.max(0.6, 0.75 + 0.015 * strengthDiff));
  const pAway = Math.min(0.9, Math.max(0.6, 0.75 - 0.015 * strengthDiff));
  let h = 0;
  let a = 0;
  // 5 tendangan per tim, dihentikan begitu satu tim tidak mungkin terkejar (seperti aturan nyata).
  for (let k = 0; k < 5; k += 1) {
    if (rng.chance(pHome)) h += 1;
    if (h > a + (5 - k) || a > h + (4 - k)) break;
    if (rng.chance(pAway)) a += 1;
    if (h > a + (4 - k) || a > h + (4 - k)) break;
  }
  for (let guard = 0; h === a && guard < 30; guard += 1) {
    const sh = rng.chance(pHome);
    const sa = rng.chance(pAway);
    h += sh ? 1 : 0;
    a += sa ? 1 : 0;
  }
  if (h === a) h += 1; // tidak terjadi dalam praktik; jaga invariant "selalu ada pemenang"
  return { home: h, away: a };
}

// Klasemen dari daftar laga (liga atau grup).
export function tableOf(fixtures, ids, nameOf = (id) => id) {
  const rows = new Map(ids.map((id) => [id, { id, name: nameOf(id), p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] }]));
  for (const f of fixtures) {
    if (!f.result) continue;
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    if (!h || !a) continue;
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
    .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || String(x.name).localeCompare(String(y.name)));
}

// Grup Elite: 4 klub liga disebar satu per grup, 12 klub luar negeri diacak ke sisa tempat.
export function eliteGroups(leagueIds, foreignIds, rng) {
  if (leagueIds.length !== 4 || foreignIds.length !== 12) throw new RangeError('eliteGroups: butuh 4 klub liga + 12 klub luar');
  const pot1 = shuffle(leagueIds, rng);
  const rest = shuffle(foreignIds, rng);
  return [0, 1, 2, 3].map((g) => [pot1[g], ...rest.slice(g * 3, g * 3 + 3)]);
}

// 6 matchday untuk grup 4 klub (kandang-tandang): [[laga…] × 6].
export function groupMatchdays(group, gi) {
  const [a, b, c, d] = group;
  const half = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
  const mk = (pairs, flip) => pairs.map(([x, y]) => ({ home: flip ? y : x, away: flip ? x : y, result: null, group: gi }));
  return [...half.map((p) => mk(p, false)), ...half.map((p) => mk(p, true))];
}

// ---------------------------------------------------------------- tanggal (14 Nov malam)
// Tanggal tiap babak, dihitung (tidak disimpan) dari musim & urutan kalender, pola Inggris:
//   Piala Super  Minggu pertama Agustus
//   Liga  Sabtu · Piala Liga  Selasa · Elite, Piala Nasional & semifinal play-off  Rabu · final piala nasional & play-off  Sabtu
// Tiap babak jatuh pada hari target berikutnya, minimal 2 hari setelah babak sebelumnya.
// Musim 1 dimulai Agustus 2026 (karangan, tidak mengikuti kalender nyata).
const WEEKDAY = { super: 0, liga: 6, nasional: 3, ligaCup: 2, elite: 3 };
const playoffDay = (stage) => (stage === 'F' ? 6 : 3);
const DAY = 86400000;
const dateCache = new Map();

export function seasonYear(season) {
  if (!(Number.isInteger(season) && season >= 1)) throw new RangeError(`seasonYear: musim tidak valid ${season}`);
  return 2025 + season;
}

export function roundDates(season) {
  if (dateCache.has(season)) return dateCache.get(season);
  const year = seasonYear(season);
  const firstAug = Date.UTC(year, 7, 1);
  const firstSunday = firstAug + (((7 - new Date(firstAug).getUTCDay()) % 7) * DAY);
  let cursor = firstSunday - 2 * DAY; // supaya Piala Super jatuh tepat di Minggu pertama
  const out = seasonSkeleton().map(({ comp, stage }) => {
    const target = comp === COMP.playoff ? playoffDay(stage) : comp === COMP.nasional && stage === 'F' ? 6 : WEEKDAY[comp];
    let d = cursor + 2 * DAY;
    while (new Date(d).getUTCDay() !== target) d += DAY;
    cursor = d;
    return d;
  });
  dateCache.set(season, Object.freeze(out));
  return dateCache.get(season);
}

// Tanggal (ms UTC) babak ke-i musim tertentu; i di luar kalender → null.
export function roundDate(season, index) {
  const list = roundDates(season);
  return index >= 0 && index < list.length ? list[index] : null;
}
