// Generator angka acak dengan seed (algoritma mulberry32).
// Seed yang sama selalu menghasilkan urutan angka yang sama,
// sehingga pertandingan bisa diulang persis untuk melacak bug.

export function createRng(seed) {
  if (!Number.isInteger(seed)) {
    throw new TypeError(`createRng: seed harus bilangan bulat, dapat ${seed}`);
  }

  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(min, max) {
    if (!(max >= min)) throw new RangeError(`range: max (${max}) < min (${min})`);
    return min + next() * (max - min);
  }

  function int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int: rentang tidak valid [${min}, ${max}]`);
    }
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick(list) {
    if (!Array.isArray(list) || list.length === 0) {
      throw new RangeError('pick: daftar kosong');
    }
    return list[Math.floor(next() * list.length)];
  }

  // Angka acak berdistribusi normal (Box–Muller): kebanyakan dekat 0,
  // sesekali jauh. Cocok untuk meleset: kebanyakan tipis, kadang parah.
  function normal(mean = 0, stdDev = 1) {
    if (!(stdDev >= 0)) throw new RangeError(`normal: stdDev tidak valid ${stdDev}`);
    const u = Math.max(next(), Number.EPSILON);
    const v = next();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // true dengan peluang p.
  function chance(p) {
    if (!(p >= 0 && p <= 1)) throw new RangeError(`chance: peluang tidak valid ${p}`);
    return next() < p;
  }

  return { next, range, int, pick, normal, chance };
}
