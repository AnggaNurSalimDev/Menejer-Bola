// Koreografi pertikaian & protes (masukan 29 Okt: pemain jangan hanya menumpuk diam di
// sekitar wasit; gerakannya harus berbeda-beda supaya hidup).
//
// Murni & deterministik: posisi tujuan dihitung dari waktu (tick), posisi pemain saat ini,
// stat psikologis, dan "irama" pribadi tiap pemain (hash dari id). Tanpa rng, jadi
// menambah gerak tidak mengubah jalannya pertandingan.
//
// GAYA PERTIKAIAN
//   pemicu      : korban yang marah — maju menyeruduk pelaku, mundur, maju lagi
//   pelaku      : bertahan di tempat dan terdorong mundur; kalau panas ikut mendorong balik,
//                 kalau tenang mundur sambil mengangkat tangan
//   pendorong   : rekan yang panas — mencari satu lawan, mengitarinya, mendorong
//   pelerai     : rekan yang tenang — berdiri di depan rekannya yang panas, menghalangi
//   penarik     : memegang rekannya dari belakang dan menariknya menjauh
//   mondar-mandir: berjalan bolak-balik di pinggir keributan, sesekali mendekat
//
// FASE (progress 0 → 1, dihitung setelah semua yang terlibat sampai)
//   0,00–0,15 berkumpul & berhadapan
//   0,15–0,65 memanas: dorongan, kejar-kejaran kecil, kerumunan bergeser
//   0,65–1,00 dilerai: jarak pemicu–pelaku melebar, kerumunan bubar perlahan

import { normalizeStat } from './skill.js';
import { clampToPitch } from './pitch.js';

export const SCUFFLE_MOVE = Object.freeze({
  faceGap: 4, // meter antara pemicu & pelaku saat berhadapan (jersey digambar ~2,6 m)
  lungeDepth: 1.8, // meter: seberapa jauh pemicu menyeruduk
  pushBack: 0.8, // bagian seruduk yang mendorong pelaku mundur
  separateGap: 7, // jarak tambahan saat dilerai
  driftRadius: 3, // kerumunan bergeser di sekitar titik kejadian
  pairSwing: 0.6, // radian: poros pemicu–pelaku berputar pelan
  rivalGap: 3.3,
  rivalOrbit: 0.06, // radian/tick: pendorong mengitari lawannya
  blockerGap: 2.9,
  pullerGap: 3.2,
  pacerRadius: Object.freeze({ min: 7, max: 9.5 }),
  pacerSpeed: 0.03, // radian/tick
  periodMin: 16, // irama dorongan 1,6–3 detik
  periodRange: 14,
  minSpacing: 3.4, // meter: jarak minimum antar-sasaran supaya jersey tidak menumpuk
  arrivalRadius: 3.5, // meter dari sasarannya: dianggap sudah ikut berkumpul
});

export const PROTEST_MOVE = Object.freeze({
  gapNear: 2.6, // meter dari wasit saat maju menunjuk-nunjuk (jersey digambar ~2,6 m)
  gapFar: 3.8,
  crowdExtra: 2.5,
  sway: 0.35, // radian: bergeser ke kiri-kanan wasit
  arrivalRadius: 3,
});

const STYLES = ['pemicu', 'pelaku', 'pendorong', 'pelerai', 'penarik', 'mondar-mandir'];
export const SCUFFLE_STYLES = Object.freeze(STYLES);

