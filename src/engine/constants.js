// Laju simulasi. Tampilan berjalan ~60fps dan menghaluskan gerakan
// di antara tick (interpolasi), jadi simulasi tidak perlu secepat itu.
export const TICK_RATE = 10; // tick per detik
export const DT = 1 / TICK_RATE; // detik per tick

// Lapisan keputusan berjalan lebih jarang daripada lapisan gerak
// (docs/dokumen-arah-game.md, logika gerak prinsip 3).
export const DECISION_INTERVAL_TICKS = 3;

// Waktu sebelum pemain mulai bereaksi. Untuk sementara sama untuk semua
// pemain; di tahap noise, nilainya akan diturunkan dari stat Antisipasi.
export const REACTION_TIME = 0.3; // detik

// Jangkauan kaki: bola dalam jarak ini bisa dikuasai.
export const CONTROL_RADIUS = 1.2; // meter
// Kiper di kotak penaltinya sendiri boleh memakai tangan dan menjatuhkan diri.
export const KEEPER_REACH = 1.8; // meter

// Setelah menendang, pemain tidak bisa langsung menguasai bola lagi.
export const KICK_COOLDOWN_TICKS = 5;

// Durasi pertandingan (disepakati 27 Okt 2026, gaya FIFA):
// pemain bergerak dengan kecepatan nyata, tetapi satu babak hanya
// 5 menit waktu nyata, dan jam di layar berjalan 45 menit dalam waktu itu.
export const HALF_REAL_SECONDS = 5 * 60;
export const HALF_TICKS = HALF_REAL_SECONDS * TICK_RATE;
export const GAME_MINUTES_PER_HALF = 45;
export const PERIODS = Object.freeze(['first', 'halftime', 'second', 'fulltime']);
