// Laju simulasi. Tampilan berjalan ~60fps dan menghaluskan gerakan
// di antara tick (interpolasi), jadi simulasi tidak perlu secepat itu.
export const TICK_RATE = 10; // tick per detik
export const DT = 1 / TICK_RATE; // detik per tick

// Lapisan keputusan berjalan lebih jarang daripada lapisan gerak
// (docs/dokumen-arah-game.md, logika gerak prinsip 3).
export const DECISION_INTERVAL_TICKS = 3;
