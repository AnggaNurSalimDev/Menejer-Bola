// Kartu merah (tahap 7c): pemain keluar lapangan, tim bermain dengan 10 (atau kurang) orang.
//
// 1. Pemain yang dikartu merah dipindah dari daftar pemain ke daftar `sentOff`. Ia tidak lagi
//    ikut bermain; ia berjalan pelan ke pinggir lapangan (hanya tampilan) lalu hilang.
// 2. Bentuk tim ditambal (repairShape): lubang di satu lini diisi pemain dari lini di atasnya
//    yang posisinya paling dekat, berantai sampai lini depan. Jadi tim 10 orang mengorbankan
//    penyerang, seperti pelatih sungguhan (4-4-2 kehilangan bek → 4-4-1).
// 3. Kalau kiper yang dikeluarkan, satu bek menjadi kiper darurat dengan stat kiper rendah.

import { PITCH } from './pitch.js';
import { deriveMovementProfile, stepBody } from './movement.js';

export const SENDOFF = Object.freeze({
  walkSpeed: 0.45, // bagian dari laju maksimal: berjalan cepat keluar (±3,3 m/s)
  waitTicks: 70, // jeda bola mati menunggu pemain keluar paling lama 7 dtk (lalu dianggap sudah keluar)
  goalMouthClear: 12, // meter dari tengah gawang: jangan keluar lewat gawang, pakai garis samping
  emergencyKeeperStat: 4, // stat kiper bek yang dipaksa jaga gawang
  minPlayers: 7, // aturan: laga dihentikan bila kurang dari 7 (di sini dijaga lewat invariant)
});

const LINES = Object.freeze([
  { name: 'DEF', max: 0.24 },
  { name: 'MID', max: 0.4 },
  { name: 'FW', max: 1 },
]);

const lineOf = (slot) => LINES.findIndex((l) => slot.depth <= l.max);

// Lubang di lini `line` (slot kosong). Isi dari lini di atasnya, berantai.
// teammates: pemain lapangan yang tersisa (bukan kiper). Mengembalikan Map id → { slot, role }.
export function repairShape(teammates, vacated) {
  const changes = new Map();
  const current = new Map(teammates.map((p) => [p.id, { slot: p.slot, role: p.role }]));
  let hole = { slot: vacated.slot, role: vacated.role };
  let line = lineOf(hole.slot);
  while (line < LINES.length - 1) {
    const above = teammates.filter((p) => lineOf(current.get(p.id).slot) === line + 1);
    if (above.length === 0) {
      line += 1;
      continue;
    }
    // Yang paling dekat jalurnya dengan lubang turun mengisinya.
    above.sort(
      (a, b) =>
        Math.abs(current.get(a.id).slot.lane - hole.slot.lane) - Math.abs(current.get(b.id).slot.lane - hole.slot.lane) ||
        a.id.localeCompare(b.id),
    );
    const mover = above[0];
    const left = current.get(mover.id);
    current.set(mover.id, { slot: hole.slot, role: hole.role });
    changes.set(mover.id, { slot: hole.slot, role: hole.role });
    hole = left;
    line += 1;
  }
  // Lini paling atas kini kurang satu: rapatkan ke tengah dengan jarak antarpemain semula.
  const top = teammates.filter((p) => lineOf(current.get(p.id).slot) === lineOf(hole.slot));
  if (top.length > 0) {
    const lanes = [...top.map((p) => current.get(p.id).slot.lane), hole.slot.lane].sort((a, b) => a - b);
    const spacing = lanes.length > 1 ? (lanes[lanes.length - 1] - lanes[0]) / (lanes.length - 1) : 0;
    const center = lanes.reduce((s, v) => s + v, 0) / lanes.length;
    top
      .sort((a, b) => current.get(a.id).slot.lane - current.get(b.id).slot.lane || a.id.localeCompare(b.id))
      .forEach((p, i) => {
        const now = current.get(p.id);
        const lane = top.length === 1 ? 0.5 : center + (i - (top.length - 1) / 2) * spacing;
        const next = {
          slot: { ...now.slot, lane },
          role: top.length === 1 && ['RW', 'LW'].includes(now.role) ? 'ST' : now.role,
        };
        current.set(p.id, next);
        changes.set(p.id, next);
      });
  }
  return changes;
}

