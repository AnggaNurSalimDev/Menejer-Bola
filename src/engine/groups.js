// Kelompok (2 Nov, ide pengguna — trio kecil ala PSG / "relationism"):
//
//   KELOMPOK = { id, zone, memberIds (2–4 pemain lapangan) }
//   AKTIF    bola berada di zona kelompok DAN dipegang SIAPA SAJA anggotanya (pilihan B pengguna)
//   EFEK     tahap 1 — kecenderungan, bukan paksaan:
//              • rekan sekelompok lebih disukai sebagai penerima operan (bobot operan)
//              • pemain ketiga: bola dari rekan sekelompok → lebih suka diteruskan ke anggota LAIN,
//                bukan dikembalikan ke pemberi
//            Operan yang jelas berbahaya tetap ditolak (syarat "aman" tidak berubah).
//   KALAH    dari skema yang sedang berjalan (skema = perintah yang lebih spesifik)
//
// Modul murni. Daftar zona disalin (bukan diimpor) seperti scripts.js; tes mencocokkannya.

export const GROUP_ZONES = Object.freeze(['sendiriKiri', 'sendiriKanan', 'lawanKiri', 'lawanKanan']);

export const GROUP = Object.freeze({
  minMembers: 2,
  maxMembers: 4,
  maxPerZone: 4,
  maxGroups: 16,
  // Satuan sama dengan nilai operan di passing.js (keamanan 1,0 per detik selisih; balik ke pemberi −0,6).
  passBonus: 0.5,
  thirdManBonus: 0.3,
});

export function groupErrors(groups) {
  const errors = [];
  if (!Array.isArray(groups)) return ['kelompok harus daftar'];
  if (groups.length > GROUP.maxGroups) errors.push(`paling banyak ${GROUP.maxGroups} kelompok`);
  const ids = new Set();
  const perZone = {};
  groups.forEach((g, i) => {
    const at = `kelompok ${i + 1}`;
    if (!g || typeof g !== 'object') {
      errors.push(`${at}: bukan objek`);
      return;
    }
    if (typeof g.id !== 'string' || !g.id) errors.push(`${at}: id kosong`);
    else if (ids.has(g.id)) errors.push(`${at}: id ganda ${g.id}`);
    ids.add(g.id);
    if (!GROUP_ZONES.includes(g.zone)) errors.push(`${at}: zona tidak dikenal ${g.zone}`);
    else perZone[g.zone] = (perZone[g.zone] ?? 0) + 1;
    const m = g.memberIds;
    if (!Array.isArray(m) || m.some((x) => typeof x !== 'string' || !x)) errors.push(`${at}: anggota tidak valid`);
    else if (new Set(m).size !== m.length) errors.push(`${at}: anggota ganda`);
    else if (m.length < GROUP.minMembers || m.length > GROUP.maxMembers) errors.push(`${at}: anggota harus ${GROUP.minMembers}–${GROUP.maxMembers} pemain`);
  });
  for (const [z, n] of Object.entries(perZone)) if (n > GROUP.maxPerZone) errors.push(`zona ${z}: paling banyak ${GROUP.maxPerZone} kelompok`);
  return errors;
}

// Pemain diganti: id lama → id baru di semua kelompok.
export function renameInGroups(groups, outId, inId) {
  return (groups ?? []).map((g) => ({ ...g, memberIds: g.memberIds.map((id) => (id === outId ? inId : id)) }));
}

// Kelompok aktif untuk pemegang bola di zona ini (kelompok pertama yang cocok), atau null.
export function activeGroup(groups, zone, holderId) {
  if (!zone || !holderId) return null;
  return (groups ?? []).find((g) => g.zone === zone && g.memberIds.includes(holderId)) ?? null;
}

// Tambahan nilai operan untuk penerima `receiverId` saat kelompok `group` aktif.
// previousOwnerId = pemberi operan ke pemegang bola sekarang (untuk pemain ketiga).
export function groupPassBonus(group, holderId, receiverId, previousOwnerId) {
  if (!group || receiverId === holderId || !group.memberIds.includes(receiverId)) return 0;
  const fromMate = previousOwnerId && previousOwnerId !== holderId && group.memberIds.includes(previousOwnerId);
  if (receiverId === previousOwnerId) return GROUP.passBonus; // balik ke pemberi: hanya bobot dasar (hukuman operan balik tetap berlaku)
  return GROUP.passBonus + (fromMate ? GROUP.thirdManBonus : 0);
}
