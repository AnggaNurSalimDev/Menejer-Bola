// Simpanan karier (14 Nov; v2 15 Nov untuk dunia 3 kasta).
//
//   v2:  'menejer-bola:simpan:v2'          = { version: 2, last, meta: [ { savedAt, summary } | null ] × SLOTS }
//        'menejer-bola:simpan:v2:slot<i>'  = liga padat (packLeague) — satu kunci per slot, supaya menulis
//                                            satu slot tidak perlu membaca & menulis ulang slot lain
//   v1:  'menejer-bola:simpan:v1' (semua slot dalam satu kunci) dan 'menejer-bola:liga:v1' (sebelum
//        menu utama) dipindah ke v2 sekali saat dibaca, lalu kunci lamanya dihapus.
//
// readSaves() hanya membaca ringkasan; liga lengkap dimuat saat `slot.league` diakses (malas).
// `storage` bisa diganti (tes); semua akses dibungkus try/catch — penyimpanan bisa tidak tersedia/penuh.

import { parseLeague, leagueErrors, clubById, packLeague, SEASON_ROUNDS } from './engine/league.js';

export const SLOTS = 3;
export const SAVE_KEY = 'menejer-bola:simpan:v1'; // kunci lama (dibaca untuk migrasi)
export const INDEX_KEY = 'menejer-bola:simpan:v2';
export const slotKey = (i) => `${INDEX_KEY}:slot${i}`;
const OLD_LEAGUE_KEY = 'menejer-bola:liga:v1';

const defaultStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function summaryOf(league) {
  const club = clubById(league, league.userClubId);
  return {
    clubName: club.name,
    managerName: league.profile.managerName,
    logo: league.profile.logo,
    tier: club.tier,
    season: league.season,
    week: Math.min(league.week + 1, SEASON_ROUNDS),
    weeks: SEASON_ROUNDS,
  };
}

// Slot dengan liga yang dimuat saat pertama kali dibutuhkan.
function lazySlot(storage, i, meta, out) {
  let cache;
  return {
    savedAt: meta.savedAt ?? 0,
    summary: meta.summary,
    get league() {
      if (cache === undefined) {
        let text = null;
        try {
          text = storage.getItem(slotKey(i));
        } catch {
          text = null;
        }
        cache = parseLeague(text);
        if (!cache && out) out.broken.push(i);
      }
      return cache;
    },
  };
}

function readIndex(storage) {
  try {
    const raw = storage.getItem(INDEX_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d?.version !== 2 || !Array.isArray(d.meta)) return null;
    return d;
  } catch {
    return null;
  }
}

function writeIndex(storage, last, meta) {
  storage.setItem(INDEX_KEY, JSON.stringify({ version: 2, last, meta }));
}

// Pindahkan simpanan v1 (dan liga sebelum menu utama) ke v2. Mengembalikan nomor slot yang rusak.
function migrateV1(storage) {
  const broken = [];
  let raw = null;
  let old = null;
  try {
    raw = storage.getItem(SAVE_KEY);
    old = storage.getItem(OLD_LEAGUE_KEY);
  } catch {
    return broken;
  }
  if (!raw && !old) return broken;
  const index = readIndex(storage) ?? { version: 2, last: null, meta: Array(SLOTS).fill(null) };
  const meta = [...index.meta];
  let last = index.last;
  const put = (i, league, savedAt) => {
    storage.setItem(slotKey(i), JSON.stringify(packLeague(league)));
    meta[i] = { savedAt, summary: summaryOf(league) };
  };
  try {
    if (raw) {
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        broken.push(-1);
      }
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      for (let i = 0; i < SLOTS; i += 1) {
        const s = slots[i];
        if (!s || meta[i]) continue;
        const league = parseLeague(JSON.stringify(s.league));
        if (!league) {
          broken.push(i);
          continue;
        }
        put(i, league, Number.isFinite(s.savedAt) ? s.savedAt : 0);
      }
      if (Number.isInteger(data?.last) && meta[data.last]) last = last ?? data.last;
    }
    if (old) {
      const league = parseLeague(old);
      const free = meta.findIndex((m) => m === null);
      if (league && free >= 0) {
        put(free, league, Date.now());
        last = last ?? free;
      }
    }
    writeIndex(storage, last, meta);
    storage.removeItem(SAVE_KEY);
    storage.removeItem(OLD_LEAGUE_KEY);
  } catch {
    // penyimpanan penuh: biarkan kunci lama, coba lagi lain kali
  }
  return broken;
}

export function readSaves(storage = defaultStorage()) {
  const out = { version: 2, last: null, slots: Array(SLOTS).fill(null), broken: [], available: Boolean(storage) };
  if (!storage) return out;
  try {
    storage.getItem(INDEX_KEY);
  } catch {
    return { ...out, available: false };
  }
  out.broken.push(...migrateV1(storage));
  const index = readIndex(storage);
  if (!index) return out;
  out.slots = Array.from({ length: SLOTS }, (_, i) => {
    const m = index.meta[i];
    return m && m.summary ? lazySlot(storage, i, m, out) : null;
  });
  out.last = Number.isInteger(index.last) && out.slots[index.last] ? index.last : null;
  return out;
}

function checkSlot(i) {
  if (!Number.isInteger(i) || i < 0 || i >= SLOTS) throw new RangeError(`slot tidak valid: ${i}`);
}

// Simpan liga ke slot i (dan jadikan slot terakhir). Mengembalikan true bila berhasil.
export function writeSlot(i, league, storage = defaultStorage()) {
  checkSlot(i);
  const e = leagueErrors(league);
  if (e.length) throw new Error(`writeSlot: liga tidak valid: ${e[0]}`);
  if (!storage) return false;
  try {
    const index = readIndex(storage) ?? { version: 2, last: null, meta: Array(SLOTS).fill(null) };
    const meta = [...index.meta];
    storage.setItem(slotKey(i), JSON.stringify(packLeague(league)));
    meta[i] = { savedAt: Date.now(), summary: summaryOf(league) };
    writeIndex(storage, i, meta);
    return true;
  } catch {
    return false; // penuh / ditolak
  }
}

export function deleteSlot(i, storage = defaultStorage()) {
  checkSlot(i);
  if (!storage) return false;
  try {
    const index = readIndex(storage) ?? { version: 2, last: null, meta: Array(SLOTS).fill(null) };
    const meta = [...index.meta];
    meta[i] = null;
    storage.removeItem(slotKey(i));
    const first = meta.findIndex(Boolean);
    writeIndex(storage, index.last === i ? (first >= 0 ? first : null) : index.last, meta);
    return true;
  } catch {
    return false;
  }
}

// Ringkasan untuk daftar slot di menu.
export function slotSummary(slot) {
  if (!slot) return null;
  return { ...slot.summary, savedAt: slot.savedAt };
}