// Hash string → bilangan 0..1 (FNV-1a), untuk irama pribadi pemain.
export function hash01(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Seruduk: naik cepat (25% periode), turun pelan. 0..1.
export function lungeWave(t, period, offset) {
  const u = ((((t + offset) % period) + period) % period) / period;
  return u < 0.25 ? u / 0.25 : (1 - u) / 0.75;
}

const heat = (p) => normalizeStat(p.skills.temperamen) * (0.5 + (p.discipline?.agitation ?? 0));
const calm = (p) => normalizeStat(p.skills.ketenangan);

// Bagi peran tiap peserta pertikaian. Mengembalikan { [id]: gaya }.
// Korban = pemicu, pelaku = pelaku. Rekan: paling panas jadi pendorong, paling tenang jadi
// pelerai (rekan pemicu/pelaku), satu penarik bila timnya punya inti, sisanya mondar-mandir.
// Dijamin beragam: tiap gaya pembantu paling banyak satu per tim, kecuali mondar-mandir.
export function assignScuffleStyles(scuffle, players) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const styles = {};
  const offenderId = scuffle.ids[1];
  styles[scuffle.instigatorId] = 'pemicu';
  if (offenderId) styles[offenderId] = 'pelaku';
  const teams = new Map();
  for (const id of scuffle.ids) {
    if (styles[id]) continue;
    const p = byId.get(id);
    if (!p) continue;
    if (!teams.has(p.teamId)) teams.set(p.teamId, []);
    teams.get(p.teamId).push(p);
  }
  for (const members of teams.values()) {
    const left = [...members];
    const take = (score) => {
      if (left.length === 0) return null;
      left.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      return left.shift();
    };
    const pusher = take(heat);
    if (pusher) styles[pusher.id] = heat(pusher) > 0.25 ? 'pendorong' : 'mondar-mandir';
    const peacemaker = take(calm);
    if (peacemaker) styles[peacemaker.id] = 'pelerai';
    const puller = take((p) => -heat(p));
    // Variasi: tidak setiap kerumunan punya penarik; kadang dia hanya mondar-mandir.
    if (puller) styles[puller.id] = hash01(puller.id + scuffle.instigatorId) < 0.6 ? 'penarik' : 'mondar-mandir';
    for (const p of left) styles[p.id] = 'mondar-mandir';
  }
  return styles;
}