// Kiper dikeluarkan: bek tengah (atau pemain paling belakang) menjadi kiper darurat.
export function emergencyKeeper(teammates, keeper) {
  const pool = teammates.filter((p) => p.role !== 'GK');
  if (pool.length === 0) return null;
  const pick = [...pool].sort(
    (a, b) => a.slot.depth - b.slot.depth || Math.abs(a.slot.lane - 0.5) - Math.abs(b.slot.lane - 0.5) || a.id.localeCompare(b.id),
  )[0];
  const s = SENDOFF.emergencyKeeperStat;
  const skills = { ...pick.skills, refleks: s, penempatan: s, tangkapan: s };
  return {
    player: {
      ...pick,
      role: 'GK',
      slot: keeper.slot,
      skills,
      profile: deriveMovementProfile(skills),
      emergencyKeeper: true,
    },
    vacated: { slot: pick.slot, role: pick.role },
  };
}

// Keluarkan pemain dari daftar. Mengembalikan { players, sentOff } baru.
//   removals: Map id → { card, reason }
export function applySendOffs(players, sentOff, removals, tick) {
  if (removals.size === 0) return { players, sentOff };
  let list = players;
  const out = [...sentOff];
  for (const [id, info] of removals) {
    const gone = list.find((p) => p.id === id);
    if (!gone) continue;
    list = list.filter((p) => p.id !== id);
    let mates = list.filter((p) => p.teamId === gone.teamId && p.role !== 'GK');
    let vacated = { slot: gone.slot, role: gone.role };
    if (gone.role === 'GK') {
      const swap = emergencyKeeper(mates, gone);
      if (swap) {
        list = list.map((p) => (p.id === swap.player.id ? swap.player : p));
        vacated = swap.vacated;
        mates = list.filter((p) => p.teamId === gone.teamId && p.role !== 'GK');
      }
    }
    const changes = repairShape(mates, vacated);
    list = list.map((p) => (changes.has(p.id) ? { ...p, ...changes.get(p.id) } : p));
    out.push({
      id: gone.id,
      teamId: gone.teamId,
      number: gone.number,
      name: gone.name,
      shortName: gone.shortName,
      role: gone.role,
      skills: gone.skills,
      profile: gone.profile,
      discipline: gone.discipline,
      x: gone.x,
      y: gone.y,
      vx: gone.vx,
      vy: gone.vy,
      card: info.card,
      reason: info.reason,
      tick,
      walking: true,
      exit: exitSpot(gone),
    });
  }
  return { players: list, sentOff: out };
}

// Titik keluar: garis samping atas, dekat garis tengah (lorong ruang ganti).
// Aturan IFAB Law 3 (2019): pemain yang diganti / dikartu merah keluar lewat TITIK GARIS TERDEKAT
// (masukan 31 Okt: dulu berjalan pelan ke garis tengah sambil laga berjalan — "hantu" di lapangan).
// Garis gawang hanya dipakai bila tidak di depan gawang.
export function exitSpot(p) {
  const mid = PITCH.width / 2;
  const options = [
    { d: p.y, pt: { x: p.x, y: 0 } },
    { d: PITCH.width - p.y, pt: { x: p.x, y: PITCH.width } },
  ];
  if (Math.abs(p.y - mid) > SENDOFF.goalMouthClear) {
    options.push({ d: p.x, pt: { x: 0, y: p.y } }, { d: PITCH.length - p.x, pt: { x: PITCH.length, y: p.y } });
  }
  options.sort((a, b) => a.d - b.d);
  return options[0].pt;
}

export function stillLeaving(list) {
  return (list ?? []).some((p) => p.walking);
}

// Gerakkan pemain yang sedang berjalan keluar (satu tick).
export function stepSentOff(sentOff, dt) {
  if (!sentOff.some((p) => p.walking)) return sentOff;
  return sentOff.map((p) => {
    if (!p.walking) return p;
    const target = p.exit ?? exitSpot(p);
    const body = stepBody(p, target, dt, { speedScale: SENDOFF.walkSpeed });
    const arrived = Math.hypot(body.x - target.x, body.y - target.y) < 1;
    return { ...p, ...body, walking: !arrived };
  });
}

export function validateSentOff(sentOff, players) {
  const errors = [];
  const present = new Set(players.map((p) => p.id));
  for (const p of sentOff) {
    if (present.has(p.id)) errors.push(`${p.id} dikartu merah tetapi masih bermain`);
    if (!['secondYellow', 'red'].includes(p.card)) errors.push(`${p.id}: kartu keluar tidak dikenal ${p.card}`);
  }
  if (new Set(sentOff.map((p) => p.id)).size !== sentOff.length) errors.push('pemain dikartu merah ganda');
  return errors;
}
