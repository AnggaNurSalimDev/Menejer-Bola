# Dokumen Arah Pengembangan — Web Manager Bola

Dokumen ini adalah pegangan utama proyek. Sebelum menambah fitur atau mengubah sistem, cek dulu ke sini. Kalau sebuah ide bertentangan dengan dokumen ini, ubah dokumennya secara sadar dulu, jangan diam-diam di kode.

Terakhir disepakati: 27 Oktober 2026

---

## 1. Visi

Game manager sepak bola berbasis web. Pemain game mengatur tim dan taktik, lalu menonton pertandingan yang disimulasikan secara langsung. Di lapangan, setiap pemain digambarkan sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak secara realtime dari sudut pandang atas.

Inti daya tariknya: **pemain di lapangan terlihat hidup.** Mereka berpikir, bergerak sebagai tim, dan bisa melakukan blunder yang manusiawi sesuai kualitas dan kondisi psikologisnya.

Tujuan proyek: **untuk senang-senang.** Bukan portofolio, bukan produk komersial.

## 2. Batasan yang sudah disepakati

**Termasuk:**
- Mode simulasi yang ditonton langsung (opsi A). Satu pemain, berjalan sepenuhnya di browser.
- Tampilan top-down: jersey + nomor punggung + nama pemain.
- Otak pemain dari **hitungan murni**: rumus, bobot, perbandingan angka, dan angka acak.
- Nama pemain dan klub fiktif.

**Tidak termasuk (setidaknya sampai inti game selesai):**
- Multiplayer realtime (opsi B). Tidak ada server, tidak ada WebSocket.
- LLM, machine learning, atau API berbayar apa pun untuk logika pemain.
- Fisika realistis. Bola dan pemain cukup disederhanakan.
- Fitur manager besar (transfer, keuangan, latihan, liga penuh) sebelum satu pertandingan terasa seru.
- Nama, klub, atau logo asli.

Catatan istilah: kata "AI" dalam diskusi proyek ini berarti logika perilaku karakter (seperti di game klasik), **bukan** model bahasa atau machine learning. Agar tidak rancu, gunakan istilah **"otak pemain"** atau **"logika gerak"**.

### Durasi dan tempo pertandingan (disepakati 27 Okt 2026)

- **2 babak × 5 menit waktu nyata.** Jam di layar berjalan 0'–45' dan 45'–90' (gaya FIFA).
- **Pemain tetap bergerak dengan kecepatan nyata.** Waktu nyata TIDAK dipercepat agar gerakan tetap terlihat wajar; yang dipadatkan adalah tempo permainan (keputusan lebih cepat, operan lebih vertikal, lebih berani menembak).
- **Jeda babak = layar taktik** dengan tombol lanjut (tidak ada waktu tunggu tetap). Untuk sekarang hanya skor dan statistik; ubah formasi, man-to-man marking, dan sebagainya masuk bersama layer manager.
- Babak kedua: kedua tim bertukar sisi; tim yang tidak kick-off di babak pertama memulai.
- **Rata-rata gol tidak diatur langsung**; gol harus muncul dari stat, taktik, dan pergerakan. Yang dikalibrasi hanya **titik nol**: dua tim rata-rata (kualitas 12) ≈ 2–4 gol per pertandingan. Tim kuat vs lemah, taktik, dan stat menggeser hasil dari titik nol itu.
- Hasilnya adalah "sepak bola versi padat", bukan simulasi setia seperti Football Manager. Rentang wajar di `npm run check` adalah target desain game ini, bukan angka sepak bola nyata.

## 3. Prinsip Arsitektur

1. **Simulasi terpisah dari tampilan.** Simulasi hanya menghasilkan data posisi 22 pemain dan bola per tick. Simulasi tidak tahu apa-apa soal gambar.
2. **Simulasi berjalan per tick** (awal: sekitar 10 tick per detik). Tampilan berjalan sekitar 60fps dan menghaluskan gerakan di antara tick (interpolasi).
3. **Canvas untuk lapangan, React untuk UI** (menu, skuad, taktik). React tidak boleh me-render ulang objek di lapangan setiap frame.
4. **Angka acak memakai seed.** Seed yang sama menghasilkan pertandingan yang identik. Ini dipakai untuk melacak bug dan memungkinkan replay.
5. Engine harus bisa dijalankan tanpa tampilan, supaya ribuan pertandingan bisa disimulasikan cepat untuk mengecek apakah hasilnya masuk akal (skor, jumlah tembakan, dan sebagainya).

