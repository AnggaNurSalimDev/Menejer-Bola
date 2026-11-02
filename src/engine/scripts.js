// Strategi detil (2 Nov, layer 4 — ide & model syarat dari pengguna).
//
// Skrip = skema yang MEMAKSA keputusan pemain, tetapi HASILNYA tetap fisika + kualitas pemain
// (operan bisa dipotong / meleset, umpan silang bisa kalah duel, tembakan bisa diselamatkan).
//
//   SYARAT UTAMA  bola dipegang pemain yang ditentukan, di zona skrip, dan semua pemain skrip
//                 berada di posisi zonanya (Detail zona) — toleransi SCRIPT.radius meter
//   LANGKAH       tiap langkah punya PEMICU + AKSI. Pemicu:
//                   mulai          — langsung
//                   operanDilepas  — operan langkah sebelumnya baru dilepas (pelari mulai bersamaan)
//                   operanDiterima — penerima operan sebelumnya sudah menguasai bola
//                   pemainSampai   — pemain X sampai di titik larinya
//                   waktu          — N detik setelah langkah sebelumnya
//                 Aksi: oper (ke pemain), lari (pemain ke titik), giring (pemegang bola ke titik),
//                   umpanSilang (pemegang bola melambungkan ke titik), tembak (pemegang bola)
//   BATAL         bola hilang / bola mati / batas waktu → pemain kembali memutuskan sendiri
//
// Titik disimpan di BINGKAI TIM (meter, tim selalu menyerang ke kanan, jalur kiri = y kecil), jadi
// skrip tetap benar setelah ganti babak.
//
// Modul ini murni: menerima keadaan, mengembalikan keadaan baru. Simulasi yang menjalankan aksinya.

import { PITCH, distance } from './pitch.js';
// Daftar zona disalin (bukan diimpor) supaya tactics.js ↔ scripts.js tidak saling impor; tes mencocokkannya.
export const SCRIPT_ZONES = Object.freeze(['sendiriKiri', 'sendiriKanan', 'lawanKiri', 'lawanKanan']);

export const SCRIPT = Object.freeze({
  radius: 4, // meter: toleransi "berada di posisi" untuk syarat utama
  arriveRadius: 3, // meter: pemicu "pemain sampai"
  timeoutTicks: 120, // 12 dtk paling lama satu skrip berjalan
  stepTimeoutTicks: 60, // 6 dtk paling lama menunggu satu pemicu
  cooldownTicks: 80, // jeda sebelum skrip yang sama boleh mulai lagi
  maxScripts: 16,
  maxSteps: 6,
  maxActions: 6, // 1 aksi pemegang bola + sampai 5 pelari (2 Nov: pengguna ingin menaikkan pemain lain)
  minHeldTicks: 2, // pemegang bola butuh sentuhan sebelum menjalankan perintah
});

export const TRIGGERS = Object.freeze(['mulai', 'operanDilepas', 'operanDiterima', 'pemainSampai', 'waktu']);
export const ACTIONS = Object.freeze(['oper', 'lari', 'giring', 'umpanSilang', 'tembak']);
const HOLDER_ACTIONS = new Set(['oper', 'giring', 'umpanSilang', 'tembak']);

const isPoint = (p) =>
  p !== null && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= PITCH.length && p.y >= 0 && p.y <= PITCH.width;

