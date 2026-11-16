// Latihan skema beranimasi (17 Nov, keputusan pengguna): 10 ulangan melawan salah satu dari 4 formasi;
// skema bisa diubah selama latihan (berlaku di ulangan berikutnya); hasil latihan = penguasaan skema.
//
//   createDrill({ home, tactics, getScript, formation, gap, mastery, seed })
//     tick() → { frame, phase, rep, events }   satu tick simulasi (UI memanggil sesuai kecepatan)
//
//   satu ulangan:
//     'siap'    setupDrill → pemain di posisi bentuk, bola di pemegang         (0,8 dtk diam untuk dibaca)
//     'jalan'   simulasi berjalan; skema harus mulai ≤ 3 dtk ("tidak mulai")
//               berakhir saat team.script hilang; ok = completed bertambah     (maks 20 dtk)
//     'sesudah' 1,5 dtk lanjutan supaya terlihat apa yang terjadi
//   versi: tiap isi skema berubah (scriptKey) → versi baru, hasil dicatat per versi.
//
// Murni & deterministik untuk seed + urutan perubahan yang sama.

import { createSimulation } from './simulation.js';
import { createTeam, addBench } from './teams.js';
import { teamQuality, labErrors, scriptKey } from './scriptLab.js';
import { PITCH } from './pitch.js';
import { TICK_RATE } from './constants.js';

export const DRILL = Object.freeze({
  reps: 10,
  formations: Object.freeze(['4-4-2', '4-3-3', '4-2-3-1', '3-5-2']),
  readyTicks: 8,
  startTicks: 30, // skema harus mulai dalam 3 dtk
  maxTicks: 200, // 20 dtk per ulangan
  afterTicks: 15,
  // Penguasaan per ulangan (× kecepatan belajar pemain inti, dari career.js).
  gainOk: 3,
  gainFail: 1,
});

const OPP_COLORS = Object.freeze({ shirt: '#c92a2a', number: '#ffffff' });

function frameOf(st) {
  const home = st.players.find((p) => p.teamId === 'home');
  const flip = home && !home.attacksRight;
  const fx = (x) => (flip ? PITCH.length - x : x);
  const fy = (y) => (flip ? PITCH.width - y : y);
  return { t: st.tick, p: st.players.filter((p) => !p.sentOff).map((p) => [p.id, p.teamId === 'home' ? 1 : 0, fx(p.x), fy(p.y)]), b: [fx(st.ball.x), fy(st.ball.y)], owner: st.ball.ownerId };
}

function reasonOf(st) {
  if (st.ball.restartKind) return 'bolaMati';
  const holder = st.ball.ownerId ? st.players.find((p) => p.id === st.ball.ownerId) : null;
  const poss = holder?.teamId ?? st.possessionTeamId;
  if (poss && poss !== 'home') return 'bolaHilang';
  return 'batal';
}

