// Cedera saat laga (14 Nov, permintaan pengguna).
//
//   tiap tick, tiap pemain lapangan sehat ──peluang kecil (naik bila lelah)──▶ player.injury
//        player.injury = { tick, severity: 'ringan'|'sedang'|'berat' }
//   pemain cedera: pincang (laju & percepatan × INJURY.limpScale)
//   bola mati berikutnya:
//        diantrikan keluar ──────────────────────▶ diganti (juga di babak 1)
//        tim AI, atau pengguna diam > grace ─────▶ diganti otomatis (lini sama; kiper → kiper)
//        tidak ada jatah/cadangan yang sah ──────▶ keluar tanpa pengganti (main 10 orang)
//   akhir laga: daftar cedera dibawa ke liga (lama absen diundi dari severity).
//
// Undian cedera memakai RNG TERPISAH dari RNG laga, supaya urutan acak laga (dan uji ber-seed)
// tidak bergeser hanya karena ada undian tambahan.

export const INJURY = Object.freeze({
  // ±0,35 cedera yang memaksa pergantian per laga (dua tim) — kira-kira angka sepak bola nyata.
  // 22 pemain × 6000 tick ≈ 132 ribu pemain-tick; pengali lelah rata-rata ±1,3.
  basePerTick: 2.0e-6,
  fatigueBoost: 1.5, // peluang × (1 + 1,5 × (1 − tenaga))
  limpScale: 0.6,
  userGraceTicks: 200, // 20 dtk nyata: waktu bagi pengguna memilih pengganti sendiri
  severities: Object.freeze([
    { key: 'ringan', weight: 0.6, weeks: [1, 2] },
    { key: 'sedang', weight: 0.3, weeks: [3, 5] },
    { key: 'berat', weight: 0.1, weeks: [6, 10] },
  ]),
});

export const SEVERITY_KEYS = Object.freeze(INJURY.severities.map((s) => s.key));

export function injuryChance(player, scale = 1) {
  if (!player?.condition) throw new TypeError('injuryChance: pemain tanpa kondisi');
  if (player.injury) return 0;
  const energy = Math.min(1, Math.max(0, player.condition.energy));
  return INJURY.basePerTick * scale * (1 + INJURY.fatigueBoost * (1 - energy));
}

export function rollSeverity(rng) {
  let r = rng.next();
  for (const s of INJURY.severities) {
    if (r < s.weight) return s.key;
    r -= s.weight;
  }
  return INJURY.severities[INJURY.severities.length - 1].key;
}

// Lama absen (pekan) untuk satu severity.
export function injuryWeeks(severity, rng) {
  const s = INJURY.severities.find((x) => x.key === severity);
  if (!s) throw new RangeError(`injuryWeeks: severity tidak dikenal ${severity}`);
  return rng.int(s.weeks[0], s.weeks[1]);
}

// Semua pemain yang cedera di laga ini (masih bermain, sudah diganti, atau keluar tanpa pengganti).
export function matchInjuries(state) {
  const all = [...state.players, ...(state.subbedOff ?? []), ...(state.sentOff ?? [])];
  const seen = new Set();
  const out = [];
  for (const p of all) {
    if (!p.injury || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, teamId: p.teamId, tick: p.injury.tick, severity: p.injury.severity });
  }
  return out.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
}