// Validasi daftar skrip (tanpa melihat state). Mengembalikan daftar pesan.
export function scriptErrors(scripts) {
  const errors = [];
  if (!Array.isArray(scripts)) return ['scripts harus daftar'];
  if (scripts.length > SCRIPT.maxScripts) errors.push(`paling banyak ${SCRIPT.maxScripts} skema`);
  const ids = new Set();
  scripts.forEach((s, i) => {
    const at = `skema ${i + 1}`;
    if (!s || typeof s !== 'object') {
      errors.push(`${at}: bukan objek`);
      return;
    }
    if (typeof s.id !== 'string' || !s.id) errors.push(`${at}: id kosong`);
    else if (ids.has(s.id)) errors.push(`${at}: id ganda ${s.id}`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || s.name.length > 40) errors.push(`${at}: nama tidak valid`);
    if (!SCRIPT_ZONES.includes(s.zone)) errors.push(`${at}: zona tidak dikenal ${s.zone}`);
    if (typeof s.holderId !== 'string' || !s.holderId) errors.push(`${at}: pemegang bola belum dipilih`);
    if (!Array.isArray(s.playerIds) || s.playerIds.some((p) => typeof p !== 'string')) errors.push(`${at}: daftar pemain tidak valid`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push(`${at}: belum ada langkah`);
    else if (s.steps.length > SCRIPT.maxSteps) errors.push(`${at}: paling banyak ${SCRIPT.maxSteps} langkah`);
    else
      s.steps.forEach((step, j) => {
        const st = `${at} langkah ${j + 1}`;
        const t = step?.trigger;
        if (!t || !TRIGGERS.includes(t.type)) errors.push(`${st}: pemicu tidak dikenal`);
        else if (t.type === 'pemainSampai' && typeof t.playerId !== 'string') errors.push(`${st}: pemain untuk "sampai" belum dipilih`);
        else if (t.type === 'waktu' && !(t.detik > 0 && t.detik <= 10)) errors.push(`${st}: detik harus 0–10`);
        if (j === 0 && t && t.type !== 'mulai') errors.push(`${st}: langkah pertama harus "mulai"`);
        if (!Array.isArray(step?.actions) || step.actions.length === 0) errors.push(`${st}: belum ada aksi`);
        else if (step.actions.length > SCRIPT.maxActions) errors.push(`${st}: paling banyak ${SCRIPT.maxActions} aksi`);
        else {
          const holderActs = step.actions.filter((a) => HOLDER_ACTIONS.has(a?.type)).length;
          if (holderActs > 1) errors.push(`${st}: pemegang bola hanya bisa satu aksi per langkah`);
          step.actions.forEach((a, k) => {
            const ac = `${st} aksi ${k + 1}`;
            if (!a || !ACTIONS.includes(a.type)) errors.push(`${ac}: tidak dikenal`);
            else if (a.type === 'oper' && typeof a.to !== 'string') errors.push(`${ac}: penerima belum dipilih`);
            else if (a.type === 'lari' && (typeof a.playerId !== 'string' || !isPoint(a.point))) errors.push(`${ac}: pemain/titik lari tidak valid`);
            else if ((a.type === 'giring' || a.type === 'umpanSilang') && !isPoint(a.point)) errors.push(`${ac}: titik tidak valid`);
          });
        }
      });
  });
  return errors;
}

// Semua id pemain yang dirujuk skrip.
export function scriptPlayerIds(s) {
  const ids = new Set([s.holderId, ...(s.playerIds ?? [])]);
  for (const step of s.steps ?? []) {
    if (step.trigger?.playerId) ids.add(step.trigger.playerId);
    for (const a of step.actions ?? []) {
      if (a.to) ids.add(a.to);
      if (a.playerId) ids.add(a.playerId);
    }
  }
  return [...ids].filter(Boolean);
}

// Pemain diganti: id lama → id baru di semua skrip.
export function renameInScripts(scripts, outId, inId) {
  const swap = (id) => (id === outId ? inId : id);
  return (scripts ?? []).map((s) => ({
    ...s,
    holderId: swap(s.holderId),
    playerIds: (s.playerIds ?? []).map(swap),
    steps: (s.steps ?? []).map((st) => ({
      trigger: st.trigger?.playerId ? { ...st.trigger, playerId: swap(st.trigger.playerId) } : st.trigger,
      actions: st.actions.map((a) => ({ ...a, ...(a.to ? { to: swap(a.to) } : {}), ...(a.playerId ? { playerId: swap(a.playerId) } : {}) })),
    })),
  }));
}

export function fromTeamPoint(point, attacksRight) {
  return attacksRight ? { x: point.x, y: point.y } : { x: PITCH.length - point.x, y: PITCH.width - point.y };
}

// Keadaan skrip berjalan satu tim (disimpan di team.script):
//   { id, step, startTick, stepTick, runs: { id → titik lapangan }, order: perintah untuk pemegang bola | null,
//     lastPass: { to, released, received } | null }

// Coba mulai skrip. ctx = { tick, ownerId, zone, anchorOf(player) → titik, byId, cooldowns }.
export function tryStartScript(scripts, ctx) {
  for (const s of scripts ?? []) {
    if (s.zone !== ctx.zone || s.holderId !== ctx.ownerId) continue;
    if ((ctx.cooldowns?.[s.id] ?? -Infinity) > ctx.tick) continue;
    const ok = (s.playerIds ?? []).every((id) => {
      const p = ctx.byId.get(id);
      if (!p) return false;
      const a = ctx.anchorOf(p);
      return a && distance(p, a) <= SCRIPT.radius;
    });
    if (!ok || !ctx.byId.get(s.holderId)) continue;
    return { id: s.id, step: 0, startTick: ctx.tick, stepTick: ctx.tick, runs: {}, order: null, lastPass: null };
  }
  return null;
}

// Pemicu langkah sekarang terpenuhi?
export function triggerMet(run, trigger, ctx) {
  switch (trigger.type) {
    case 'mulai':
      return true;
    case 'operanDilepas':
      return Boolean(run.lastPass?.released);
    case 'operanDiterima':
      return Boolean(run.lastPass?.received);
    case 'pemainSampai': {
      const p = ctx.byId.get(trigger.playerId);
      const at = run.runs[trigger.playerId];
      return Boolean(p && at && distance(p, at) <= SCRIPT.arriveRadius);
    }
    case 'waktu':
      return ctx.tick - run.stepTick >= Math.round(trigger.detik * 10);
    default:
      return false;
  }
}

// Majukan skrip sebanyak mungkin langkah di tick ini. Mengembalikan { run, ended, reason }.
// Aksi pemegang bola menjadi run.order (dijalankan simulasi saat pemegang bola memutuskan);
// langkah berikutnya menunggu sampai order itu dijalankan.
export function advanceScript(script, run, ctx) {
  if (!script) return { run: null, ended: true, reason: 'hilang' };
  if (ctx.tick - run.startTick > SCRIPT.timeoutTicks) return { run: null, ended: true, reason: 'waktu habis' };
  let next = { ...run, runs: { ...run.runs } };
  let guard = 0;
  while (next.step < script.steps.length && !next.order && guard < SCRIPT.maxSteps + 1) {
    guard += 1;
    const step = script.steps[next.step];
    if (!triggerMet(next, step.trigger, ctx)) {
      if (ctx.tick - next.stepTick > SCRIPT.stepTimeoutTicks) return { run: null, ended: true, reason: 'pemicu tak terpenuhi' };
      break;
    }
    for (const a of step.actions) {
      if (a.type === 'lari') next.runs[a.playerId] = fromTeamPoint(a.point, ctx.attacksRight);
      else next.order = { ...a, ...(a.point ? { pitchPoint: fromTeamPoint(a.point, ctx.attacksRight) } : {}) };
    }
    next = { ...next, step: next.step + 1, stepTick: ctx.tick };
  }
  const finished = next.step >= script.steps.length && !next.order;
  return { run: next, ended: false, finished, reason: null };
}

export function validateScriptRun(run, teamPlayers) {
  if (run === null || run === undefined) return [];
  const errors = [];
  if (typeof run.id !== 'string') errors.push('skrip berjalan tanpa id');
  if (!(run.step >= 0)) errors.push('langkah skrip tidak valid');
  const ids = new Set(teamPlayers.map((p) => p.id));
  for (const [id, pt] of Object.entries(run.runs ?? {})) {
    if (!ids.has(id)) continue; // pemain bisa sudah keluar; diabaikan
    if (!Number.isFinite(pt?.x) || !Number.isFinite(pt?.y)) errors.push(`titik lari skrip ${id} tidak valid`);
  }
  return errors;
}