function unit(dx, dy) {
  const d = Math.hypot(dx, dy);
  return d > 1e-6 ? { x: dx / d, y: dy / d, d } : { x: 1, y: 0, d: 0 };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Posisi tujuan peserta pertikaian. Map id → titik.
//   scuffle : { ids, instigatorId, styles }
//   spot    : titik kejadian
//   players : posisi pemain saat ini (yang sudah dikeluarkan tidak ada)
//   t       : tick sejak jeda dimulai
//   progress: 0..1 (fase drama)
export function scuffleTargets(scuffle, spot, players, t, progress) {
  const M = SCUFFLE_MOVE;
  const byId = new Map(players.map((p) => [p.id, p]));
  const styles = scuffle.styles ?? assignScuffleStyles(scuffle, players);
  const present = scuffle.ids.filter((id) => byId.has(id));
  const targets = new Map();
  if (present.length === 0) return targets;

  const seed = hash01(scuffle.ids.join('|'));
  // Pusat kerumunan bergeser pelan (kerumunan "bergerak sebagai massa").
  const heating = smooth(0.1, 0.3, progress);
  const separating = smooth(0.62, 0.95, progress);
  const center = {
    x: spot.x + M.driftRadius * heating * Math.sin(t * 0.045 + seed * 6.28),
    y: spot.y + M.driftRadius * heating * Math.cos(t * 0.033 + seed * 4.1),
  };
  // Poros pemicu → pelaku.
  const axisAngle = seed * Math.PI * 2 + M.pairSwing * Math.sin(t * 0.025);
  const axis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
  const side = { x: -axis.y, y: axis.x };

  const rhythm = (id) => {
    const h = hash01(id);
    return {
      period: M.periodMin + Math.floor(h * M.periodRange),
      offset: Math.floor(h * 97),
      h,
    };
  };

  const instigator = byId.get(scuffle.instigatorId);
  const offender = byId.get(scuffle.ids[1]);
  const lunge = instigator ? lungeWave(t, rhythm(instigator.id).period, rhythm(instigator.id).offset) * heating * (1 - separating) : 0;
  // Pelaku panas mendorong balik (setengah periode kemudian); yang tenang mundur.
  const offenderHot = offender ? heat(offender) > 0.3 : false;
  const counter =
    offender && offenderHot ? lungeWave(t + 9, rhythm(offender.id).period, rhythm(offender.id).offset) * heating * (1 - separating) : 0;
  const gap = M.faceGap + M.separateGap * separating;
  // Seruduk pemicu mendorong seluruh pasangan sepanjang poros; dorong balik sebaliknya.
  const shift = M.lungeDepth * M.pushBack * lunge - M.lungeDepth * M.pushBack * counter;
  const pairMid = {
    x: center.x + axis.x * shift,
    y: center.y + axis.y * shift,
  };
  const instigatorSpot = {
    x: pairMid.x - axis.x * (gap / 2) + axis.x * M.lungeDepth * lunge * (1 - M.pushBack),
    y: pairMid.y - axis.y * (gap / 2) + axis.y * M.lungeDepth * lunge * (1 - M.pushBack),
  };
  const backOff = offender && !offenderHot ? 1.5 * heating : 0; // yang tenang mundur sambil angkat tangan
  const offenderSpot = {
    x: pairMid.x + axis.x * (gap / 2 + backOff) - axis.x * M.lungeDepth * counter * (1 - M.pushBack),
    y: pairMid.y + axis.y * (gap / 2 + backOff) - axis.y * M.lungeDepth * counter * (1 - M.pushBack),
  };
  if (instigator) targets.set(instigator.id, instigatorSpot);
  if (offender) targets.set(offender.id, offenderSpot);
  // Titik "inti" tiap tim: pemain inti dari tim itu (untuk pelerai & penarik).
  const coreOf = (teamId) => {
    if (instigator && instigator.teamId === teamId) return { spot: instigatorSpot, toward: offenderSpot };
    if (offender && offender.teamId === teamId) return { spot: offenderSpot, toward: instigatorSpot };
    return null;
  };

  const pacerIndex = new Map();
  for (const id of present) {
    const style = styles[id];
    if (style === 'pemicu' || style === 'pelaku') continue;
    const p = byId.get(id);
    const r = rhythm(id);
    const core = coreOf(p.teamId);
    let target;
    if (style === 'pelerai' && core) {
      // Berdiri di depan rekannya (menghadap lawan), bergoyang menahan; saat dilerai ikut mundur.
      const dir = unit(core.toward.x - core.spot.x, core.toward.y - core.spot.y);
      // Menyerong ke samping (tidak tepat di tengah, tempat wasit menyela).
      const sideSign = r.h > 0.5 ? 1 : -1;
      const sway = sideSign * 3 + 1.0 * Math.sin(t * 0.09 + r.h * 6.28);
      const gapNow = M.blockerGap * 0.6 * (1 - 0.3 * lungeWave(t, r.period, r.offset) * heating);
      target = {
        x: core.spot.x + dir.x * gapNow - dir.y * sway,
        y: core.spot.y + dir.y * gapNow + dir.x * sway,
      };
    } else if (style === 'penarik' && core) {
      // Di belakang rekannya, menarik menjauh: makin lama makin jauh dari lawan.
      const dir = unit(core.spot.x - core.toward.x, core.spot.y - core.toward.y);
      const tug = M.pullerGap + 0.8 * Math.sin(t * 0.12 + r.h * 6.28) * heating + 2.5 * separating;
      target = { x: core.spot.x + dir.x * tug, y: core.spot.y + dir.y * tug };
    } else if (style === 'pendorong') {
      // Cari lawan terdekat di kerumunan, kitari, seruduk.
      const rivals = present.map((rid) => byId.get(rid)).filter((q) => q.teamId !== p.teamId);
      const rival = rivals.sort(
        (a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y) || a.id.localeCompare(b.id),
      )[0];
      if (rival) {
        const base = Math.atan2(p.y - rival.y, p.x - rival.x);
        const orbit = base + M.rivalOrbit * (r.h > 0.5 ? 1 : -1);
        const reach = M.rivalGap - 1.1 * lungeWave(t, r.period, r.offset) * heating + 3 * separating;
        target = {
          x: rival.x + Math.cos(orbit) * reach,
          y: rival.y + Math.sin(orbit) * reach,
        };
      }
    }
    if (!target) {
      // Mondar-mandir: berjalan di busur pinggir kerumunan, berhenti sejenak, sesekali mendekat.
      const k = pacerIndex.size;
      pacerIndex.set(id, k);
      const radius = M.pacerRadius.min + (M.pacerRadius.max - M.pacerRadius.min) * r.h + 2 * separating;
      const walking = Math.max(0, Math.sin(t * 0.06 + r.h * 9)); // 0 = berhenti
      const dirSign = r.h > 0.5 ? 1 : -1;
      const angle = r.h * Math.PI * 2 + k * 1.3 + dirSign * M.pacerSpeed * t * (0.4 + walking);
      const stepIn = 2.5 * Math.max(0, Math.sin(t * 0.05 + r.h * 13)) ** 3 * heating;
      target = {
        x: center.x + Math.cos(angle) * (radius - stepIn),
        y: center.y + Math.sin(angle) * (radius - stepIn),
      };
    }
    targets.set(id, target);
  }
  // Sedikit menjauhkan pasangan yang terlalu dekat (dua jersey tidak menumpuk di satu titik).
  const ids = [...targets.keys()];
  for (let pass = 0; pass < 4; pass += 1)
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = targets.get(ids[i]);
        const b = targets.get(ids[j]);
        const u = unit(b.x - a.x, b.y - a.y);
        if (u.d < M.minSpacing) {
          const push = (M.minSpacing - u.d) / 2;
          targets.set(ids[i], { x: a.x - u.x * push, y: a.y - u.y * push });
          targets.set(ids[j], { x: b.x + u.x * push, y: b.y + u.y * push });
        }
      }
    }
  for (const [id, pt] of targets) targets.set(id, clampToPitch(pt, 0.5));
  return targets;
}

