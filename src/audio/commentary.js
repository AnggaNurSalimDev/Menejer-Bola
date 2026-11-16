// Komentator (16 Nov): membaca perubahan state laga antar-bingkai dan menghasilkan kalimat + bunyi.
// Murni (tanpa Web Audio / DOM): App yang menampilkan teks, menyuarakan, dan memicu penonton.
//
//   diffMatch(prev, next, ctx) → [{ kind, text, sound, priority }]
//     kind  : goal | shot | save | miss | foul | card | penalty | offside | corner | kickoff | half | full
//     sound : 'roar' | 'roarAway' | 'ooh' | 'applause' | 'whistleShort' (pelanggaran) | 'whistleLong' (mulai/turun minum) | 'whistleEnd' | null
//   ctx = { name(id), team(teamId) → nama, crowdTeamId (tim yang didukung mayoritas penonton), t, pick }
//
// Variasi kalimat dipilih bergiliran (pick) supaya tidak terdengar berulang.

const tk = (s) => s;

export const LINES = Object.freeze({
  kickoff: [tk('Wasit meniup peluit, laga dimulai!'), tk('Bola mulai bergulir!'), tk('Kick-off! Kita mulai pertandingan ini.')],
  secondHalf: [tk('Babak kedua dimulai!'), tk('Bola kembali bergulir di babak kedua.')],
  half: [tk('Turun minum. Skor {s}.'), tk('Peluit babak pertama berbunyi, {s}.')],
  full: [tk('Peluit panjang! Laga berakhir {s}.'), tk('Selesai! Skor akhir {s}.')],
  goal: [tk('GOOOL! {p} mencetak gol untuk {t}!'), tk('GOL! {p} menjebol gawang! {s}'), tk('Masuk! {p} tidak membuang peluang! {s}')],
  goalHeader: [tk('GOL SUNDULAN! {p} menanduk bola ke gawang!'), tk('Sundulan {p}… MASUK! {s}')],
  goalPenalty: [tk('{p} mengeksekusi penalti… GOL! {s}')],
  goalFreeKick: [tk('Tendangan bebas {p}… GOL INDAH! {s}')],
  goalLong: [tk('Dari jarak jauh… {p}… GOOOL! Luar biasa! {s}')],
  ownGoal: [tk('Aduh! Gol bunuh diri, {t} diuntungkan. {s}')],
  save: [tk('Tembakan {p}… diselamatkan kiper!'), tk('{p} menembak, kiper sigap menepis!'), tk('Peluang {p}! Tapi kiper berdiri kokoh.')],
  miss: [tk('{p} menembak… melebar!'), tk('Tembakan {p} belum menemui sasaran.'), tk('Uuuh! {p} nyaris!')],
  foul: [tk('Pelanggaran oleh {p}.'), tk('{p} menjatuhkan lawan, wasit meniup peluit.')],
  yellow: [tk('Kartu kuning untuk {p}.'), tk('Wasit mengeluarkan kartu kuning, {p} dicatat namanya.')],
  red: [tk('KARTU MERAH! {p} harus meninggalkan lapangan!')],
  penalty: [tk('PENALTI! Wasit menunjuk titik putih!')],
  offside: [tk('Bendera hakim garis terangkat, {p} offside.'), tk('Offside, {p} terlalu cepat bergerak.')],
  corner: [tk('Sepak pojok untuk {t}.'), tk('{t} mendapat tendangan sudut.')],
});

const sum2 = (o) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : 0);

export function scoreText(state, homeId, awayId) {
  return `${state.stats.goals[homeId]}–${state.stats.goals[awayId]}`;
}