export function createDrill({ home, tactics, getScript, formation, gap = 0, mastery = null, seed = 1, reps = DRILL.reps }) {
  if (typeof getScript !== 'function') throw new TypeError('createDrill: getScript wajib');
  if (!DRILL.formations.includes(formation)) throw new RangeError(`createDrill: formasi lawan ${formation}`);
  if (!(Number.isInteger(reps) && reps >= 1 && reps <= 30)) throw new RangeError(`createDrill: ulangan ${reps}`);
  const first = getScript();
  const err = labErrors({ home, tactics, script: first });
  if (err.length) throw new RangeError(`createDrill: ${err[0]}`);
  const used = new Set([...home.players, ...(home.bench ?? [])].map((p) => p.shortName));
  const quality = teamQuality(home);
  const opp = addBench(createTeam({ id: 'away', name: formation, colors: OPP_COLORS, formation, quality, seed: seed + 3, usedShortNames: used }), { seed: seed + 5, quality, usedShortNames: used });
  const sim = createSimulation(home, opp, seed, { aiTeams: ['away'], injuries: false, ...(mastery ? { scriptMastery: { home: mastery } } : {}) });
  if (gap > 0) sim.setUnderstanding('home', gap);

  const results = []; // { rep, version, ok, reason, ticks }
  const versions = []; // [{ key, name }]
  let rep = 0;
  let phase = 'siap';
  let phaseTick = 0;
  let script = null;
  let version = -1;
  let startedTick = null;
  let completedBefore = 0;
  let done = false;

  function beginRep() {
    script = getScript();
    const e = labErrors({ home, tactics, script });
    if (e.length) throw new RangeError(`drill: ${e[0]}`);
    const key = scriptKey(script);
    if (version < 0 || versions[version].key !== key) {
      versions.push({ key, name: script.name });
      version = versions.length - 1;
    }
    sim.setTactics('home', { ...tactics, scripts: [{ ...script }] });
    // Babak hampir habis → mulai babak baru (drill tidak butuh jam).
    if (sim.getState().period === 'halftime') sim.startSecondHalf();
    sim.setupDrill({ teamId: 'home', holderId: script.holderId, zone: script.zone });
    phase = 'siap';
    phaseTick = 0;
    startedTick = null;
    completedBefore = sim.getState().stats.scriptById?.home?.[script.id]?.completed ?? 0;
  }

  function finish(ok, reason) {
    results.push({ rep: rep + 1, version, ok, reason, ticks: startedTick === null ? 0 : sim.getState().tick - startedTick });
    phase = 'sesudah';
    phaseTick = 0;
  }

  beginRep();

  function tick() {
    const events = [];
    if (done) return { frame: frameOf(sim.getState()), phase: 'selesai', rep, events };
    phaseTick += 1;
    if (phase === 'siap') {
      if (phaseTick >= DRILL.readyTicks) {
        phase = 'jalan';
        phaseTick = 0;
      }
      return { frame: frameOf(sim.getState()), phase, rep, events };
    }
    let st = sim.step();
    if (st.period === 'halftime' || st.period === 'fulltime') {
      // Jam babak habis di tengah ulangan: anggap batal & mulai ulang babak (jarang: tiap ulangan ≤ 25 dtk).
      if (st.period === 'halftime') st = sim.startSecondHalf();
    }
    if (phase === 'jalan') {
      const run = st.teams.home.script;
      if (run && startedTick === null) {
        startedTick = st.tick;
        events.push({ type: 'mulai' });
      }
      if (startedTick === null && phaseTick >= DRILL.startTicks) {
        finish(false, 'tidakMulai');
        events.push({ type: 'akhir', ok: false, reason: 'tidakMulai' });
      } else if (startedTick !== null && (!run || run.startTick !== startedTick)) {
        const c = st.stats.scriptById?.home?.[script.id]?.completed ?? 0;
        const ok = c > completedBefore;
        const reason = ok ? 'selesai' : reasonOf(st);
        finish(ok, reason);
        events.push({ type: 'akhir', ok, reason });
      } else if (phaseTick >= DRILL.maxTicks) {
        finish(false, 'batal');
        events.push({ type: 'akhir', ok: false, reason: 'batal' });
      }
    } else if (phase === 'sesudah' && phaseTick >= DRILL.afterTicks) {
      rep += 1;
      if (rep >= reps) {
        done = true;
        events.push({ type: 'selesai' });
      } else beginRep();
    }
    return { frame: frameOf(sim.getState()), phase, rep, events, step: st.teams.home.script?.step ?? null };
  }

  return {
    tick,
    results: () => results.map((r) => ({ ...r })),
    versions: () => versions.map((v) => ({ ...v })),
    done: () => done,
    rep: () => rep,
    reps,
    currentScript: () => script,
    secondsPerTick: 1 / TICK_RATE,
  };
}

// Penguasaan yang didapat dari hasil latihan (sebelum × kecepatan belajar).
export function drillGain(results) {
  if (!Array.isArray(results)) throw new TypeError('drillGain: hasil harus daftar');
  return results.reduce((a, r) => a + (r.ok ? DRILL.gainOk : DRILL.gainFail), 0);
}
