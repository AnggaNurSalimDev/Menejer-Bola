// Log kejadian untuk rekaman (17 Nov, permintaan pengguna): daftar kejadian penting + waktunya, untuk
// memotong video promosi & menulis naskah voice over. Hanya dibaca dari state — TIDAK pernah memanggil
// simulasi, RNG ber-seed, atau mengubah urutan update (laga dengan seed sama identik, rekam aktif/tidak).
//
//   per tick simulasi (MatchView.onStep):
//     deriveEvents(prev, next, ctx) ──▶ [kejadian mentah] ──▶ log.add(e, nowMs)
//        ├ komentar (diffMatch, sumber yang sama dengan teks di layar)
//        ├ state.tickEvents: blunder (operan dipotong, sentuhan jelek, direbut, sapuan panik), tekel
//        ├ pergantian, on fire / kepercayaan diri turun (ambang sama dengan titik di lapangan)
//   tombol UI: jeda / lanjut / kecepatan ──▶ log.add(...)
//
//   tMs = jam dinding (performance.now) sejak frame banner "PRIIIT! Kick-off" babak 1 tampil.
//   Jeda & kecepatan 1×–8× tetap terhitung (video juga terus merekam).

import { gameClock } from '../engine/state.js';
import { CONDITION, onFireAmount } from '../engine/condition.js';

export const LOG = Object.freeze({
  max: 5000,
  srtMs: 3000,
  srtGapMs: 50,
  fatalWindowTicks: 150, // blunder yang dibalas gol lawan ≤ 15 dtk game = "blunder fatal"
  lowConfidence: 0.4, // sama dengan LOW_CONFIDENCE_CUE di pitchRenderer (titik merah)
  confidenceRearm: 0.08, // naik lagi sebanyak ini sebelum "turun" boleh tercatat ulang
});

export const JENIS = Object.freeze([
  'kickoff', 'gol', 'tembakan', 'penyelamatan', 'blunder', 'tekel', 'pelanggaran', 'kartu', 'offside', 'pojok',
  'pergantian', 'onfire', 'kepercayaan_turun', 'jeda', 'lanjut', 'kecepatan', 'babak_selesai', 'laga_selesai',
]);

const COMMENT_JENIS = Object.freeze({ goal: 'gol', save: 'penyelamatan', miss: 'tembakan', foul: 'pelanggaran', penalty: 'pelanggaran', card: 'kartu', offside: 'offside', corner: 'pojok', kickoff: 'kickoff', half: 'babak_selesai', full: 'laga_selesai' });

const BLUNDER_KIND = Object.freeze({
  passIntercepted: { label: 'operan dipotong lawan', stat: 'passing', statLabel: 'Operan' },
  heavyTouch: { label: 'sentuhan pertama terlalu jauh', stat: 'kontrol', statLabel: 'Kontrol' },
  dispossessed: { label: 'bola direbut', stat: 'dribbling', statLabel: 'Dribel' },
  panicClear: { label: 'sapuan panik', stat: 'ketenangan', statLabel: 'Ketenangan' },
});