export function diffMatch(prev, next, ctx) {
  if (!prev || !next) return [];
  if (typeof ctx?.t !== 'function' || typeof ctx?.pick !== 'function') throw new TypeError('diffMatch: ctx.t & ctx.pick wajib');
  const out = [];
  const [homeId, awayId] = Object.keys(next.stats.goals);
  const s = scoreText(next, homeId, awayId);
  const say = (kind, key, params, { sound = null, priority = 1 } = {}) => out.push({ kind, text: ctx.t(ctx.pick(key, LINES[key]), { s, ...params }), sound, priority });
  const name = (id) => (id ? ctx.name(id) : '');

  // Periode.
  if (prev.period !== next.period) {
    if (next.period === 'halftime') say('half', 'half', {}, { sound: 'whistleLong', priority: 3 });
    if (next.period === 'fulltime') say('full', 'full', {}, { sound: 'whistleEnd', priority: 3 });
    if (prev.period === 'halftime' && next.period === 'second') say('kickoff', 'secondHalf', {}, { sound: 'whistleLong', priority: 2 });
  }
  if (prev.tick === 0 && next.tick > 0 && next.period === 'first') say('kickoff', 'kickoff', {}, { sound: 'whistleLong', priority: 2 });

  // Gol.
  for (const id of [homeId, awayId]) {
    if (next.stats.goals[id] > prev.stats.goals[id]) {
      const g = next.lastGoal;
      const crowd = id === ctx.crowdTeamId ? 'roar' : 'roarAway';
      const key = g?.ownGoal ? 'ownGoal' : g?.penalty ? 'goalPenalty' : g?.freeKick ? 'goalFreeKick' : g?.header ? 'goalHeader' : g?.longShot ? 'goalLong' : 'goal';
      say('goal', key, { p: name(g?.scorerId) || ctx.team(id), t: ctx.team(id) }, { sound: crowd, priority: 5 });
    }
  }
  const scored = out.some((x) => x.kind === 'goal');

  // Tembakan: hasilnya baru jelas beberapa tick kemudian (kiper menepis / bola keluar / direbut).
  // ctx.memo.shot = { teamId, kicker, tick } menunggu sampai salah satu terjadi (maks 3 dtk).
  const memo = ctx.memo ?? (ctx.memo = {});
  for (const id of [homeId, awayId]) {
    if (next.stats.shots[id].total > prev.stats.shots[id].total && !scored) memo.shot = { teamId: id, kicker: name(next.ball.kickerId) || ctx.team(id), tick: next.tick };
  }
  if (scored) memo.shot = null;
  if (memo.shot) {
    const { teamId, kicker, tick } = memo.shot;
    const other = teamId === homeId ? awayId : homeId;
    const saved = sum2(next.stats.saves[other]) > sum2(prev.stats.saves[other]);
    const owner = next.ball.ownerId ? next.players.find((p) => p.id === next.ball.ownerId) : null;
    const over = next.ball.restartKind || (owner && owner.teamId !== teamId && owner.role !== 'GK') || next.tick - tick > 30;
    if (saved || (owner && owner.role === 'GK' && owner.teamId !== teamId)) {
      say('save', 'save', { p: kicker }, { sound: 'applause', priority: 2 });
      memo.shot = null;
    } else if (over) {
      say('miss', 'miss', { p: kicker }, { sound: 'ooh', priority: 2 });
      memo.shot = null;
    }
  }

  // Peluit wasit (pelanggaran, kartu, penalti, offside).
  const w = next.whistle;
  if (w && (!prev.whistle || prev.whistle.tick !== w.tick || prev.whistle.kind !== w.kind)) {
    const p = name(w.playerId);
    if (w.kind === 'foul' || w.kind === 'advantage') {
      if (w.penalty) say('penalty', 'penalty', {}, { sound: 'whistleShort', priority: 4 });
      else if (w.card === 'red' || w.card === 'secondYellow') say('card', 'red', { p }, { sound: 'whistleShort', priority: 4 });
      else if (w.card === 'yellow') say('card', 'yellow', { p }, { sound: 'whistleShort', priority: 3 });
      else say('foul', 'foul', { p }, { sound: w.kind === 'advantage' ? null : 'whistleShort', priority: 1 });
    } else if (w.kind === 'offside') say('offside', 'offside', { p }, { sound: 'whistleShort', priority: 1 });
  }

  // Sepak pojok.
  for (const id of [homeId, awayId]) {
    if ((next.stats.corners[id]?.taken ?? 0) > (prev.stats.corners[id]?.taken ?? 0)) say('corner', 'corner', { t: ctx.team(id) }, { priority: 1 });
  }
  return out;
}

// Ketegangan 0–1 (16 Nov, permintaan pengguna: makin riuh saat serangan berpotensi gol):
//   tembakan sedang meluncur → 1 · bola dikuasai di sepertiga akhir, makin dekat & makin di tengah
//   gawang → makin tinggi · sisanya dengung dasar 0,15.
export function excitementOf(state, PITCH_LENGTH = 105) {
  if (state.period !== 'first' && state.period !== 'second') return 0.1;
  if (state.ball.shotTeamId && Math.hypot(state.ball.vx ?? 0, state.ball.vy ?? 0) > 5) return 1;
  const owner = state.ball.ownerId ? state.players.find((p) => p.id === state.ball.ownerId) : null;
  const teamId = owner?.teamId ?? state.ball.passTeamId ?? state.possessionTeamId;
  if (!teamId) return 0.15;
  const attacker = state.players.find((p) => p.teamId === teamId);
  if (!attacker) return 0.15;
  const goalX = attacker.attacksRight ? PITCH_LENGTH : 0;
  const dx = Math.abs(state.ball.x - goalX);
  const dy = Math.abs(state.ball.y - 34);
  if (dx > 38) return 0.15;
  const near = 1 - dx / 38; // 0 di 38 m, 1 di garis gawang
  const central = dy < 10 ? 1 : Math.max(0.4, 1 - (dy - 10) / 24);
  return Math.min(1, Math.max(0.15, 0.15 + 0.85 * near ** 1.3 * central));
}

// Pemilih kalimat bergiliran per kunci.
export function createPicker() {
  const idx = new Map();
  return (key, list) => {
    if (!Array.isArray(list) || list.length === 0) throw new RangeError(`pick: daftar kosong untuk ${key}`);
    const i = idx.get(key) ?? Math.floor(Math.random() * list.length);
    idx.set(key, (i + 1) % list.length);
    return list[i % list.length];
  };
}
