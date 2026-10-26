# Menejer Bola

Game manager sepak bola berbasis web. Atur tim dan taktik, lalu tonton pertandingan yang disimulasikan secara langsung dari sudut pandang atas. Setiap pemain tampil sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak dengan "otak" yang dibangun dari hitungan murni, lengkap dengan blunder manusiawi sesuai stat dan kondisi psikologisnya.

Proyek ini dibuat untuk senang-senang.

## Status

- Tahap 1 selesai: lapangan dan 22 jersey (nomor + nama) di posisi kick-off.
- Tahap 2 selesai (uji gerak): bola bergerak sendiri secara acak ber-seed, formasi bergeser mengikuti bola dengan lini yang tetap terpisah, pemain bergerak dengan inersia (kecepatan, akselerasi, dan kelincahan dari stat). Kontrol: jeda, kecepatan 1×–8×, ulang dengan seed baru.
- Berikutnya tahap 3: pemain menghindari rekan agar tidak saling tumpuk, dan hanya 1–2 pemain per tim yang menekan bola.

## Menjalankan

```bash
npm install
npm run dev      # buka di browser
npm run check    # uji engine tanpa tampilan
npm run build    # build produksi
```

## Struktur

- `src/engine/` — simulasi murni (meter, tanpa tampilan), 10 tick per detik:
  - `simulation.js` — memajukan pertandingan satu tick
  - `shape.js` — lapisan keputusan: posisi jangkar formasi yang mengikuti bola
  - `movement.js` — lapisan gerak: tubuh pemain dengan inersia
  - `ball.js` — bola "tangan dewa" (sementara, sampai pemain bisa menendang di tahap 4)
  - `state.js`, `teams.js`, `formations.js`, `stats.js`, `pitch.js`, `rng.js`
- `src/render/` — menggambar state ke canvas dan menghaluskan gerakan di antara tick. Hanya membaca state, tidak pernah mengubahnya.
- `src/components/` — komponen React untuk UI.
- `scripts/check-engine.js` — pemeriksaan invariant engine.

## Dokumen penting

Arah, batasan, logika gerak, statistik pemain, dan urutan pengembangan ada di [docs/dokumen-arah-game.md](docs/dokumen-arah-game.md). Baca dokumen itu sebelum menambah fitur.