const pad2 = (n) => String(n).padStart(2, '0');
export function mmss(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
function srtTime(ms) {
  const v = Math.max(0, Math.round(ms));
  const h = Math.floor(v / 3600000);
  const m = Math.floor((v % 3600000) / 60000);
  const s = Math.floor((v % 60000) / 1000);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(v % 1000).padStart(3, '0')}`;
}

// Faktor penyumbang terbesar sebuah blunder — PERKIRAAN dari rumus yang sama (condition.js), bukan
// hasil undian mesin (mesin tidak mencatat satu penyebab tunggal).
export function blunderCause(player, kind) {
  if (!player?.condition || !player?.skills) return null;
  const c = player.condition;
  const info = BLUNDER_KIND[kind];
  const statVal = info ? player.skills[info.stat] : null;
  const candidates = [
    { why: `kelelahan (tenaga ${Math.round(c.energy * 100)}%)`, w: Math.max(0, 1 - c.energy - CONDITION.fatigueFreeZone) * CONDITION.fatigueBlunder },
    { why: `kepercayaan diri rendah (${Math.round(c.confidence * 100)}%)`, w: (1 - c.confidence) * CONDITION.confidenceBlunder },
    { why: 'form buruk hari ini', w: Math.max(0, c.form ?? 0) },
  ];
  // Stat dasar rendah: 1 di skala 1–20 setara penalti 0,25 (kira-kira sebesar percaya diri 0).
  if (Number.isFinite(statVal)) candidates.push({ why: `stat ${info.statLabel} rendah (${statVal})`, w: ((20 - statVal) / 19) * 0.25 });
  candidates.sort((a, b) => b.w - a.w);
  return candidates[0].w > 0.02 ? candidates[0].why : 'sial (kondisi & stat normal)';
}

function teamName(ctx, teamId) {
  if (!teamId) return null;
  return ctx.teamName?.(teamId) ?? null;
}
function playerRef(state, id) {
  if (!id) return null;
  const p = state.players.find((x) => x.id === id);
  if (!p) return { nomor: null, nama: null };
  return { nomor: p.number ?? null, nama: p.shortName ?? p.name ?? null };
}

// Selisih dua state berurutan → kejadian mentah (tanpa waktu). ctx: { lines (hasil diffMatch),
// teamName(id), memo (objek milik pemanggil, untuk ambang kepercayaan diri) }.
export function deriveEvents(prev, next, ctx) {
  if (!prev || !next) return [];
  const out = [];
  const memo = ctx.memo ?? (ctx.memo = {});
  const add = (e) => out.push({ tick: next.tick, ...e });

  for (const l of ctx.lines ?? []) {
    const jenis = COMMENT_JENIS[l.kind];
    if (!jenis) continue;
    let bobot = 1;
    if (jenis === 'gol' || jenis === 'laga_selesai') bobot = 3;
    else if (jenis === 'penyelamatan') bobot = Number.isFinite(l.dist) && l.dist <= 16 ? 3 : 2;
    else if (jenis === 'tembakan') bobot = Number.isFinite(l.dist) && l.dist <= 16 ? 2 : 1;
    else if (jenis === 'kartu') bobot = l.card === 'yellow' ? 2 : 3;
    else if (l.kind === 'penalty') bobot = 3;
    else if (jenis === 'babak_selesai' || jenis === 'kickoff') bobot = 2;
    add({ jenis, teamId: l.teamId ?? null, playerId: l.playerId ?? null, komentar: l.text, line: l, bobot });
  }

  for (const [id, ev] of next.tickEvents ?? []) {
    const p = next.players.find((x) => x.id === id);
    if (BLUNDER_KIND[ev]) add({ jenis: 'blunder', teamId: p?.teamId ?? null, playerId: id, penyebab: p ? `${BLUNDER_KIND[ev].label}: ${blunderCause(p, ev)}` : BLUNDER_KIND[ev].label, bobot: 1, blunderKind: ev });
    else if (ev === 'tackleWon') add({ jenis: 'tekel', teamId: p?.teamId ?? null, playerId: id, bobot: 1 });
  }

  // Pergantian: pemain baru muncul di lapangan.
  if (next.players.length && prev.players.length) {
    const before = new Set(prev.players.map((p) => p.id));
    for (const p of next.players) if (!before.has(p.id)) add({ jenis: 'pergantian', teamId: p.teamId, playerId: p.id, bobot: 1 });
  }

  // On fire / kepercayaan diri turun (dengan jeda supaya tidak berulang).
  memo.low ??= {};
  memo.fire ??= {};
  for (const p of next.players) {
    const c = p.condition;
    if (!c) continue;
    const fire = onFireAmount(c) > 0;
    if (fire && !memo.fire[p.id]) add({ jenis: 'onfire', teamId: p.teamId, playerId: p.id, bobot: 2 });
    memo.fire[p.id] = fire;
    if (c.confidence < LOG.lowConfidence && !memo.low[p.id]) {
      add({ jenis: 'kepercayaan_turun', teamId: p.teamId, playerId: p.id, penyebab: `kepercayaan diri ${Math.round(c.confidence * 100)}%`, bobot: 2 });
      memo.low[p.id] = true;
    } else if (c.confidence >= LOG.lowConfidence + LOG.confidenceRearm) memo.low[p.id] = false;
  }
  return out;
}

export function createEventLog({ max = LOG.max } = {}) {
  if (!(Number.isInteger(max) && max > 0)) throw new RangeError(`createEventLog: max ${max}`);
  let t0 = null;
  let events = [];
  let lastMs = 0;
  let dropped = 0;
  let warnedFull = false;

  function add(raw, nowMs, state, { speed = 1, teamName = () => null } = {}) {
    try {
      if (t0 === null) return null; // belum kick-off: tidak mencatat apa pun
      if (!raw || !JENIS.includes(raw.jenis)) {
        console.warn('[log rekam] jenis kejadian tidak dikenal, dilewati:', raw?.jenis);
        return null;
      }
      if (events.length >= max) {
        dropped += 1;
        if (!warnedFull) console.warn(`[log rekam] log penuh (${max} kejadian); kejadian berikutnya dibuang`);
        warnedFull = true;
        return null;
      }
      let tMs = Number.isFinite(nowMs) ? Math.round(nowMs - t0) : lastMs;
      if (tMs < lastMs) {
        console.warn(`[log rekam] tMs mundur (${tMs} < ${lastMs}); disamakan dengan kejadian sebelumnya`);
        tMs = lastMs;
      }
      lastMs = tMs;
      const goals = state?.stats?.goals ?? null;
      const ids = goals ? Object.keys(goals) : [];
      const clock = state ? gameClock(state) : null;
      const e = {
        tMs,
        t: mmss(tMs),
        babak: state ? (state.period === 'first' ? 1 : state.period === 'second' ? 2 : state.period === 'halftime' ? 1 : 2) : null,
        menit: clock?.minute ?? null,
        jenis: raw.jenis,
        tim: raw.teamId ? teamName(raw.teamId) : null,
        pemain: raw.playerId && state ? playerRef(state, raw.playerId) : null,
        penyebab: raw.penyebab ?? null,
        skor: ids.length === 2 ? `${goals[ids[0]]}-${goals[ids[1]]}` : null,
        kecepatan: speed,
        komentar: raw.komentar ?? null,
        bobot: raw.bobot ?? 1,
      };
      // Internal (tidak diekspor): untuk "blunder fatal" & penanda teks yang benar-benar tampil.
      Object.defineProperty(e, '_tick', { value: raw.tick ?? state?.tick ?? null, enumerable: false });
      Object.defineProperty(e, '_teamId', { value: raw.teamId ?? null, enumerable: false });
      Object.defineProperty(e, '_line', { value: raw.line ?? null, enumerable: false });
      events.push(e);
      // Gol: blunder tim yang kebobolan ≤ 15 dtk sebelumnya jadi sorotan.
      if (raw.jenis === 'gol' && raw.teamId) {
        for (let i = events.length - 2; i >= 0; i -= 1) {
          const b = events[i];
          if (b._tick !== null && e._tick !== null && e._tick - b._tick > LOG.fatalWindowTicks) break;
          if (b.jenis === 'blunder' && b._teamId && b._teamId !== raw.teamId) {
            b.bobot = 3;
            if (b.penyebab && !b.penyebab.includes('berujung gol')) b.penyebab += ' — berujung gol lawan';
          }
        }
      }
      return e;
    } catch (err) {
      console.warn('[log rekam] kejadian gagal dicatat:', err?.message ?? err);
      return null;
    }
  }

  return {
    start(nowMs) {
      if (!Number.isFinite(nowMs)) throw new RangeError('start: waktu tidak valid');
      if (t0 !== null) return false;
      t0 = nowMs;
      return true;
    },
    reset() {
      t0 = null;
      events = [];
      lastMs = 0;
      dropped = 0;
      warnedFull = false;
    },
    started: () => t0 !== null,
    elapsed: (nowMs) => (t0 === null ? null : Math.max(0, nowMs - t0)),
    add,
    size: () => events.length,
    dropped: () => dropped,
    events: () => events.map((e) => ({ ...e, tampil: e._line ? Boolean(e._line.shown) : null })),
    toJSON(meta) {
      return { meta: { ...meta, jumlahKejadian: events.length, dibuang: dropped, patokanWaktu: 'tMs = ms jam dinding sejak banner "PRIIIT! Kick-off" babak 1 tampil; jeda & kecepatan tetap terhitung' }, kejadian: this.events() };
    },
    // Tiap komentar jadi satu subtitle: mulai di tMs, tampil 3 dtk atau sampai komentar berikutnya.
    // Subtitle pertama = penanda kick-off di 00:00 (titik sinkron dengan video).
    toSRT() {
      const lines = events.filter((e) => e.komentar);
      const blocks = [];
      lines.forEach((e, i) => {
        const nextStart = lines[i + 1]?.tMs ?? Infinity;
        const end = Math.max(e.tMs + 200, Math.min(e.tMs + LOG.srtMs, nextStart - LOG.srtGapMs));
        blocks.push(`${blocks.length + 1}\n${srtTime(e.tMs)} --> ${srtTime(end)}\n${e.komentar.replace(/\n+/g, ' ')}\n`);
      });
      return blocks.join('\n');
    },
  };
}

const slug = (s) =>
  String(s ?? 'tim')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tim';

export function logFileName({ home, away, seed, date = new Date() }, ext) {
  if (!['json', 'srt'].includes(ext)) throw new RangeError(`logFileName: ekstensi ${ext}`);
  const d = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `menejer-bola_${slug(home)}-vs-${slug(away)}_seed${seed ?? 'x'}_${d}.${ext}`;
}
