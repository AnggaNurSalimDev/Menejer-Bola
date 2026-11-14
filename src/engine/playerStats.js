// Statistik per pemain dalam satu laga & rating 1–10 (15 Nov, permintaan pengguna: top skor, assist,
// rating per laga, penghargaan akhir musim).
//
//   peristiwa engine (note) ──▶ pstats[id] { goals, assists, shots, passOk, passBad, tackles,
//                                             saves, conceded, heavy, lost }
//   akhir laga: matchRatings(state) ──▶ { id: { rating, goals, assists, minutes, teamId, role } }
//
// Rating sengaja sederhana & bisa dijelaskan (bukan model statistik): 6,0 + kontribusi − kesalahan
// + hasil tim, dijepit 3,0–10,0. Pemain < 10 menit tidak dinilai.

export const ASSIST_TICKS = 80; // operan terakhir ≤ 8 dtk sebelum gol dihitung assist

const EVENT_KEY = {
  goal: 'goals',
  assist: 'assists',
  shot: 'shots',
  passCompleted: 'passOk',
  passIntercepted: 'passBad',
  tackleWon: 'tackles',
  save: 'saves',
  conceded: 'conceded',
  heavyTouch: 'heavy',
  dispossessed: 'lost',
};

export const emptyPlayerStat = () => ({ goals: 0, assists: 0, shots: 0, passOk: 0, passBad: 0, tackles: 0, saves: 0, conceded: 0, heavy: 0, lost: 0 });

export function bumpPlayerStat(stat, event) {
  const key = EVENT_KEY[event];
  if (!key) return stat ?? emptyPlayerStat();
  const s = stat ?? emptyPlayerStat();
  return { ...s, [key]: s[key] + 1 };
}

const MIN_MINUTES = 10;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isDef = (role) => ['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(role);

export function ratingOf(s, { role, minutes, teamGoals, oppGoals }) {
  if (!s) throw new TypeError('ratingOf: statistik wajib ada');
  if (!(minutes >= 0)) throw new RangeError(`ratingOf: menit tidak valid ${minutes}`);
  let r = 6.0;
  r += 1.0 * s.goals + 0.6 * s.assists + 0.05 * s.shots;
  r += 0.03 * s.passOk - 0.06 * s.passBad;
  r += 0.15 * s.tackles - 0.08 * s.lost - 0.1 * s.heavy;
  if (role === 'GK') r += 0.35 * s.saves - 0.35 * s.conceded;
  const clean = oppGoals === 0 && minutes >= 60;
  if (clean && role === 'GK') r += 0.6;
  if (clean && isDef(role)) r += 0.3;
  r += teamGoals > oppGoals ? 0.3 : teamGoals < oppGoals ? -0.3 : 0;
  return Math.round(clamp(r, 3, 10) * 10) / 10;
}

// Rating & ringkasan semua pemain yang turun di laga (state akhir engine).
export function matchRatings(state) {
  const total = Math.max(1, state.tick);
  const goals = state.stats.goals;
  const out = {};
  const add = (p, from, to) => {
    if (out[p.id]) return;
    const minutes = Math.round((90 * Math.max(0, to - from)) / total);
    if (minutes < MIN_MINUTES) return;
    const s = state.pstats?.[p.id] ?? emptyPlayerStat();
    const teamGoals = goals[p.teamId];
    const oppGoals = Object.entries(goals).find(([id]) => id !== p.teamId)?.[1] ?? 0;
    out[p.id] = { teamId: p.teamId, role: p.role, minutes, goals: s.goals, assists: s.assists, rating: ratingOf(s, { role: p.role, minutes, teamGoals, oppGoals }), energy: p.condition?.energy ?? null };
  };
  for (const p of state.players) add(p, p.subbedOn ?? 0, state.tick);
  for (const p of state.subbedOff ?? []) add(p, p.subbedOn ?? 0, p.tick);
  for (const p of state.sentOff ?? []) add(p, p.subbedOn ?? 0, p.tick);
  return out;
}

// Pemain terbaik laga (rating tertinggi; seri → gol, lalu id).
export function manOfTheMatch(ratings) {
  const list = Object.entries(ratings);
  if (list.length === 0) return null;
  list.sort(([ia, a], [ib, b]) => b.rating - a.rating || b.goals - a.goals || ia.localeCompare(ib));
  return list[0][0];
}
