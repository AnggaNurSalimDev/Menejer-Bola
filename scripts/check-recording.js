// Uji log kejadian rekaman (17 Nov). Jalankan: node scripts/check-recording.js
//   1. logger tidak mengubah laga (sidik jari state akhir sama, rekam aktif/tidak)
//   2. seed sama → daftar kejadian sama
//   3. guard: monoton, batas ukuran, field null, tidak mencatat sebelum kick-off, SRT valid, blunder fatal
import { createHash } from 'node:crypto';
import { createDemoTeams } from '../src/engine/teams.js';
import { createSimulation } from '../src/engine/simulation.js';
import { diffMatch, createPicker } from '../src/audio/commentary.js';
import { createEventLog, deriveEvents, logFileName, JENIS } from '../src/recording/eventLog.js';

let failed = 0;
const check = (name, errs) => {
  if (errs.length) {
    failed += 1;
    console.log(`  GAGAL ${name}\n        ${errs.slice(0, 5).join('\n        ')}`);
  } else console.log(`  OK    ${name}`);
};
const tr = (x, v) => x.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? ''));

function play(seed, { record }) {
  const t = createDemoTeams(seed);
  const sim = createSimulation(t.home, t.away, seed, {});
  const names = new Map([...t.home.players, ...t.away.players].map((p) => [p.id, p.shortName]));
  const log = createEventLog();
  const memo = {};
  const cmemo = {};
  const pick = createPicker();
  let st = sim.getState();
  let now = 1000; // jam dinding palsu: 100 ms per tick (1×)
  for (let i = 0; i < 20000 && st.period !== 'fulltime'; i += 1) {
    const prev = st;
    st = st.period === 'halftime' ? sim.startSecondHalf() : sim.step();
    now += 100;
    if (!record) continue;
    const lines = diffMatch(prev, st, { t: tr, pick, name: (id) => names.get(id) ?? '', team: (id) => id, crowdTeamId: 'home', memo: cmemo });
    if (!log.started() && st.period === 'first' && st.whistle?.kind === 'kickoff' && prev.whistle?.tick !== st.whistle.tick) {
      log.start(now);
      log.add({ jenis: 'kickoff', komentar: 'PRIIIT! Kick-off', bobot: 2, tick: st.tick }, now, st, { teamName: (id) => id });
    }
    for (const e of deriveEvents(prev, st, { lines, memo })) if (!(e.jenis === 'kickoff' && st.period === 'first')) log.add(e, now, st, { teamName: (id) => id });
  }
  const core = { goals: st.stats.goals, shots: st.stats.shots, tick: st.tick, players: st.players.map((p) => [p.id, Math.round(p.x * 1000), Math.round(p.y * 1000)]) };
  return { fp: createHash('sha1').update(JSON.stringify(core)).digest('hex'), log, st };
}

