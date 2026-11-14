import { LEAGUE, clubById, overall, playerValue, roleGroup } from './league.js';
import { getFormation } from './formations.js';
import { getStyle } from './clubStyles.js';
import { TECHNICAL_STATS, GOALKEEPER_STATS } from './stats.js';

// Tampilan bursa (14 Nov): fungsi murni di atas data liga — tidak mengubah liga, hanya menyusun
// baris untuk tab "Skuad & bursa". Jual-beli tetap lewat buyPlayer/sellPlayer di league.js.
//
//   liga ──▶ starterTerlemah per kelompok (GK/DF/MF/FW, dari slot formasi)
//        └─▶ bursa.players ──filter kelompok──▶ baris {pemain, nilai, harga, selisih, alasan} ──urut──▶ UI

export const MARKET_GROUPS = Object.freeze(['semua', 'GK', 'DF', 'MF', 'FW']);
export const MARKET_SORTS = Object.freeze(['nilai', 'harga', 'selisih']);
export const BLOCK = Object.freeze({ locked: 'terkunci', full: 'penuh', budget: 'anggaran' });

// Nilai pemain inti terlemah per kelompok posisi (berdasarkan peran SLOT, bukan posisi asli).
export function weakestStarters(league) {
  const user = clubById(league, league.userClubId);
  const slots = getFormation(getStyle(user.style).formation);
  const byUid = new Map(user.players.map((p) => [p.uid, p]));
  const out = {};
  for (const s of slots) {
    const p = byUid.get(user.lineup[s.number]);
    if (!p) throw new Error(`weakestStarters: slot ${s.number} tanpa pemain`);
    const g = roleGroup(s.role);
    const v = overall(p);
    if (out[g] === undefined || v < out[g]) out[g] = v;
  }
  return out;
}

// Jumlah pemain skuad per kelompok posisi asli.
export function squadCounts(league) {
  const user = clubById(league, league.userClubId);
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 };
  for (const p of user.players) counts[roleGroup(p.role)] += 1;
  return counts;
}

export function marketRows(league, { group = 'semua', sort = 'nilai', locked = false } = {}) {
  if (!league?.market?.players) throw new TypeError('marketRows: liga tanpa bursa');
  if (!MARKET_GROUPS.includes(group)) throw new RangeError(`marketRows: kelompok tidak dikenal ${group}`);
  if (!MARKET_SORTS.includes(sort)) throw new RangeError(`marketRows: urutan tidak dikenal ${sort}`);
  const user = clubById(league, league.userClubId);
  const weakest = weakestStarters(league);
  const full = user.players.length >= LEAGUE.squadMax;
  const rows = league.market.players
    .filter((p) => group === 'semua' || roleGroup(p.role) === group)
    .map((p) => {
      const rating = overall(p);
      const price = playerValue(p);
      const g = roleGroup(p.role);
      const delta = weakest[g] === undefined ? null : rating - weakest[g];
      const block = locked ? BLOCK.locked : full ? BLOCK.full : price > league.budget ? BLOCK.budget : null;
      return { player: p, group: g, rating, price, delta, block };
    });
  const key = { nilai: (r) => -r.rating, harga: (r) => r.price, selisih: (r) => -(r.delta ?? -99) }[sort];
  return rows.sort((a, b) => key(a) - key(b) || a.player.uid.localeCompare(b.player.uid));
}

// n stat tertinggi yang relevan (kiper: stat kiper; lainnya: stat teknik tanpa kecerobohan).
export function strengths(player, n = 3) {
  if (!player?.stats) throw new TypeError('strengths: pemain tanpa stat');
  const keys = player.role === 'GK' ? [...GOALKEEPER_STATS, 'posisi', 'antisipasi'] : TECHNICAL_STATS.filter((k) => k !== 'kecerobohan');
  return keys
    .filter((k) => Number.isFinite(player.stats[k]))
    .map((k) => [k, player.stats[k]])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}