## 4. Logika Gerak (Otak Pemain)

Tujuh prinsip yang sudah disepakati:

1. **Inersia.** Pemain punya kecepatan saat ini, kecepatan maksimal, dan percepatan. Otak menentukan ke mana ingin pergi; tubuh menyesuaikan secara bertahap. Tidak boleh ada belok 180° atau lari kencang instan.
2. **Arah gerak = gabungan tarikan berbobot:**
   - ke posisi formasi (yang ikut bergeser mengikuti bola),
   - ke bola atau target tugas,
   - menjauh dari rekan yang terlalu dekat,
   - ke lawan yang harus dijaga (saat bertahan).
   Bobot berubah sesuai peran dan situasi. Tarikan formasi lemah untuk pemain dekat bola, kuat untuk pemain jauh dari bola.
3. **Dua lapisan:** lapisan **keputusan** (memilih tugas: menekan, menjaga, mencari ruang, kembali ke posisi) berjalan lebih jarang; lapisan **gerak** berjalan setiap tick dan menjalankan tugas dengan halus.
4. **Komitmen.** Setelah memilih tugas, pemain bertahan dengannya sampai tugas selesai, gagal, atau situasi berubah besar (misalnya bola berpindah tim). Ini mencegah gerakan gemetar.
5. **Hanya 1–2 pemain per tim yang mengejar bola.** Sisanya menjaga bentuk. Mencegah efek "gerombolan anak SD".
6. **Ketidaksempurnaan diatur oleh stat:**
   - noise keputusan (memilih opsi yang bukan terbaik),
   - noise eksekusi (operan melenceng, sentuhan terlalu jauh, tembakan meleset),
   - jangkauan penglihatan terbatas,
   - waktu reaksi.
7. **Simulasi bisa diulang** lewat seed (lihat Arsitektur poin 4).

Prioritas tertinggi untuk membuat gerakan terlihat hidup: **prinsip 1, 3, dan 5.**

## 5. Statistik Pemain

Skala semua stat: **1–20** (10 = rata-rata, 15 = bagus, 18+ = kelas bintang).

### A. Statistik Teknis — kemampuan maksimal (plafon)

**Fisik**
| Stat | Mengendalikan |
|---|---|
| Kecepatan | Batas kecepatan lari tertinggi |
| Akselerasi | Seberapa cepat mencapai kecepatan puncak dari diam |
| Kelincahan | Ketajaman berbelok (mengatur inersia) |
| Stamina | Seberapa lambat tenaga habis |
| Kekuatan | Peluang menang adu badan / duel |

**Olah bola**
| Stat | Mengendalikan |
|---|---|
| Passing | Noise eksekusi operan (arah & kecepatan) |
| Kontrol | Kualitas sentuhan pertama |
| Dribbling | Membawa bola sambil bergerak, melewati lawan |
| Finishing | Akurasi tembakan |
| Tackling | Peluang merebut bola tanpa pelanggaran |

**Membaca permainan** (sifatnya mental, tapi langsung menjadi bagian otak pemain, bukan pengubah)
| Stat | Mengendalikan |
|---|---|
| Visi | Jangkauan "penglihatan": rekan mana yang masuk pilihan operan |
| Keputusan | Besar noise saat memilih aksi |
| Posisi | Ketepatan menempati posisi formasi dan menemukan ruang |
| Antisipasi | Waktu reaksi (berapa tick sebelum merespons) |

**Khusus kiper** (opsional, bisa menyusul): Refleks, Penempatan, Tangkapan.

Opsi penyederhanaan untuk versi awal: Kekuatan dan Dribbling boleh digabung dulu.

### B. Statistik Non-Teknis (Psikologis) — pengubah situasional

Prinsip utama: **stat teknis adalah plafon; psikologi menentukan berapa banyak dari plafon itu yang keluar saat itu.** Psikologi bekerja sebagai nerf yang bergantung pada situasi, bukan permanen.

| Stat | Pemicu | Efek |
|---|---|---|
| Ketenangan | Ditekan lawan dari dekat; peluang penting (1 lawan 1 dengan kiper) | Nerf Finishing, Passing, Kontrol. Ketenangan tinggi = hampir tidak kehilangan kemampuan |
| Stabilitas mental | Mengatur **kepercayaan diri** (kondisi naik-turun: naik setelah aksi sukses, turun setelah blunder) | Kepercayaan diri rendah me-nerf Keputusan (ragu, pilih opsi aman). Stabilitas rendah = kepercayaan diri mudah anjlok, blunder memicu blunder |
| Konsistensi | Awal pertandingan: "form hari ini" diacak | Konsistensi rendah = rentang form lebar. Nerf kecil ke semua stat teknis |
| Temperamen | Tim tertinggal; baru dilanggar | Tackling lebih nekat → peluang pelanggaran & kartu naik (pergeseran perilaku, bukan nerf murni) |
| Determinasi | Menit akhir; tim tertinggal | Menahan nerf dari kelelahan |
| Egoisme / Kerja sama | Selalu aktif | Kecenderungan, bukan nerf: pemain egois lebih sering menembak/menggiring daripada mengoper |