console.log('Log kejadian rekaman (17 Nov)');
{
  const errs = [];
  for (const seed of [3, 13]) {
    const a = play(seed, { record: false });
    const b = play(seed, { record: true });
    if (a.fp !== b.fp) errs.push(`seed ${seed}: laga berubah saat rekam aktif`);
  }
  check('rekam aktif tidak mengubah jalannya laga (sidik jari state akhir sama)', errs);

  const r1 = play(13, { record: true });
  const r2 = play(13, { record: true });
  const strip = (l) => JSON.stringify(l.events().map((e) => [e.tMs, e.jenis, e.pemain, e.skor, e.komentar, e.bobot]));
  check(`seed sama → kejadian sama (${r1.log.size()} kejadian)`, strip(r1.log) === strip(r2.log) ? [] : ['berbeda']);

  const ev = r1.log.events();
  const e3 = [];
  for (let i = 1; i < ev.length; i += 1) if (ev[i].tMs < ev[i - 1].tMs) e3.push(`tMs turun di #${i}`);
  if (ev[0]?.jenis !== 'kickoff' || ev[0]?.tMs !== 0) e3.push('kejadian pertama bukan kick-off di 0');
  if (ev.some((e) => !JENIS.includes(e.jenis))) e3.push('jenis tak dikenal');
  const goals = r1.st.stats.goals.home + r1.st.stats.goals.away;
  if (ev.filter((e) => e.jenis === 'gol').length !== goals) e3.push('jumlah gol di log ≠ skor');
  if (ev.filter((e) => e.jenis === 'laga_selesai').length !== 1) e3.push('laga_selesai tidak tepat sekali');
  if (!ev.some((e) => e.jenis === 'blunder' && e.penyebab)) e3.push('tidak ada blunder dengan penyebab');
  const counts = {};
  for (const e of ev) counts[e.jenis] = (counts[e.jenis] ?? 0) + 1;
  check(`isi log valid & monoton: ${JSON.stringify(counts)}`, e3);
}
{
  const errs = [];
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  const t = createDemoTeams(1);
  const st = createSimulation(t.home, t.away, 1, {}).getState();
  const log = createEventLog({ max: 3 });
  if (log.add({ jenis: 'tekel' }, 50, st) !== null || log.size() !== 0) errs.push('tercatat sebelum kick-off');
  log.start(1000);
  log.add({ jenis: 'tekel', playerId: 'tidak-ada', teamId: 'home' }, 2000, st, { teamName: () => 'Kandang' });
  log.add({ jenis: 'jeda' }, 1500, st); // mundur
  log.add({ jenis: 'lanjut' }, 6500, st);
  log.add({ jenis: 'kecepatan' }, 7000, st); // melebihi batas 3
  log.add({ jenis: 'bukanJenis' }, 8000, st);
  console.warn = orig;
  const ev = log.events();
  if (ev[0].pemain?.nomor !== null || ev[0].pemain?.nama !== null) errs.push('pemain hilang tidak jadi null');
  if (ev[1].tMs !== 1000) errs.push(`tMs mundur tidak disamakan (${ev[1].tMs})`);
  if (ev[2].tMs !== 5500 || ev[2].t !== '00:05') errs.push('jam dinding (jeda 5 dtk) tidak terhitung');
  if (log.size() !== 3 || log.dropped() !== 1) errs.push(`batas ukuran gagal (${log.size()}, dibuang ${log.dropped()})`);
  if (!warns.some((w) => w.includes('mundur')) || !warns.some((w) => w.includes('penuh'))) errs.push('peringatan console tidak muncul');
  check('guard: sebelum kick-off, pemain hilang → null, tMs monoton, batas ukuran, jenis asing', errs);
}
{
  const errs = [];
  const t = createDemoTeams(1);
  const st = createSimulation(t.home, t.away, 1, {}).getState();
  const log = createEventLog();
  log.start(0);
  log.add({ jenis: 'kickoff', komentar: 'PRIIIT!', tick: 10 }, 0, st);
  log.add({ jenis: 'blunder', teamId: 'away', playerId: st.players.find((p) => p.teamId === 'away').id, penyebab: 'operan dipotong lawan: x', tick: 100 }, 1000, st);
  log.add({ jenis: 'gol', teamId: 'home', komentar: 'GOL!', tick: 180, bobot: 3 }, 1500, st);
  log.add({ jenis: 'tembakan', komentar: 'Melebar', tick: 300 }, 9000, st);
  const ev = log.events();
  if (ev[1].bobot !== 3 || !ev[1].penyebab.includes('berujung gol')) errs.push('blunder sebelum gol lawan tidak jadi sorotan');
  const srt = log.toSRT();
  const blocks = srt.trim().split(/\n\n/);
  if (blocks.length !== 3) errs.push(`blok SRT ${blocks.length} ≠ 3`);
  if (!/^1\n00:00:00,000 --> 00:00:01,450\nPRIIIT!$/.test(blocks[0])) errs.push(`blok 1 salah: ${JSON.stringify(blocks[0])}`);
  if (!/00:00:09,000 --> 00:00:12,000/.test(blocks[2])) errs.push('durasi 3 dtk salah');
  const fn = logFileName({ home: 'Persada Bandung', away: 'Garuda Merah', seed: 13, date: new Date(2026, 10, 17, 9, 5) }, 'json');
  if (fn !== 'menejer-bola_persada-bandung-vs-garuda-merah_seed13_20261117-0905.json') errs.push(`nama file: ${fn}`);
  const j = JSON.parse(JSON.stringify(log.toJSON({ seed: 13 })));
  if (!j.meta || j.kejadian.length !== 4 || '_tick' in j.kejadian[0]) errs.push('bentuk JSON salah');
  check('SRT (3 dtk / sampai komentar berikutnya), nama file, JSON, blunder fatal', errs);
}
if (failed) {
  console.log(`\n${failed} pemeriksaan GAGAL.`);
  process.exit(1);
}
console.log('\nSemua pemeriksaan log rekaman lolos.');
