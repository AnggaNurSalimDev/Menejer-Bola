// Uji skema (16 Nov, keputusan pengguna): satu skema diuji melawan 4 formasi umum dengan skuad &
// taktik pengguna; hasilnya % keberhasilan per formasi + alasan gagal + tayangan ulang satu percobaan
// yang berhasil dan satu yang gagal. Di karier, uji = sesi latihan (career.labSession).
//
//   createLab({ home, tactics, script, gap })
//     ├─ untuk tiap formasi × LAB.matchesPer laga: simulasi penuh, hanya skema ini yang terpasang
//     │     tiap tick: team.script muncul → mulai rekam  ·  hilang/berganti → akhir percobaan
//     │     hasil = selisih stats.scriptById.home[id].completed  → 'selesai' | alasan gagal
//     └─ step(anggaranTick) dipanggil berulang (UI: per potongan via setTimeout supaya tidak membeku)
//
// Modul murni & deterministik untuk seed yang sama.

import { createSimulation } from './simulation.js';
import { createTeam, addBench } from './teams.js';
import { PITCH } from './pitch.js';

export const LAB = Object.freeze({
  formations: Object.freeze(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2']),
  matchesPer: 8,
  recordEvery: 2, // tick per bingkai tayangan ulang
  maxFrames: 200,
  reasons: Object.freeze(['selesai', 'bolaHilang', 'bolaMati', 'batal']),
});

const OPP_COLORS = Object.freeze({ shirt: '#c92a2a', number: '#ffffff' });

// Kualitas lawan = rata-rata stat teknik pemain inti pengguna (dibulatkan, 5–18).
export function teamQuality(home) {
  const vals = home.players.flatMap((p) => Object.values(p.stats)).filter(Number.isFinite);
  if (vals.length === 0) throw new RangeError('teamQuality: tim tanpa stat');
  return Math.min(18, Math.max(5, Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)));
}

export function labErrors({ home, tactics, script }) {
  const e = [];
  if (!home || !Array.isArray(home.players) || home.players.length !== 11) e.push('tim pengguna harus 11 pemain inti');
  if (!tactics || typeof tactics !== 'object') e.push('taktik tidak ada');
  if (!script || typeof script.id !== 'string' || !Array.isArray(script.steps) || script.steps.length === 0) e.push('skema tidak valid');
  else {
    const ids = new Set(home?.players?.map((p) => p.id) ?? []);
    const used = new Set([script.holderId, ...(script.playerIds ?? [])]);
    for (const st of script.steps) {
      if (st.trigger?.playerId) used.add(st.trigger.playerId);
      for (const a of st.actions ?? []) {
        if (a.to) used.add(a.to);
        if (a.playerId) used.add(a.playerId);
      }
    }
    used.delete(undefined);
    used.delete(null);
    const missing = [...used].filter((id) => !ids.has(id));
    if (missing.length) e.push(`pemain skema tidak di susunan awal: ${missing.join(', ')}`);
  }
  return e;
}

// Bingkai: pemain [id, x, y] dan bola, dinormalkan supaya pengguna selalu menyerang ke kanan.
function frameOf(st) {
  const home = st.players.find((p) => p.teamId === 'home');
  const flip = home && !home.attacksRight;
  const fx = (x) => Math.round((flip ? PITCH.length - x : x) * 10) / 10;
  const fy = (y) => Math.round((flip ? PITCH.width - y : y) * 10) / 10;
  return {
    t: st.tick,
    p: st.players.filter((p) => !p.sentOff).map((p) => [p.id, p.teamId === 'home' ? 1 : 0, fx(p.x), fy(p.y)]),
    b: [fx(st.ball.x), fy(st.ball.y)],
  };
}

function reasonOf(st) {
  if (st.ball.restartKind) return 'bolaMati';
  const holder = st.ball.ownerId ? st.players.find((p) => p.id === st.ball.ownerId) : null;
  const poss = holder?.teamId ?? st.possessionTeamId;
  if (poss && poss !== 'home') return 'bolaHilang';
  return 'batal';
}