// Tempat wasit saat pertikaian memanas: di samping poros pemicu–pelaku, menyela di antara mereka.
export function scuffleRefereeSpot(scuffle, players, spot) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const a = byId.get(scuffle.instigatorId);
  const b = byId.get(scuffle.ids[1]);
  if (!a || !b) return scuffleCenter(scuffle, players, spot);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const u = unit(b.x - a.x, b.y - a.y);
  return clampToPitch({ x: mid.x - u.y * 2.6, y: mid.y + u.x * 2.6 }, 1);
}

// Pusat kerumunan pertikaian dari posisi peserta yang masih di lapangan (untuk wasit & gambar).
export function scuffleCenter(scuffle, players, fallback) {
  const members = players.filter((p) => scuffle.ids.includes(p.id));
  if (members.length === 0) return fallback;
  return {
    x: members.reduce((s, p) => s + p.x, 0) / members.length,
    y: members.reduce((s, p) => s + p.y, 0) / members.length,
  };
}

// Pemrotes & pendebat: maju-mundur di depan wasit (menunjuk-nunjuk), bergeser ke kiri-kanan,
// masing-masing dengan irama sendiri. side: +1 (pemrotes) / −1 (pendebat).
//   crowded: ada pertikaian di sekitar wasit → pemrotes berdiri lebih jauh supaya tidak menumpuk.
export function protestTarget(id, index, side, referee, t, crowded = false) {
  const M = PROTEST_MOVE;
  const h = hash01(id);
  const period = 14 + Math.floor(h * 12);
  const push = lungeWave(t, period, Math.floor(h * 50));
  const gap = M.gapFar - (M.gapFar - M.gapNear) * push + (crowded ? M.crowdExtra : 0);
  const baseAngle = side > 0 ? Math.PI / 2 + (index - 1) * 1.0 : -Math.PI / 2 + (index - 0.5) * 1.2;
  const angle = baseAngle + M.sway * Math.sin(t * (0.05 + 0.04 * h) + h * 6.28);
  return clampToPitch(
    {
      x: referee.x + Math.cos(angle) * gap,
      y: referee.y + Math.sin(angle) * gap,
    },
    0.5,
  );
}

export function validateScuffleStyles(styles) {
  return Object.entries(styles ?? {})
    .filter(([, s]) => !STYLES.includes(s))
    .map(([id, s]) => `gaya pertikaian tidak dikenal untuk ${id}: ${s}`);
}