**Kelelahan** (kondisi, bukan stat): saat stamina menipis, Kecepatan, Akselerasi, dan terutama Keputusan turun.

### C. Aturan Nerf

- **Total nerf dibatasi maksimal sekitar 25–30%** dari stat dasar, supaya bintang tetap terasa bintang dan pemain tidak lumpuh total saat semua nerf menumpuk. (Angka awal, belum diuji — sesuaikan setelah prototipe.)
- **Kondisi psikologis ditampilkan di layar** (misalnya ikon kecil di dekat jersey saat kepercayaan diri anjlok), supaya blunder akibat psikologi terbaca sebagai cerita, bukan kesalahan acak.

## 6. Urutan Pengembangan

Setiap tahap harus bisa ditonton dan terasa benar sebelum lanjut ke tahap berikutnya.

1. ✅ Lapangan + 22 jersey diam di posisi formasi.
2. ✅ Bola bergerak; formasi bergeser mengikuti bola. Pemain bergerak dengan inersia.
3. ✅ Penguasaan bola & operan (disepakati 27 Okt 2026: gabungan tahap 3 lama + sebagian tahap 4):
   - status bola: bebas / dikuasai / dalam operan; bola mati untuk kick-off & bola keluar
   - satu pengejar/penekan per tim, dipilih berdasarkan waktu sampai
   - pemegang bola menggiring lalu mengoper ke rekan terbaik (aman, bebas, maju)
   - penerima menjemput bola; lawan bisa memotong (siapa sampai duluan, dia yang menguasai)
   - bentuk tim per fase (menyerang melebar & maju, bertahan merapat) + penjagaan lawan per zona
   - penghindaran rekan
4. ✅ Tembakan, gol, dan tekel → pertandingan selesai dengan skor:
   - tembak kalau kualitas tembakan (sudut × risiko blok × kesiapan kiper) melewati ambang
   - meleset dasar yang sama untuk semua pemain (stat Finishing menyusul di tahap 5)
   - kiper: jangkauan lebih besar di kotaknya; tangkap atau tepis (makin kencang, makin sering ditepis); bola di tangan kiper tidak boleh ditekel/ditekan
   - tekel dari stat: Tackling vs Dribbling + Kekuatan; gagal = penekan terhuyung
   - gol → jeda 4 detik, pemain kembali ke posisi, kick-off oleh tim yang kebobolan
   - bola keluar lewat garis gawang → tendangan gawang atau sepak pojok
   - ✅ (27 Okt) 2 babak × 5 menit nyata, jam 0'–90', layar jeda + layar akhir, tukar sisi; tempo dipadatkan (tuas 1–3)
5. ✅ Blunder dari stat teknis (27 Okt). Semua angka ada di `src/engine/skill.js` (tabel BLUNDER, nilai stat 1 dan stat 20):
   - Passing → arah & kekuatan operan meleset; Kontrol → sentuhan pertama terlalu jauh (bola memantul)
   - Finishing → besar meleset tembakan; Keputusan → salah menilai keamanan operan
   - Visi → operan terjauh yang terpikirkan; Antisipasi → waktu reaksi NYATA (pemain telat bergerak setelah bola dilepas)
   - Posisi → ketat/longgarnya menjaga lawan; Refleks → jangkauan kiper; Tangkapan → peluang menangkap
   - Perilaku baru: penyerang menggeser bola ke samping kalau jalur tembak ditutup bek; tembakan yang kena bek memantul liar
   - Rentang fisik (Kecepatan/Akselerasi/Kelincahan) dan blunder disempitkan setelah uji ablasi, untuk mencegah efek bola salju
   - Alat ukur baru: `npm run calibrate` (64 laga per skenario, dengan rentang ketidakpastian)