export function createLab({ home, tactics, script, gap = 0, seed = 1, matchesPer = LAB.matchesPer, mastery = null }) {
  if (!(Number.isInteger(matchesPer) && matchesPer >= 1)) throw new RangeError(`createLab: laga per formasi ${matchesPer}`);
  const err = labErrors({ home, tactics, script });
  if (err.length) throw new RangeError(`createLab: ${err[0]}`);
  if (!(gap >= 0 && gap <= 1)) throw new RangeError(`createLab: kekurangan pemahaman ${gap} di luar 0–1`);
  const quality = teamQuality(home);
  const plan = LAB.formations.flatMap((f, fi) => Array.from({ length: matchesPer }, (_, k) => ({ formation: f, seed: seed * 1000 + fi * 97 + k * 13 })));
  const rows = LAB.formations.map((formation) => ({ formation, started: 0, completed: 0, reasons: Object.fromEntries(LAB.reasons.map((r) => [r, 0])) }));
  const replays = { ok: null, fail: null };
  let idx = 0;
  let sim = null;
  let st = null;
  let prev = null; // { startTick, completedBefore }
  let rec = null;

  function startMatch() {
    const m = plan[idx];
    // Nama lawan tidak boleh sama dengan nama punggung pengguna (keunikan per laga).
    const used = new Set([...home.players, ...(home.bench ?? [])].map((p) => p.shortName));
    const opp = addBench(createTeam({ id: 'away', name: m.formation, colors: OPP_COLORS, formation: m.formation, quality, seed: m.seed, usedShortNames: used }), { seed: m.seed + 5, quality, usedShortNames: used });
    sim = createSimulation(home, opp, m.seed, { aiTeams: ['away'], ...(mastery ? { scriptMastery: { home: mastery } } : {}) });
    sim.setTactics('home', { ...tactics, scripts: [{ ...script }] });
    if (gap > 0) sim.setUnderstanding('home', gap);
    st = sim.getState();
    prev = null;
    rec = null;
  }

  let ring = []; // ±1 dtk sebelum skema mulai (konteks tayangan ulang)
  let post = null; // { target, left } — ±1,6 dtk sesudah percobaan berakhir
  function finishAttempt(row) {
    const c = st.stats.scriptById?.home?.[script.id]?.completed ?? 0;
    const ok = c > prev.completedBefore;
    const reason = ok ? 'selesai' : reasonOf(st);
    row.reasons[reason] += 1;
    if (ok) row.completed += 1;
    if (rec) {
      rec.frames.push(frameOf(st));
      const startIndex = rec.pre;
      const keep = () => ({ frames: rec.frames, startIndex, endIndex: rec.frames.length - 1, reason, formation: row.formation, len: rec.frames.length - startIndex });
      if (ok && !replays.ok) post = { target: (replays.ok = keep()), left: 8 };
      // Gagal: utamakan yang cukup panjang untuk ditonton (bukan batal di tick pertama).
      else if (!ok && (!replays.fail || (replays.fail.len < 8 && rec.frames.length - startIndex > replays.fail.len))) post = { target: (replays.fail = keep()), left: 8 };
    }
    rec = null;
    prev = null;
  }

  // Majukan sampai `budget` tick. → true bila semua laga selesai.
  function step(budget = 600) {
    let left = budget;
    while (left > 0 && idx < plan.length) {
      if (!sim) startMatch();
      const row = rows[LAB.formations.indexOf(plan[idx].formation)];
      st = st.period === 'halftime' ? sim.startSecondHalf() : sim.step();
      left -= 1;
      const run = st.teams.home.script;
      if (prev && (!run || run.startTick !== prev.startTick)) finishAttempt(row);
      if (run && !prev) {
        row.started += 1;
        prev = { startTick: run.startTick, completedBefore: st.stats.scriptById?.home?.[script.id]?.completed ?? 0 };
        if (!replays.ok || !replays.fail || replays.fail.len < 8) rec = { frames: [...ring, frameOf(st)], pre: ring.length };
      } else if (st.tick % LAB.recordEvery === 0) {
        const fr = frameOf(st);
        if (rec && rec.frames.length < LAB.maxFrames) rec.frames.push(fr);
        else if (post && post.left > 0) {
          post.target.frames.push(fr);
          post.left -= 1;
        }
        ring = [...ring.slice(-4), fr];
      }
      if (st.period === 'fulltime' || st.period === 'halftime') {
        ring = [];
        post = null;
      }
      if (st.period === 'fulltime') {
        if (prev) finishAttempt(row);
        sim = null;
        idx += 1;
      }
    }
    return idx >= plan.length;
  }

  const result = () => {
    const started = rows.reduce((a, r) => a + r.started, 0);
    const completed = rows.reduce((a, r) => a + r.completed, 0);
    return { rows: rows.map((r) => ({ ...r, reasons: { ...r.reasons } })), started, completed, rate: started ? completed / started : null, replays, matches: plan.length, done: idx >= plan.length };
  };

  return { step, result, progress: () => idx / plan.length, total: plan.length };
}

// Selang ±1,96·√(p(1−p)/n) — supaya angka kecil tidak terlihat pasti.
export function margin(completed, started) {
  if (!started) return null;
  const p = completed / started;
  return Math.sqrt((p * (1 - p)) / started) * 1.96;
}

// Kunci isi skema: hasil uji lama tidak berlaku lagi bila skemanya diubah.
export function scriptKey(script) {
  const s = JSON.stringify({ z: script.zone, h: script.holderId, f: script.first ?? null, st: script.steps });
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${script.id}:${(h >>> 0).toString(36)}`;
}
