# Menejer Bola

Game manager sepak bola berbasis web. Atur tim dan taktik, lalu tonton pertandingan yang disimulasikan secara langsung dari sudut pandang atas. Setiap pemain tampil sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak dengan "otak" yang dibangun dari hitungan murni, lengkap dengan blunder manusiawi sesuai stat dan kondisi psikologisnya.

Proyek ini dibuat untuk senang-senang.

## Status

- Tahap 1 selesai: lapangan dan 22 jersey (nomor + nama) di posisi kick-off.
- Tahap 2 selesai (uji gerak): bola bergerak sendiri secara acak ber-seed, formasi bergeser mengikuti bola dengan lini yang tetap terpisah, pemain bergerak dengan inersia (kecepatan, akselerasi, dan kelincahan dari stat). Kontrol: jeda, kecepatan 1×–8×, ulang dengan seed baru.
- Tahap 3 selesai (penguasaan & operan): bola hanya digerakkan pemain. Satu pemain per tim menjemput atau menekan bola, pemegang bola menggiring lalu mengoper ke rekan terbaik, lawan bisa memotong operan, tim melebar saat menyerang dan menjaga lawan per zona saat bertahan. Tampilan: tanda kuning di bawah pemegang bola, statistik penguasaan dan operan.
- Tahap 4 selesai (tembakan, gol & tekel): pemain menembak berdasarkan sudut, risiko blok, dan posisi kiper. Kiper menangkap atau menepis. Tekel ditentukan stat Tackling, Dribbling, dan Kekuatan. Gol memicu jeda dan kick-off ulang; bola keluar lewat garis gawang jadi tendangan gawang atau sepak pojok. Tampilan: skor, tulisan GOL! dengan nama pencetak gol, statistik tembakan, tekel, dan penyelamatan.
- Format pertandingan: 2 babak × 5 menit nyata (jam 0'–90'), pemain tetap bergerak dengan kecepatan nyata, tempo dipadatkan. Layar jeda dengan tombol "Lanjut babak 2" (nanti tempat mengubah taktik), layar akhir dengan "Main lagi". Babak kedua tukar sisi.
- Tahap 5 selesai (blunder dari stat): operan meleset (Passing), sentuhan pertama terlalu jauh (Kontrol), tembakan meleset (Finishing), salah menilai risiko (Keputusan), jangkauan operan (Visi), waktu reaksi nyata (Antisipasi), ketat/longgarnya menjaga (Posisi), jangkauan dan tangkapan kiper. Penyerang mencari ruang tembak, tembakan yang kena bek memantul liar.
- Pola serangan tahap awal: aturan offside, lari ke belakang garis bek (ke celah antar-bek), umpan terobosan, mode satu lawan satu. Bek bertahan sebagai satu garis. Umpan silang belum (butuh bola melambung).
- Tahap 6 selesai (kelelahan & psikologi): tenaga terkuras (Stamina), lelah memperlambat dan menambah blunder, Determinasi menahannya saat tertinggal atau di menit akhir. Kepercayaan diri naik-turun dari aksi sukses/gagal (Stabilitas mental), form hari ini (Konsistensi), gugup saat ditekan atau di peluang besar (Ketenangan), Egoisme membuat pemain lebih cepat menembak. Bek yang pernah blunder dan timnya tertinggal cenderung membuang bola jauh (sapuan panik). Pemain yang sangat percaya diri (biasanya setelah mencetak gol) jadi "on fire": blunder sedikit berkurang dan lebih berani menembak. Tampilan: bar tenaga saat < 60%, titik merah saat kurang percaya diri, titik oranye saat on fire.
- Bola udara (28 Okt): pemain sayap mengirim umpan silang ke kotak, sepak pojok dilambungkan, penyerang menyerbu tiang dekat/titik penalti/tiang jauh, duel udara ditentukan stat baru **Duel udara**, sundulan ke gawang, kiper menangkap atau meninju. Penembak juga tidak lagi asal menembak dari jauh. Rata-rata gol naik dari ~1,2 ke ~1,9 per laga.
- Filosofi pelatih (28 Okt): tiap tim punya gaya. Persada Bandung "Fisik & bola udara" (kuat, jago udara, tempo lambat, sering umpan silang), Garuda Merah "Cepat & mengalir" (lebih kencang, melepas bola lebih cepat). Filosofi hanya memindahkan kekuatan, tidak menambahnya. Ketajaman operan ikut stat Passing, lama menahan bola ikut stat Keputusan.
- Berikutnya: layer manager (taktik saat jeda, termasuk memilih filosofi).

Tip: tambahkan `?seed=13` di alamat (misalnya `http://localhost:5173/?seed=13`) untuk memutar ulang pertandingan tertentu.

## Menjalankan

```bash
npm install
npm run dev      # buka di browser
npm run check    # uji engine tanpa tampilan
npm run calibrate # ukur rata-rata gol & dinamika kualitas tim (64 laga, dengan rentang ketidakpastian)
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
  - `skill.js` — SEMUA angka blunder dari stat (tabel BLUNDER)
  - `condition.js` — kondisi pemain: tenaga, kepercayaan diri, form, tekanan (tabel CONDITION)
  - `philosophy.js` — filosofi pelatih: geseran stat (jumlah nol), tempo, kecenderungan umpan silang
  - `aerial.js` — bola udara: lambungan, titik jatuh, duel udara, sundulan (tabel AERIAL, CROSS, HEADER)
  - `shape.js` — posisi jangkar formasi per fase (menyerang/bertahan/netral)
  - `marking.js` — penjagaan lawan per zona saat bertahan
  - `attack.js` — garis offside, lari ke belakang garis bek, titik umpan terobosan
  - `movement.js` — lapisan gerak: tubuh pemain dengan inersia
  - `state.js`, `teams.js`, `formations.js`, `stats.js`, `pitch.js`, `rng.js`
- `src/render/` — menggambar state ke canvas dan menghaluskan gerakan di antara tick. Hanya membaca state, tidak pernah mengubahnya.
- `src/components/` — komponen React untuk UI.
- `scripts/check-engine.js` — pemeriksaan engine: invariant (gagal = bug) dan angka kewajaran 90 menit (AWAS = perlu ditonton dan disetel).

## Dokumen penting

Arah, batasan, logika gerak, statistik pemain, dan urutan pengembangan ada di [docs/dokumen-arah-game.md](docs/dokumen-arah-game.md). Baca dokumen itu sebelum menambah fitur.