5b. 🟡 Pola serangan, tahap awal (27 Okt; didahulukan dari tahap 6 atas kesepakatan):
   - aturan offside: posisi penyerang dibatasi garis offside; operan ke penerima offside → tendangan bebas lawan; Keputusan rendah bisa salah membaca garis
   - lari ke belakang garis bek (tugas `run`): satu pelari per tim, dimulai dari "bahu" bek terakhir, lawan butuh waktu reaksi untuk membacanya
   - umpan terobosan ke titik temu bola & pelari; pemegang bola langsung mempertimbangkannya saat rekan mulai berlari
   - hasil: ~19 lari, ~3,6 umpan terobosan (47% sampai) per laga; ~18% gol lahir dari umpan terobosan. Titik nol gol TIDAK naik (1,6).
   - lanjutan (27 Okt sore): garis bek terkoordinasi (CB/LB/RB hanya menggeser ke samping, kecuali lawan di kotak penalti), lari ke celah antar-bek, mode satu lawan satu (lolos dari semua bek → lari ke gawang, tidak mengoper)
   - hasil lanjutan (`npm run calibrate`, 64 laga): titik nol 1,38 ± 0,32 (tidak berubah nyata); umpan terobosan ~4,9 per laga (~48% sampai); kejutan 13 vs 11 membaik ke 19–22%
   - belum: umpan silang/sundulan (butuh bola melambung)
6. ✅ Lapisan psikologis dan kelelahan (28 Okt). Semua angka ada di `src/engine/condition.js` (tabel CONDITION dan CONFIDENCE_EVENTS):
   - kondisi tiap pemain: tenaga, kepercayaan diri, form hari ini, catatan blunder
   - Stamina → laju terkurasnya tenaga (lari kencang jauh lebih mahal); jeda turun minum memulihkan sedikit; lelah = laju/percepatan turun + blunder membesar
   - Determinasi → menahan efek lelah saat tim tertinggal atau setelah menit 70
   - Stabilitas mental → seberapa dalam kepercayaan diri jatuh setelah blunder; percaya diri rendah = blunder membesar + ragu mengoper ke depan
   - Konsistensi → form hari ini (nerf kecil acak saat kick-off); Ketenangan → blunder saat ditekan dari dekat dan saat peluang besar
   - Egoisme → ambang tembak lebih rendah (bukan nerf, pergeseran perilaku)
   - batas nerf: blunder paling banyak +30%, laju & percepatan paling banyak −30%
   - sapuan panik (permintaan 28 Okt): bek (CB/LB/RB/DM) yang punya catatan blunder, saat timnya tertinggal dan bola di separuh sendiri, cenderung langsung membuang bola jauh ke arah garis samping (kadang keluar lapangan). Peluangnya naik saat percaya diri dan ketenangan rendah; diputuskan sekali per penguasaan
   - tampilan: bar tenaga di bawah nama saat tenaga < 60%, titik merah di bahu jersey saat percaya diri < 40%, baris "Sapuan panik" di statistik
   - Temperamen ditunda sampai ada pelanggaran & kartu (efeknya memang ke sana)
7. Baru setelah itu: layer manager (skuad, taktik, lalu liga).

## 7. Keputusan yang Masih Terbuka

