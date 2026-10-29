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
- Sentuhan pertama disetel ke kisaran nyata (28 Okt): dulu 18% operan berakhir bola memantul lepas dari kaki, sekarang ~6%. Rata-rata gol naik ke ~2,3 per laga dan laga 0–0 turun ke ~10% (patokan liga besar Eropa: 2,6–3,2 gol).
- Persiapan kick-off (28 Okt): di awal babak dan setelah gol, jam berhenti, pemain berjalan ke posisi formasinya, menunggu 2 detik, lalu bola dimainkan.
- Insting gol & tembakan jarak jauh (28 Okt): stat psikologis baru **Insting gol** membuat pemain makin berani menembak saat dekat gawang; tenaga tendangan dari Finishing + Kekuatan; pandangan kiper bisa terhalang pemain di jalur tembakan. Sekitar sepertiga tembakan sekarang dari luar kotak, dan ~20% gol lahir dari sana.
- Wasit & hakim garis (tahap 7a, 28 Okt): wasit mengikuti bola, dua hakim garis berlari sejajar garis offside dan mengangkat bendera. Kick-off: penendang berdiri di titik tengah, lawan di luar lingkaran, lalu peluit. Offside dinilai untuk semua cara bola dimainkan, dan hakim garis bisa salah pada kejadian tipis (tanpa VAR).
- Pelanggaran & kartu kuning (tahap 7b-1, 29 Okt): tekel bisa jadi pelanggaran (stat baru **Kecerobohan**, emosi/Temperamen, dari belakang, lelah), wasit bisa tidak melihat dan memberi keuntungan, tendangan bebas dengan pagar betis (ditembak langsung atau dilambungkan), kartu kuning, pemain berkartu lebih berhati-hati.
- Penalti (29 Okt): pelanggaran di kotak penalti = penalti. Jam berhenti, penendang di titik penalti, kiper di garis gawang, pemain lain di tepi luar kotak; kiper menebak arah dan bisa salah. ~74% masuk. Tendangan bebas: bek tidak lagi menumpuk di garis gawang.
- Jeda setelah peluit (7b-2, 29 Okt): pelanggaran, penalti, dan offside menghentikan permainan — wasit mendatangi kejadian, kartu, **protes** (bisa berbuah kuning) dan **pertikaian** antarpemain (pemain yang terlibat jadi lebih emosional), lalu persiapan bola mati dan peluit.
- Bola mati tidak terburu-buru (29 Okt): drama protes & pertikaian menunggu pemain berkumpul dan berlangsung lebih lama, lebih banyak pemain ikut; lemparan, sepak pojok, dan tendangan gawang juga punya jeda. Tulisan peluit dipindah ke luar lapangan.
- Kartu merah & 10 orang (tahap 7c, 29 Okt): kuning kedua, merah langsung (menggagalkan peluang gol, tekel sangat keras, kekerasan saat pertikaian), pemain berjalan keluar lapangan, bentuk tim ditambal (penyerang dikorbankan), kiper darurat bila kiper dikartu merah. Pertikaian kini hidup: tiap pemain punya gaya sendiri (menyeruduk, mendorong balik, melerai, menarik rekan, mondar-mandir).
- Mentalitas tim (29 Okt): bertahan / seimbang / menyerang. AI pelatih membuat tim yang tinggal 10 orang otomatis bertahan (blok mundur, tidak menekan tinggi, main langsung). Setelah protes, pemain diam sejenak lalu bubar bertahap; bola bisa dimainkan sebelum semua kembali.
- Tekel lebih terasa (29 Okt): luncuran, kilatan di titik kontak, penekan terhuyung, korban pelanggaran rebah.
- Skuad & pergantian pemain + dua tab (8a, 29 Okt): tab **Tim** (susunan, tenaga, kartu, 7 cadangan, antrian pergantian) dan tab **Pertandingan**; keduanya tetap berjalan. Pergantian diantrikan: babak 1 → dijalankan saat babak 2 dimulai, babak 2 → pada bola mati berikutnya. Maksimal 5. Tim lawan diganti AI pelatih.
- Taktik di tab Tim (8b, 29 Okt): formasi (4-4-2, 4-3-3, 4-2-3-1, 4-5-1, 3-5-2), mentalitas (otomatis/bertahan/seimbang/menyerang), tempo, umpan silang — berlaku seketika. Filosofi tetap (identitas tim).
- Penutup tembakan (29 Okt): saat Bertahan dan tidak kalah jumlah di sekitar bola, satu bek menutup jalur tembak di dekat kotak. Catatan: "Bertahan" kini mengurangi gol sendiri tetapi belum mengurangi kebobolan (lihat dokumen arah 8c).
- Berikutnya: skema bola mati, lalu liga.

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
  - `fouls.js` — pelanggaran, kartu kuning, keuntungan, emosi pemain (tabel FOUL, CARD)
  - `officials.js` — wasit & hakim garis: gerak, penilaian offside yang bisa salah
  - `scuffle.js` — koreografi pertikaian & protes (gaya gerak tiap pemain)
  - `substitution.js` — antrian & pelaksanaan pergantian pemain, AI pelatih pergantian
  - `tactics.js` — formasi, mentalitas, tempo, umpan silang yang diatur pelatih
  - `mentality.js` — mentalitas tim & AI pelatih (bertahan saat kalah jumlah)
  - `sendoff.js` — kartu merah: pemain keluar, bentuk tim 10 orang, kiper darurat
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
