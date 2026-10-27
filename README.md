# Menejer Bola

Game manager sepak bola berbasis web. Atur tim dan taktik, lalu tonton pertandingan yang disimulasikan secara langsung dari sudut pandang atas. Setiap pemain tampil sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak dengan "otak" yang dibangun dari hitungan murni, lengkap dengan blunder manusiawi sesuai stat dan kondisi psikologisnya.

Proyek ini dibuat untuk senang-senang.

## Status

- Tahap 1 selesai: lapangan dan 22 jersey (nomor + nama) di posisi kick-off.
- Tahap 2 selesai (uji gerak): bola bergerak sendiri secara acak ber-seed, formasi bergeser mengikuti bola dengan lini yang tetap terpisah, pemain bergerak dengan inersia (kecepatan, akselerasi, dan kelincahan dari stat). Kontrol: jeda, kecepatan 1×–8×, ulang dengan seed baru.
- Tahap 3 selesai (penguasaan & operan): bola hanya digerakkan pemain. Satu pemain per tim menjemput atau menekan bola, pemegang bola menggiring lalu mengoper ke rekan terbaik, lawan bisa memotong operan, tim melebar saat menyerang dan menjaga lawan per zona saat bertahan. Tampilan: tanda kuning di bawah pemegang bola, statistik penguasaan dan operan.
- Tahap 4 selesai (tembakan, gol & tekel): pemain menembak berdasarkan sudut, risiko blok, dan posisi kiper. Kiper menangkap atau menepis. Tekel ditentukan stat Tackling, Dribbling, dan Kekuatan. Gol memicu jeda dan kick-off ulang; bola keluar lewat garis gawang jadi tendangan gawang atau sepak pojok. Tampilan: skor, tulisan GOL! dengan nama pencetak gol, statistik tembakan, tekel, dan penyelamatan.
- Berikutnya tahap 5: blunder dari stat teknis (operan meleset, sentuhan buruk, salah keputusan).

Tip: tambahkan `?seed=13` di alamat (misalnya `http://localhost:5173/?seed=13`) untuk memutar ulang pertandingan tertentu.

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
  - `ball.js` — fisika bola menggelinding dan prediksi posisinya
  - `touch.js` — siapa yang menyentuh bola duluan di sepanjang lintasannya
  - `roles.js` — siapa yang menjemput atau menekan bola di tiap tim
  - `passing.js` — otak pemegang bola: menilai pilihan operan, arah menggiring
  - `shooting.js` — kapan dan ke mana menembak
  - `tackle.js` — duel tekel berbasis stat
  - `keeper.js` — tangkap/tepis, bola di tangan kiper
  - `control.js` — jangkauan pemain terhadap bola (kaki atau tangan kiper)
  - `shape.js` — posisi jangkar formasi per fase (menyerang/bertahan/netral)
  - `marking.js` — penjagaan lawan per zona saat bertahan
  - `movement.js` — lapisan gerak: tubuh pemain dengan inersia
  - `state.js`, `teams.js`, `formations.js`, `stats.js`, `pitch.js`, `rng.js`
- `src/render/` — menggambar state ke canvas dan menghaluskan gerakan di antara tick. Hanya membaca state, tidak pernah mengubahnya.
- `src/components/` — komponen React untuk UI.
- `scripts/check-engine.js` — pemeriksaan engine: invariant (gagal = bug) dan angka kewajaran 90 menit (AWAS = perlu ditonton dan disetel).

## Dokumen penting

Arah, batasan, logika gerak, statistik pemain, dan urutan pengembangan ada di [docs/dokumen-arah-game.md](docs/dokumen-arah-game.md). Baca dokumen itu sebelum menambah fitur.