- ~~Kepercayaan diri: murni nerf atau bisa memberi bonus?~~ Diputuskan 28 Okt: **murni nerf** (lebih mudah diseimbangkan). Bisa ditinjau ulang kalau pertandingan terasa kurang drama.
- Stat kiper: dimasukkan sejak awal atau menyusul.
- Angka detail (bobot tarikan, jumlah tick per detik, batas nerf) — ditentukan lewat pengujian prototipe, bukan diskusi.
- Catatan pengujian tahap 3: jumlah operan (~1.100/tim/90 menit) dan pergantian penguasaan (~580) masih sedikit di atas rentang wajar. Penyebab utamanya tekanan lawan yang selalu berhasil mendekat; ditinjau ulang setelah tekel dan noise stat ada.
- Catatan pengujian tahap 4 (rata-rata 8 pertandingan): 3,5 gol per laga, 18 tembakan per tim, 55% tepat sasaran, 10% tembakan jadi gol, tekel berhasil 44%. Jumlah operan & pergantian penguasaan masih sedikit di atas rentang (tekel tidak mengubahnya banyak).
- Parameter yang sangat sensitif: jangkauan kiper (KEEPER_REACH). Mengubahnya dari 2,2 m ke 1,8 m menaikkan tembakan dari ~7 ke ~18 per tim. Hati-hati saat menyetelnya, dan saat menambahkan stat kiper di tahap 5.
- Catatan pengujian tempo padat (16 pertandingan, 2 × 5 menit): titik nol 1,3 gol per laga (target 2–4, sisanya diharapkan datang dari blunder tahap 5), 8 tembakan per tim, operan sukses 59%. Tim kualitas 15 vs 9: menang 13, kalah 2, seri 1 (rata-rata gol 1,94 vs 0,25) — kualitas skuad sudah terasa walau stat baru memengaruhi gerak dan tekel.
- Catatan pengujian tahap 5 (`npm run calibrate`, 64 laga): titik nol 1,6 ± 0,35 gol per laga, masih di bawah target 2–4. Tim 15 vs 9 (beda kelas): menang 95%, tim lemah hampir tidak mencetak gol. Tim 13 vs 11 (satu liga): menang 48%, seri 32%, kalah 20% — kejutan masih sering terjadi.
- Uji ablasi tahap 5: penyebab terbesar selisih tim kuat vs lemah adalah stat fisik (kecepatan). Hati-hati melebarkan rentang di movement.js.
- Kenapa titik nol mentok ~1,5: menyetel ambang tembak, kiper, dan kelonggaran bek hanya memberi perubahan kecil (sebagian di dalam rentang ketidakpastian). Hambatannya struktural: belum ada cara menciptakan peluang selain menggiring/mengoper pendek ke kotak penalti yang penuh. Diperkirakan naik setelah ada umpan terobosan, lari ke belakang garis bek, dan umpan silang — sesuai ide bahwa gol bertambah dari pergerakan dan taktik, bukan dari angka.
- Catatan pola serangan (tahap 5b): penghambat utama umpan terobosan adalah bek yang hampir selalu lebih dulu sampai ke ruang di belakang garis (83% kasus). Lari saat ini lurus ke depan ke zona bek; garis pertahanan bertahan dalam sehingga ruang di belakangnya sempit. Ide lanjutan: lari ke celah antar-bek (channel), garis pertahanan yang naik saat bola jauh (menciptakan ruang di belakang), umpan silang dengan bola melambung.
- Dicoba lalu dibatalkan (tahap 5b): otak pemain memperhitungkan laju awal pemain. Umpan terobosan tidak membaik, tetapi tim yang lebih bagus jadi terlalu dominan (kejutan 13 vs 11 turun 13% → 6%). Fungsi travelTime tetap mendukung laju awal untuk percobaan nanti.
- Temuan penting tahap 5b lanjutan: setelah pelari menerima umpan terobosan, rata-rata masih 2–3 bek lebih dekat ke gawang, dan dari 72 penerimaan dalam 32 laga tidak ada satu pun gol (63% dioper lagi). Bek selalu sempat mengejar kembali selama bola menempuh jarak dan pelari mengontrolnya. Mewajibkan titik temu jauh di belakang garis hanya membuat umpan terobosan lebih jarang. Kesimpulan: menambal umpan terobosan sudah tidak efektif; masalahnya ada di hubungan laju bola vs laju pemain dan cara bek mengejar, yang perlu dipikirkan ulang sebagai satu kesatuan, bukan ditambal per bagian.
- Catatan pengujian tahap 6 (32–64 laga): tenaga akhir pemain lapangan p10/p50/p90 = 0,42 / 0,52 / 0,64 (korelasi dengan Stamina 0,52); pemain berada di percaya diri < 0,4 sekitar 4% waktu; gol babak 1 vs babak 2 = 0,56 vs 0,81 (lelah membuka pertandingan di akhir); sapuan panik ~3,7 per laga, ~40% keluar lapangan. Titik nol 1,28 ± 0,29 (tidak berubah nyata). Kejutan 13 vs 11 turun sedikit ke 11% (dari 19–22%) — masih di dalam rentang sehat, belum disetel; awasi.
- Belum ada: umpan silang/sundulan, pelanggaran & kartu (dan Temperamen), pergantian pemain.

## 8. Aturan Anti-Melenceng

Sebelum menambah sesuatu, tanyakan:

1. Apakah ini membuat **pertandingan terlihat lebih hidup**, atau hanya menambah fitur?
2. Apakah tahap pengembangan sebelumnya sudah terasa benar saat ditonton?
3. Apakah ini masih **hitungan murni, berjalan di browser, tanpa biaya**?
4. Apakah ini melanggar batasan di bagian 2?

Kalau jawaban 1–3 "tidak" atau jawaban 4 "ya", tunda idenya dan catat di bagian 7 atau daftar ide terpisah.

Pengingat: setelah prototipe berjalan, **menonton dan menyetel angka lebih berharga daripada menambah sistem baru.**
