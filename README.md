# Menejer Bola

Game manager sepak bola berbasis web. Atur tim dan taktik, lalu tonton pertandingan yang disimulasikan secara langsung dari sudut pandang atas. Setiap pemain tampil sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak dengan "otak" yang dibangun dari hitungan murni, lengkap dengan blunder manusiawi sesuai stat dan kondisi psikologisnya.

Proyek ini dibuat untuk senang-senang.

## Status

Tahap 1 selesai: lapangan dan 22 jersey (nomor + nama) di posisi kick-off. Berikutnya tahap 2: bola bergerak, formasi bergeser mengikuti bola, pemain bergerak dengan inersia.

## Menjalankan

```bash
npm install
npm run dev      # buka di browser
npm run check    # uji engine tanpa tampilan
npm run build    # build produksi
```

## Struktur

- `src/engine/` — simulasi murni (meter, tanpa tampilan): lapangan, formasi, stat, tim fiktif, state pertandingan, angka acak ber-seed.
- `src/render/` — menggambar state ke canvas. Hanya membaca state, tidak pernah mengubahnya.
- `src/components/` — komponen React untuk UI.
- `scripts/check-engine.js` — pemeriksaan invariant engine.

## Dokumen penting

Arah, batasan, logika gerak, statistik pemain, dan urutan pengembangan ada di [docs/dokumen-arah-game.md](docs/dokumen-arah-game.md). Baca dokumen itu sebelum menambah fitur.
