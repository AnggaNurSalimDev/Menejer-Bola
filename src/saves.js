// Simpanan karier (14 Nov, permintaan pengguna: sistem save di localStorage).
//
//   'menejer-bola:simpan:v1' = { version: 1, last: nomor slot | null,
//                                slots: [ { savedAt, league } | null ] × SLOTS }
//
// Setiap slot berisi liga lengkap (league.js, sudah divalidasi saat dimuat). Liga lama dari versi
// sebelum menu utama ('menejer-bola:liga:v1') dipindah ke slot 1 sekali, lalu kunci lamanya dihapus.
// `storage` bisa diganti (tes); semua akses dibungkus try/catch — penyimpanan bisa tidak tersedia.

import { parseLeague, leagueErrors, clubById } from './engine/league.js';

export const SLOTS = 3;
export const SAVE_KEY = 'menejer-bola:simpan:v1';
const OLD_LEAGUE_KEY = 'menejer-bola:liga:v1';

const defaultStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const empty = () => ({ version: 1, last: null, slots: Array(SLOTS).fill(null) });

// Baca semua slot. Slot yang rusak dikosongkan dan dilaporkan di `broken`.
export function readSaves(storage = defaultStorage()) {
  const out = { ...empty(), broken: [], available: Boolean(storage) };
  if (!storage) return out;
  let raw = null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { ...out, available: false };
  }
  if (raw) {
    try {
      const data = JSON.parse(raw);
      const slots = Array.isArray(data?.slots) ? data.slots : [];
      out.slots = Array.from({ length: SLOTS }, (_, i) => {
        const s = slots[i];
        if (!s) return null;
        const league = parseLeague(JSON.stringify(s.league));
        if (!league) {
          out.broken.push(i);
          return null;
        }
        return { savedAt: Number.isFinite(s.savedAt) ? s.savedAt : 0, league };
      });
      out.last = Number.isInteger(data?.last) && out.slots[data.last] ? data.last : null;
    } catch {
      out.broken.push(-1);
    }
  }
  // Migrasi sekali: liga sebelum ada menu utama → slot kosong pertama.
  try {
    const old = storage.getItem(OLD_LEAGUE_KEY);
    if (old) {
      const league = parseLeague(old);
      const free = out.slots.findIndex((s) => s === null);
      if (league && free >= 0) {
        out.slots[free] = { savedAt: Date.now(), league };
        out.last = out.last ?? free;
        if (writeAll(out, storage)) storage.removeItem(OLD_LEAGUE_KEY);
      } else if (!league) storage.removeItem(OLD_LEAGUE_KEY);
    }
  } catch {
    // migrasi gagal: biarkan kunci lama, coba lagi lain kali
  }
  return out;
}

function writeAll(saves, storage) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, last: saves.last, slots: saves.slots }));
    return true;
  } catch {
    return false; // penuh / ditolak
  }
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
  const saves = readSaves(storage);
  saves.slots[i] = { savedAt: Date.now(), league };
  saves.last = i;
  return writeAll(saves, storage);
}

export function deleteSlot(i, storage = defaultStorage()) {
  checkSlot(i);
  if (!storage) return false;
  const saves = readSaves(storage);
  saves.slots[i] = null;
  if (saves.last === i) saves.last = saves.slots.findIndex(Boolean) >= 0 ? saves.slots.findIndex(Boolean) : null;
  return writeAll(saves, storage);
}

// Ringkasan untuk daftar slot di menu.
export function slotSummary(slot) {
  if (!slot) return null;
  const { league } = slot;
  const club = clubById(league, league.userClubId);
  return {
    clubName: club.name,
    managerName: league.profile.managerName,
    logo: league.profile.logo,
    season: league.season,
    week: Math.min(league.week + 1, league.fixtures.length),
    weeks: league.fixtures.length,
    savedAt: slot.savedAt,
  };
}
