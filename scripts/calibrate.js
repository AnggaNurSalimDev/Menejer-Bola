// Alat ukur kalibrasi: menjalankan banyak pertandingan dan melaporkan
// rata-rata beserta ketidakpastiannya (±2 × galat baku ≈ rentang 95%).
// Jalankan: npm run calibrate            (64 laga per skenario)
//           npm run calibrate -- 128     (jumlah laga lain)
//
// Pakai ini sebelum memutuskan menyetel angka: 16 laga terlalu sedikit,
// selisih kecil bisa hanya kebetulan.

import { createDemoTeams } from '../src/engine/teams.js';
import { createSimulation } from '../src/engine/simulation.js';

const N = Number(process.argv[2] ?? 64);
if (!Number.isInteger(N) || N < 4) throw new RangeError(`jumlah laga tidak valid: ${process.argv[2]}`);

function play(seed, homeQuality, awayQuality) {
  const teams = createDemoTeams(2026, { homeQuality, awayQuality });
  const sim = createSimulation(teams.home, teams.away, seed);
  let s = sim.getState();
  while (s.period === 'first') s = sim.step();
  s = sim.startSecondHalf();
  while (s.period === 'second') s = sim.step();
  return s.stats;
}

function meanAndBand(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  return { mean, band: 2 * Math.sqrt(variance / n) };
}

const fmt = ({ mean, band }) => `${mean.toFixed(2)} ± ${band.toFixed(2)}`;

// Titik nol: dua tim rata-rata.
{
  const goals = [];
  const shots = [];
  let goalless = 0;
  for (let seed = 1; seed <= N; seed += 1) {
    const st = play(seed, 12, 12);
    goals.push(st.goals.home + st.goals.away);
    if (st.goals.home + st.goals.away === 0) goalless += 1;
    shots.push((st.shots.home.total + st.shots.away.total) / 2);
  }
  console.log(
    `Titik nol (${N} laga): gol/laga ${fmt(meanAndBand(goals))} [target 2,4–3,0], 0–0 ${((goalless / N) * 100).toFixed(0)}% [target ≤ 10%], tembakan/tim ${fmt(meanAndBand(shots))}`,
  );
}

// Dinamika: tim lebih bagus vs tim lebih buruk, bergantian kandang.
//   15 vs 9  : beda kelas (papan atas vs divisi bawah) — tim kuat wajar menang hampir selalu
//   13 vs 11 : satu liga (papan atas vs papan bawah) — kejutan harus masih sering terjadi
for (const [strongQ, weakQ] of [
  [15, 9],
  [13, 11],
]) {
  const strong = [];
  const weak = [];
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= N; seed += 1) {
    const strongIsHome = seed % 2 === 0;
    const st = play(seed, strongIsHome ? strongQ : weakQ, strongIsHome ? weakQ : strongQ);
    const s = st.goals[strongIsHome ? 'home' : 'away'];
    const w = st.goals[strongIsHome ? 'away' : 'home'];
    strong.push(s);
    weak.push(w);
    if (s > w) wins += 1;
    if (w > s) losses += 1;
  }
  console.log(
    `${strongQ} vs ${weakQ} (${N} laga): gol ${fmt(meanAndBand(strong))} vs ${fmt(meanAndBand(weak))}, ` +
      `menang ${((wins / N) * 100).toFixed(0)}%, kalah ${((losses / N) * 100).toFixed(0)}%`,
  );
}
