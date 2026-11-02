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
- **Persiapan kick-off (28 Okt):** di awal setiap babak dan setelah gol, jam BERHENTI. Pemain berjalan ke posisi formasinya (sampai semua ≤ 1 m dari posisinya, paling lama 8 detik), menunggu 2 detik, baru bola dimainkan dan jam berjalan lagi. Waktu jeda tidak dihitung sebagai penguasaan bola (dicatat di `stats.pauseTicks`).
- **Rata-rata gol tidak diatur langsung**; gol harus muncul dari stat, taktik, dan pergerakan. Yang dikalibrasi hanya **titik nol**: dua tim rata-rata (kualitas 12) ≈ **2,4–3,0 gol per pertandingan, dengan laga 0–0 paling banyak ~10%** (disepakati 28 Okt sore, menggantikan tebakan awal 2–4). Patokan: liga besar Eropa 2024/25 — La Liga 2,61, Serie A 2,70, Premier League 2,92, Ligue 1 2,98, Bundesliga 3,22, Liga Champions ~3,2. Batas bawah sedikit di bawah La Liga karena belum ada penalti & tendangan bebas. Syarat tetap: tim lemah masih menang 10–20% melawan tim yang sedikit lebih kuat (13 vs 11) — gol boleh naik, tetapi tidak boleh hanya dinikmati tim kuat. Tim kuat vs lemah, taktik, dan stat menggeser hasil dari titik nol itu.
- Hasilnya adalah "sepak bola versi padat", bukan simulasi setia seperti Football Manager. Rentang wajar di `npm run check` adalah target desain game ini; untuk rata-rata gol, targetnya sengaja dipatok ke angka liga nyata.

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
| Duel udara | Peluang menang bola udara (umpan silang, sepak pojok) dan ketepatan sundulan. Ditambahkan 28 Okt atas keputusan bersama, supaya ada tipe pemain "jago udara" (bek tengah jangkung, striker target) yang tidak harus cepat |

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
| Egoisme / Kerja sama | Selalu aktif | Kecenderungan, bukan nerf: pemain egois lebih sering menembak/menggiring daripada mengoper (di mana saja) |
| Kecerobohan | Selalu aktif | Tekel asal-asalan / salah timing → pelanggaran (stat TINGGI = lebih ceroboh). Ditambahkan 29 Okt atas permintaan; beda dengan Temperamen: Kecerobohan tidak bergantung emosi. Juga mengikis kehati-hatian setelah kartu kuning (hanya bila di atas rata-rata) |
| Insting gol | Makin dekat gawang lawan (mulai ±32 m, penuh di 20 m) | Kecenderungan, bukan nerf: "adrenalin" — ambang tembak turun sesuai jarak, jadi pemain berinsting tinggi berani menembak dari luar kotak. Ditambahkan 28 Okt atas permintaan. Beda dengan Egoisme: Egoisme berlaku di mana saja, Insting gol bergantung jarak |

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
   - on fire (28 Okt siang): percaya diri ≥ 0,9 (biasanya setelah mencetak gol) → blunder mengecil sampai −15% dan lebih berani menembak; luntur perlahan (~10–20 menit permainan). Tampilan: titik oranye di bahu jersey. Hasil uji 32 laga: ~0,9 pemain on fire per laga, 0,3% waktu pemain
6b. ✅ Penciptaan peluang (28 Okt, opsi A: dibatasi 2–3 percobaan):
   - diagnosis: 70% tembakan dari ≥ 20 m dengan hasil 2 gol dari 391; penembak salah menilai kiper (mengira kiper telat padahal hampir selalu sampai). Serangan sepertiga akhir berakhir: 39% operan dipotong, 26% direbut, 22% tembakan
   - percobaan 1 — kalibrasi penilaian kiper dari hasil nyata: tembakan/laga 17,5 → 8,9, tembakan jadi gol 6% → 12%, tetapi gol per laga tetap ~1,2
   - percobaan 2 — bola udara: bola punya tinggi (gravitasi, pantulan); umpan silang dari sayap dekat garis gawang lawan ke rekan di kotak (sasaran dipilih dari keunggulan Duel udara), sepak pojok dilambungkan, 3 penyerang menyerbu kotak (tiang dekat, titik penalti, tiang jauh), duel udara (Duel udara + Kekuatan + Antisipasi + jarak + acak; kiper unggul tangan di kotaknya), sundulan ke gawang dalam 14 m, sapuan sundulan, kiper menangkap/meninju bola udara. Stat baru: Duel udara. Tampilan: bayangan bola saat melambung, statistik umpan silang & sundulan, "(sundulan)" di tulisan GOL
   - hasil percobaan 2 (`npm run calibrate`, 64 laga): titik nol 1,88 ± 0,37 (dari 1,19 ± 0,26 — kenaikan nyata), kejutan 13 vs 11 16%, 15 vs 9 menang 98%. Per laga (32 laga): ~17 umpan silang (~39% sampai ke rekan), ~2,7 sundulan ke gawang, ~0,13 gol sundulan; sebagian besar tambahan gol datang dari bola kedua setelah duel udara, bukan sundulan langsung
   - catatan: menambah stat mengubah urutan angka acak pembuat tim, jadi tim contoh berubah sedikit (perbandingan memakai 64 laga, bukan seed tertentu)
6c. ✅ Filosofi pelatih & tempo (28 Okt; masukan: "tidak ada tim yang menonjol cepat"):
   - penyebab: kedua tim contoh nyaris kembar (laju lari rata-rata 8,12 vs 8,08 m/s), rentang Kecepatan sempit sejak tahap 5, dan tempo (lama menahan bola, laju operan) sama untuk semua
   - filosofi pelatih (`src/engine/philosophy.js`): menggeser stat pemain lapangan dengan jumlah NOL (invariant), plus tempo (lama menahan bola) dan kecenderungan umpan silang. Persada Bandung = "Fisik & bola udara", Garuda Merah = "Cepat & mengalir". Nanti dipilih/diubah di layer manajer
   - tempo dari stat: Passing → ketajaman operan (laju tiba 4,5–6 m/s), Keputusan → lama menahan bola (×1,1–×0,9)
   - temuan uji (64–128 laga, bergantian kandang/tamu): menggeser stat "otak" (Passing, Keputusan, Visi) dan Kecepatan membuat satu gaya jauh unggul (48% vs 19%). Tempo dan umpan silang sendiri netral (38% vs 36%). Jadi geseran stat dibuat ringan (cepat: Kecepatan/Akselerasi +1; fisik: Kekuatan +1, Duel udara +2, Stamina +1, olah bola −1) dan identitas terutama lewat tempo (0,6 vs 1,3)
   - hasil akhir: cepat 35% vs fisik 30% menang (pembanding dua tim identik: 41% vs 33%, jadi selisih ini masih derau). Tim cepat melepas bola 0,74 dtk vs 0,90 dtk, 126 vs 113 operan per laga; tim fisik lebih banyak sundulan (1,7 vs 1,3)
   - tempo dari stat sempat dibuat lebar (laju tiba 4–7 m/s, lama menahan ×1,25–×0,8): kejutan 13 vs 11 anjlok ke 3%. Disempitkan → 14%. Titik nol 1,81 ± 0,34
   - keterbatasan jujur: perbedaan laju LARI antar-tim tetap kecil (rata-rata ~0,3 m/s). Melebarkannya terbukti membuat gaya cepat terlalu unggul
6d. ✅ Jalur 1: penilaian operan & sentuhan pertama (28 Okt sore; target baru 2,4–3,0 gol, 0–0 ≤ 10%):
   - diagnosis (24 laga): selisih waktu di jalur operan adalah peramal yang lemah — operan "sangat berbahaya" (< −0,3 dtk) tetap tidak terpotong ~65%, operan "sangat aman" tetap terpotong ~11%. Dugaan "hanya pengejar lawan yang bereaksi" (histeresis) diuji dan TIDAK menjelaskannya
   - temuan terbesar: 18% dari semua operan berakhir dengan sentuhan pertama buruk (bola memantul lepas) — sama besarnya dengan operan dipotong
   - percobaan 1 — berani mengambil risiko di sepertiga akhir (ambang −0,3 dtk): titik nol 1,70 ± 0,29, tidak berubah → DIBATALKAN
   - percobaan 2 — sentuhan buruk disetel ke kisaran nyata (Kontrol: 0,12 … 0,01 per 10 m/s; ~6% operan): titik nol **2,34 ± 0,39**, laga 0–0 **11%**, kejutan 13 vs 11 13%, 15 vs 9 menang 98%. Pertandingan web (200 laga): biru 44% / seri 27% / merah 30%, 2,2 gol, 0–0 10%. Filosofi tetap seimbang (fisik 41% vs cepat 34%, dalam derau). `npm run check` lolos tanpa satu pun peringatan
   - percobaan 3 tidak dilakukan: hasil sudah di dalam rentang ketidakpastian target. Langkah berikut lebih berharga ditonton dulu
   - KOREKSI (28 Okt malam, 200 laga, kedua tim "seimbang"): rata-rata sebenarnya ~2,1–2,2 gol per laga; angka 2,34 dari 64 laga adalah sampel yang kebetulan tinggi. Titik nol masih sedikit di bawah target 2,4. Pelajaran: untuk keputusan penting, pakai ≥ 200 laga
   - persiapan kick-off dengan jam berhenti tidak mengubah rata-rata gol (200 laga: 2,17 sebelum vs 2,08 sesudah, dalam derau); gol "murah" tepat setelah kick-off ulang memang hanya ~1%
6e. ✅ Insting gol & tembakan jarak jauh (28 Okt malam; masukan: "tidak pernah ada sepakan dari luar kotak"):
   - akar masalah: tembakan jarak jauh tidak pernah masuk (kiper selalu sempat), jadi pemain diajari tidak menembak dari jauh. Menambah dorongan menembak saja akan membuang serangan
   - A. stat psikologis baru **Insting gol**: ambang tembak × (1,1 … 0,45 menurut stat) saat dekat gawang (mulai 32 m, penuh 20 m). Bias peran: ST +3, sayap +2, CB −3, kiper −6
   - B1. tenaga tendangan: laju tembakan 21,5–28,5 m/s dari Finishing (60%) + Kekuatan (40%); stat 12 ≈ 25,5 m/s (sama dengan dulu)
   - B2. pandangan kiper terhalang: pemain lapangan siapa pun di jalur tembakan (±1,2 m, ≥ 3 m di depan kiper) → kiper bereaksi 0,2 dtk lebih lambat; penembak ikut memperhitungkannya
   - hasil (200 laga, kedua tim "seimbang"): 34% tembakan dari luar kotak (target 30–40%), masuk 5,2% (target 3–5%), 20% gol dari luar kotak, ~25 tembakan per laga, gol 2,18 ± 0,21 (sebelumnya 2,08 — tidak turun), 0–0 12%. Kejutan 13 vs 11 (200 laga): 17% (sebelumnya 18%)
   - tampilan: baris "Tembakan luar kotak", "(dari luar kotak)" di tulisan GOL
7a. ✅ Wasit, hakim garis, kick-off dengan peluit, offside menyeluruh (28 Okt malam; `src/engine/officials.js`):
   - wasit (stat Ketegasan, dipakai di 7b) mengikuti bola dari samping; dua hakim garis (stat Ketelitian), masing-masing menjaga satu separuh di garis samping berseberangan, berlari sejajar titik acuan offside
   - kick-off: jam berhenti, penendang (striker terdekat ke tengah) berdiri di belakang bola di titik tengah, semua pemain di separuh sendiri, lawan di luar lingkaran tengah, lalu "PRIIIT!" (uji 100 laga: 100% sentuhan pertama oleh penendang, 0% lawan di lingkaran)
   - offside dinilai setiap kali pemain memainkan bola (operan, umpan silang, tembakan, sundulan, sentuhan buruk); pojok, lemparan, tendangan gawang dibebaskan; tepisan kiper & blok bek tidak menghapus penanda (rebound ke pemain offside tetap offside)
   - hakim garis BISA SALAH (keputusan 28 Okt: tanpa VAR — VAR mungkin di masa depan): hanya pada kejadian tipis (≤ 1,5 m dari garis), lebih sering bila hakim garis tidak sejajar garis atau Ketelitiannya rendah; ke dua arah (offside lolos, bendera salah)
   - offside sebelumnya hampir mustahil (penerima operan 81% berada > 6 m di belakang garis). Ditambah: disiplin menjaga garis dari Antisipasi (1 m kelewatan … 1 m di belakang garis) dan striker "di bahu" bek terakhir saat bola ≤ 40 m dari gawang lawan. Versi striker selalu di bahu bek menurunkan gol (2,35 → 1,87) dan terlalu banyak bendera salah (29%) — dibatalkan
   - hasil (100–200 laga): offside ~0,5 per laga (sepak bola nyata ~3–4 — masih jarang), bendera salah ~14% dari bendera, offside lolos ~0,08 per laga; gol 2,18 ± 0,21 (sama dengan sebelum 7a), 0–0 16%, kejutan 13 vs 11 13%
   - tampilan: wasit & hakim garis berbaju hitam-kuning, bendera terangkat saat offside, tulisan "PRIIIT! Kick-off / Offside — nama"
   - menaikkan offside (28 Okt malam, 2 percobaan, keduanya DIBATALKAN): (1) pengoper telat menyadari lari rekan (Keputusan, 1–8 tick) → 0,52/laga; (2) pengoper menilai posisi pelari dari yang dilihatnya sesaat sebelumnya → 0,47/laga. Tidak berubah dari 0,5. Penyebab struktural: penyerang hampir tidak pernah berada di posisi offside (hanya ~1% operan), pengoper menolak penerima yang tampak offside, dan bola biasanya sudah dilepas karena alasan lain sebelum keterlambatan berpengaruh. Jalan yang lebih menjanjikan: **jebakan offside** (garis bek naik bersamaan saat bola akan dimainkan) — cocok sebagai pilihan taktik di layer manajer
7b-1. ✅ Pelanggaran, keuntungan, tendangan bebas, kartu kuning (29 Okt; `src/engine/fouls.js`):
   - pelanggaran lahir dari tekel: tekel kalah duel jauh lebih sering melanggar; pengali dari stat baru **Kecerobohan** (uji terkontrol: stat 5 → 30% tekel jadi pelanggaran, stat 17 → 53%), emosi panas (agitation × Temperamen), tekel dari belakang, lelah, tertinggal setelah menit 70
   - emosi (agitation 0–1) naik saat dilanggar, dikartu, timnya kebobolan (× Temperamen) dan perlahan reda
   - wasit: makin jauh dari kejadian makin mungkin tidak melihat; pelanggaran ringan ditiup sesuai Ketegasan. Keuntungan bila tim yang dilanggar tetap menguasai bola di separuh lawan tanpa lawan lain menempel — kecuali ≤ 30 m dari gawang (tendangan bebas lebih berharga)
   - tendangan bebas: lawan ≥ 9,15 m, pagar betis 3 pemain bila ≤ 32 m dari gawang, eksekutor menunggu 2 dtk; ≤ 30 m dengan sudut cukup → tembak langsung (melambung melewati pagar, hanya kiper yang bisa menjangkau di udara); ≤ 42 m → dilambungkan ke kotak. Pelanggaran di kotak penalti sementara jadi tendangan bebas di tepi kotak (penalti di 7c)
   - kartu kuning: keras, dari belakang, atau taktis (pemain terakhir / menghentikan lolosnya lawan), × Kecerobohan, × Ketegasan wasit. Kuning kedua baru dicatat (`secondYellows`), kartu merah di 7c
   - setelah kuning: lebih jarang mencoba tekel & melanggar sesuai kendali diri (Ketenangan + Keputusan); Kecerobohan di atas rata-rata & emosi panas mengikis kehati-hatian. Uji terkontrol: satu tim berkartu semua → pelanggaran −24%
   - hasil (200 laga): ~11,5 pelanggaran ditiup + ~2,4 tidak terlihat wasit per laga, keuntungan ~2,4, kuning ~2,8, calon merah ~0,15, tendangan bebas ~9 (ditembak langsung ~0,7, masuk ~7%), gol 2,11 (sama dengan sebelum 7b), 0–0 12%. Kejutan 13 vs 11 turun ke **10%** (dari 13%) — tepat di batas bawah; awasi di 7b-2
   - catatan pengukuran: membandingkan pelanggaran pemain sebelum vs sesudah dikartu menyesatkan (pemain yang dikartu memang yang sering melanggar sebelumnya) — pakai uji terkontrol
   - koreksi (29 Okt, masukan setelah ditonton): (1) **penalti dimajukan dari 7c** — pelanggaran di kotak kini penalti, bukan tendangan bebas di tepi kotak; (2) saat tendangan bebas, lawan yang terlalu dekat dulu didorong menjauh LURUS dari bola, sehingga bila bola di tepi kotak semua bek menumpuk di garis gawang — sekarang digeser ke SAMPING pada kedalaman yang sama; (3) bug: eksekutor penalti & tendangan bebas memakai keputusan tembak/oper biasa sebelum aturan bola mati dicek — sekarang aturan bola mati dicek paling awal
   - penalti: persiapan dengan jam berhenti (seperti kick-off); penendang = Finishing + Ketenangan terbaik, di titik penalti; kiper di garis gawang; pemain lain berjejer berselang-seling di tepi luar kotak, di luar busur, di belakang bola; peluit "PRIIIT! Penalti". Penendang memilih sisi & membidik di dalam tiang (meleset dari Finishing × tekanan Ketenangan); kiper menebak arah (Penempatan), melompat (Refleks) dan TIDAK bisa berbalik arah 0,8 dtk; bola muntah tetap hidup
   - uji 600 penalti dipaksa: masuk 73–74%, diselamatkan 19–20%, meleset 6–7% (liga nyata ±75/18/7); posisi benar saat peluit 100%
   - bek jauh lebih hati-hati di kotaknya sendiri (lebih jarang menekel & melanggar, dari Keputusan): tanpa ini 1,37 penalti per laga; dengan ini 0,20 (nyata ~0,3)
   - hasil akhir (200 laga): gol 2,23, 0–0 10%, pelanggaran ~10,5 + ~2,2 tidak terlihat, kuning ~2,5, penalti ~0,2 (masuk ~0,14), kejutan 13 vs 11 15%
7b-2. ✅ Jeda setelah peluit, protes & pertikaian (29 Okt; masukan: "setiap pelanggaran langsung dieksekusi, tidak diam dulu"):
   - setiap pelanggaran, penalti, dan offside kini menghentikan permainan dengan jam berhenti: (1) fase insiden — wasit mendatangi pelaku/kejadian, kartu ditunjukkan, protes, pertikaian; (2) persiapan — eksekutor ke bola, pagar betis, lawan ≥ 9,15 m; (3) "PRIIIT! Tendangan bebas / penalti"
   - PROTES: pemain tim yang dihukum di dekat wasit/kejadian, makin sering bila Temperamen tinggi, Ketenangan rendah, sedang panas, dan lebih sering setelah kartu/penalti; wasit tegas lebih sering memberi kuning karena protes. Protes offside tanpa kartu
   - PERTIKAIAN: hanya setelah pelanggaran keras (berkartu atau dari belakang); korban yang emosional memulai, hingga 2 rekan per tim ikut; pemicu (lebih sering) & pelaku bisa dikartu; semua yang terlibat jadi lebih panas (~0,35 emosi, reda ~10–15 menit permainan) → lebih mudah melanggar lagi
   - tampilan: tulisan berlapis (pelanggaran / pertikaian / protes + kartu), lingkaran merah putus-putus di lokasi pertikaian, tanda "!" di atas pemain yang protes
   - hasil (200 laga): protes ~4,2 per laga, kuning karena protes ~0,40 (~14% dari ~2,9 kuning), pertikaian ~0,27 per laga (kuning ~0,17), jeda dengan jam berhenti ~74 dtk per laga (kick-off, gol, pelanggaran, offside), gol 2,31, 0–0 7%, kejutan 13 vs 11 13%. Calon kartu merah (kuning kedua) ~0,27 per laga
   - koreksi setelah ditonton (29 Okt): (1) tulisan besar di atas lapangan menutupi drama → DIHAPUS; tinggal satu baris singkat di LUAR lapangan (di atas kanvas); (2) drama terlalu singkat & sepi → jeda kini MENUNGGU yang terlibat sampai (≤ 5 dtk), lalu drama berlangsung 1,5–13 dtk; protes oleh hingga 3 rekan pelaku + hingga 2 lawan yang ikut berdebat; wasit paling banyak mengartu SATU pemrotes; pertikaian hingga 3 pemain per tim, berdiri melingkar (melebar sesuai jumlah) dan saling dorong maju-mundur; (3) semua bola mati tidak terburu-buru: persiapan tendangan bebas 2,5 dtk + eksekutor menunggu 1 dtk; lemparan, tendangan gawang (oleh kiper), dan sepak pojok kini juga punya jeda (eksekutor berjalan ke bola, penyerang menyerbu kotak saat pojok, yang lain ke posisi), tanpa peluit
   - hasil (200 laga): gol 2,41, 0–0 8%, protes ~7,7 pemain per laga, kuning protes ~0,44 (~15% dari ~3 kuning), pertikaian ~0,28, kejutan 13 vs 11 16%. Jeda dengan jam berhenti ~152 dtk per laga — satu laga kini ±12,5 menit waktu nyata (dari 10)
   - rencana layer manajer: **skema bola mati** (taktik tendangan bebas & sepak pojok) dipilih pelatih
7c. ✅ Kartu merah & bermain dengan 10 orang + gerak pertikaian (29 Okt; masukan: "pemain pertikaian jangan menumpuk diam di sekitar wasit, gerakannya berbeda-beda"):
   - GERAK PERTIKAIAN (`scuffle.js`, deterministik, tanpa rng): tiap peserta diberi gaya dari statnya — **pemicu** (korban; menyeruduk pelaku, mundur, maju lagi), **pelaku** (terdorong mundur; kalau panas mendorong balik, kalau tenang mundur angkat tangan), **pendorong** (rekan paling panas; mengitari & menyeruduk satu lawan), **pelerai** (rekan paling tenang; berdiri menyerong di depan rekannya yang panas), **penarik** (menarik rekan menjauh dari belakang), **mondar-mandir** (berjalan di pinggir kerumunan, berhenti, sesekali mendekat). Irama tiap pemain berbeda (hash id). Fase: berkumpul → memanas (kerumunan bergeser sebagai massa) → dilerai (jarak melebar). Wasit menyela di samping pasangan inti; pemrotes maju-mundur menunjuk-nunjuk di depan wasit (lebih jauh bila ada pertikaian). Lingkaran merah mengikuti kerumunan
   - KARTU MERAH: kuning kedua = merah (pelanggaran, protes, atau pertikaian); merah langsung karena menggagalkan peluang gol (pemain terakhir / lawan lolos, ≤ 36 m dari gawang, di luar kotak; 50–90% menurut Ketegasan), pelanggaran sangat keras (jarang; naik dengan Kecerobohan, emosi, dari belakang), atau tindakan kekerasan saat pertikaian (pemicu yang sangat panas). Wasit ragu memberi kuning kedua (×0,35) dan pemain berkartu menahan protes (×0,45) — tanpa ini kuning kedua 0,23 per laga (nyata 0,05–0,1). Merah menghentikan permainan (tanpa keuntungan) dan menambah 4 dtk drama
   - 10 ORANG (`sendoff.js`): pemain keluar dari daftar, berjalan lesu (pudar) ke garis samping dekat garis tengah lalu hilang. Bentuk tim ditambal berantai: lubang diisi pemain dari lini atasnya yang jalurnya paling dekat, sampai lini depan — tim mengorbankan penyerang (4-4-2 kehilangan bek → 4-4-1, sisa penyerang di tengah). Kiper dikartu merah → bek tengah jadi kiper darurat dengan stat kiper 4. Eksekutor bola mati yang dikartu merah diganti rekan terdekat
   - hasil (200 laga): kartu merah **0,165 per laga** (kuning kedua 0,105 + merah langsung 0,06), **16% laga ada kartu merah** (patokan liga besar Eropa: ~0,1–0,25), kuning 3,1, gol 2,31, 0–0 9%, jeda ~148 dtk per laga
   - uji 10 orang sejak menit 0 (200 laga, tim setara, satu bek tengah dikeluarkan): tim 10 orang mencetak 0,53 vs kebobolan 1,24, menang 17% / seri 31% / kalah 53% (kontrol 11 vs 11: 1,18 vs 1,14, menang 39%). Selisih ~0,75 gol per 90 menit — sesuai kisaran nyata. Catatan jujur: yang turun terutama gol tim 10 orang (penyerang dikorbankan), sedangkan lawan hampir tidak mencetak lebih banyak, dan penguasaan bola tetap 50% (di dunia nyata tim 10 orang biasanya kalah penguasaan). Kandidat penyetelan bila terasa janggal saat ditonton
   - catatan: simulasi deterministik per platform; satu seed bisa berjalan sedikit berbeda di Node dan di browser (perbedaan kecil hitungan desimal). Memutar ulang seed di browser yang sama tetap identik
   - koreksi setelah ditonton (29 Okt): setelah drama, pemrotes & peserta pertikaian **diam dulu** di tempat terakhirnya 0,8–2,5 dtk (lebih lama bila Temperamen/emosi tinggi), lalu **berjalan pelan**; di tendangan bebas dua rekan terdekat eksekutor mendekati bola (opsi operan pendek), rekan lain berjalan ke bentuk menyerang, lawan ke bentuk bertahan ≥ 9,15 m. Peluit hanya menunggu eksekutor, pagar betis, dan jarak lawan — bola bisa dimainkan saat pemain lain masih berjalan (13 dari 34 tendangan bebas di uji). Jeda kini ~166 dtk per laga
7d. ✅ Mentalitas tim + AI pelatih (29 Okt; pertanyaan: "kenapa tim 10 orang masih menguasai 50%?"):
   - temuan: keunggulan jumlah tidak terasa — tiap tim selalu 1 penekan, tidak ada bonus "pemain bebas", dan tim 10 orang tidak mengubah sikap. Di dunia nyata turunnya penguasaan sebagian besar PILIHAN pelatih (bertahan dalam)
   - `mentality.js`: **bertahan** (blok mundur 8 m & rapat HANYA saat lawan memegang bola, hanya menekan di ~55% lapangan dekat gawang sendiri, lari ke belakang garis bek ×0,35, saat memegang bola main langsung: bobot operan ke depan ×1,5, menahan bola ×0,85), **seimbang**, **menyerang** (blok maju 5 m, lari ×1,4). AI pelatih: kalah jumlah pemain → bertahan; tertinggal di menit ≥ 75 → kembali seimbang. Tampil sebagai chip merah di papan skor ("Bertahan · 10 pemain")
   - percobaan 1 (blok mundur di semua fase): penguasaan tim 10 orang justru NAIK ke 54% — bola diputar aman di separuh sendiri. Diperbaiki: blok mundur hanya saat bertahan + main langsung saat memegang bola
   - hasil uji 10 orang sejak menit 0 (200 laga): penguasaan 50% → **48%**, gol tim 10 orang 0,29 (−75% dari kontrol 1,18), kebobolan 1,64 (+44% dari 1,14), menang 5% / seri 23% / kalah 73%. Patokan nyata (xG per menit): tim 10 orang −65%, lawan +54% ([Data Between the Lines](https://databetweenthelines.substack.com/p/how-do-red-cards-impact-team-performance)) — kini sesuai arah & kira-kira besarnya. Angka penguasaan bola nyata tim 10 orang belum ditemukan, jadi 48% belum dikalibrasi
   - belum dikerjakan (opsi B): keunggulan jumlah secara mekanis (penekan kedua, bonus operan ke pemain bebas)
   - catatan rata-rata gol: 2,17 ± 0,21 (200 laga). Uji pembanding tanpa perubahan "bubar bertahap": 2,27 ± 0,21 — selisih di dalam ketidakpastian. Rata-rata gol turun perlahan sejak 7b (2,41 → 2,31 → ~2,2), di bawah target 2,4; perlu satu putaran penyetelan khusus
7e. ✅ Visual tekel (29 Okt; masukan: "tekel kurang terasa"): engine mencatat peristiwa tekel (`tackleEvents`, hanya untuk tampilan). Berhasil: penekan meluncur (jersey miring + garis seret 5 m di rumput) dan kilatan putih di titik kontak; gagal: penekan terhuyung ~1,8 dtk; pelanggaran: kilatan merah dan korban rebah ~2,5 dtk
8a. ✅ Skuad, pergantian pemain & dua tab (29 Okt):
   - 7 cadangan per tim (#12–18: GK, CB, LB, DM, CM, RW, ST; kualitas starter −1), dibuat setelah starter sehingga 22 starter tidak berubah
   - maksimal 5 pergantian; pemain masuk mengambil slot & peran yang ditinggalkan, masuk dari garis samping dekat garis tengah; pemain keluar berjalan ke pinggir lalu hilang; kiper hanya diganti kiper
   - **keputusan pengguna 29 Okt: kedua tab tetap berjalan** — membuka tab Tim TIDAK menjeda laga. Pergantian hanya DIANTRIKAN: diantrikan di babak 1 / jeda → dijalankan saat babak 2 dimulai; diantrikan di babak 2 → pada bola mati berikutnya. Antrian bisa dibatalkan; yang tidak lagi sah (mis. pemain sudah dikartu merah) dibatalkan dengan pemberitahuan
   - pengguna mengatur Persada Bandung; AI pelatih tim lawan: mulai menit 55, saat bola mati, mengganti pemain lapangan paling lelah (tenaga < 62%) dengan cadangan selini (maks 1 per bola mati)
   - tab Tim: susunan di lapangan (nomor, nama, posisi, bar tenaga, kartu), cadangan (posisi asli, rating), panel antrian; tab Pertandingan: lapangan & statistik. Papan skor, tulisan peluit, dan pemberitahuan pergantian tampil di kedua tab
   - hasil (200 laga, AI di kedua tim): ~4,7 pergantian per tim, gol 2,26 ± 0,20, 0–0 7%, kejutan 13 vs 11 **10%** (di batas bawah target 10–20%; cadangan tim kuat juga lebih kuat — awasi)
8b. ✅ Taktik di tab Tim (29 Okt; `tactics.js`): berlaku SEKETIKA (pelatih berteriak dari pinggir; hanya pergantian pemain yang menunggu bola mati / babak 2)
   - formasi 4-4-2, 4-3-3, 4-2-3-1, 4-5-1, 3-5-2 — pemain dipindah ke slot paling cocok (lini & jalur); kurang orang → slot paling depan dikosongkan
   - mentalitas otomatis (AI pelatih) / bertahan / seimbang / menyerang — pilihan manual menimpa AI pelatih, juga saat 10 orang
   - tempo lambat / normal / cepat (×1,25 / 1 / 0,8 lama menahan bola), umpan silang jarang / normal / sering (×0,5 / 1 / 1,5)
   - filosofi TIDAK bisa diubah di tengah laga (identitas tim dari latihan; geseran stat)
   - uji keseimbangan (200 laga per pilihan, Persada vs Garuda, kontrol: gol 1,43 vs 0,83, selisih +0,59): formasi 4-3-3 +0,14 (laga terbuka, 2,13 vs 2,00), 4-2-3-1 +0,30, 3-5-2 +0,73, 4-5-1 −0,12 (laga tertutup, 0,73 vs 0,85) — tiap formasi punya karakter, tidak ada yang mutlak unggul. Tempo cepat +0,38
   - **cacat ditemukan & diperbaiki**: "menyerang" awalnya lebih tajam SEKALIGUS lebih aman (+1,06; kebobolan turun 0,83 → 0,63) karena blok yang maju juga menghimpit lawan saat bertahan. Kini blok hanya maju saat menguasai bola + tenaga terkuras ×1,2 → gol 1,54 vs 1,07 (+0,47): lebih tajam, lebih bocor — trade-off yang benar
   - **cacat yang BELUM tuntas**: "bertahan" tetap lebih banyak kebobolan dari seimbang (1,11 vs 0,83; dua percobaan: blok −5/−3 m, tekanan sampai 60/75% lapangan, main langsung lebih lunak). Penyebab di engine: pertahanan hanya kuat lewat MENEKAN (1 penekan); blok rendah tidak membuat peluang lawan lebih jelek (tidak ada penekan kedua, penutup tembakan di tepi kotak). Perbaikan = opsi B (keunggulan jumlah secara mekanis). Sementara: bertahan berguna untuk tim 10 orang, bukan untuk "parkir bus" dengan 11 orang
   - uji 10 orang (setelah penyetelan bertahan): gol 0,38 vs 1,36 (kontrol 1,18 vs 1,14): tim sendiri −68%, lawan +19% (data nyata −65% / +54%)
8c. ⚠️ Opsi B — pertahanan tanpa menekan (29 Okt): SEBAGIAN berhasil
   - baru: peran **penutup tembakan** (`roles.js pickCover`, tugas 'cover'): saat pemegang bola lawan ≤ jangkauan dari gawang sendiri DAN tim tidak kalah jumlah dalam radius 18 m, satu bek (bukan penekan/kiper) berdiri 2,6 m di jalur ke gawang. Keunggulan jumlah kini terasa secara mekanis (kalah jumlah → tidak ada penutup)
   - kalibrasi: penutup untuk SEMUA tim membuat 0–0 naik ke 16% (gol 2,12) → kini hanya mentalitas **bertahan** (jangkauan 36 m). Hasil dasar kembali: gol 2,18 ± 0,19, 0–0 7%, kejutan 13 vs 11 9%
   - uji pemisahan (100 laga): bentuk bertahan saja → kebobolan 0,70; ditambah main langsung + jarang berlari → 1,05 (kombinasi yang buruk: mundur lalu buru-buru melepas bola). Kini "bertahan" = bentuk (mundur 3 m, rapat ×0,78) + penutup tembakan, cara main normal, tetap menekan di mana saja
   - **hasil akhir 200 laga: bertahan gol 0,99 vs kebobolan 0,95 (kontrol 1,36 vs 0,81)** — mengurangi gol sendiri, TIDAK mengurangi kebobolan. Lima percobaan; penyetelan angka dihentikan. Langkah berikutnya bila diteruskan: ukur DARI MANA gol masuk saat bertahan (umpan silang? tembakan jauh? bola mati? serangan balik setelah kehilangan bola?) sebelum mengubah apa pun
   - uji 10 orang (otomatis bertahan): gol 0,39 vs 1,30, penguasaan 50% (kontrol 1,18 vs 1,14)
8d. ✅ Skema bola mati + pojok yang benar-benar terjadi (29 Okt):
   - visual tekel diperbaiki (masukan: "miring di atas terlihat seperti menangkap bola dengan tangan"): penekan kini berputar di BAHU sehingga bagian bawah jersey (kaki) yang meluncur ke arah bola; terhuyung berputar di kaki
   - skema di tab Tim (`tactics.js`): sepak pojok campur / tiang dekat / tiang jauh / pendek (mengubah titik serbuan & sasaran lambungan; pendek = satu rekan mendekat ke bola lalu dimainkan biasa); tendangan bebas otomatis / tembak langsung / lambung ke kotak / pendek. Statistik baru `corners` (diberikan, tembakan & gol ≤ 15 dtk setelahnya)
   - **temuan lama**: sepak pojok hampir tidak pernah terjadi (~0,1 per laga sejak tahap 4; nyata ~10). Penyebab: tepisan kiper selalu ke lapangan, blokan selalu memantul balik, sapuan sundulan selalu ke depan. Diperbaiki dengan mekanisme nyata: 40% tepisan melebar ke arah garis gawang, 50% blokan membelok terus ke arah gawang, 45% sapuan sundulan ≤ 14 m dari garis gawang sendiri meleset ke samping. Hasil: **pojok 0,1 → ~1,5 per laga**. Masih jauh dari nyata — bola secara umum terlalu jarang keluar lapangan (lemparan ~2,5 per laga, nyata ~40; tendangan gawang ~4, nyata ~16). Tiga percobaan, dihentikan; perlu tahap tersendiri "bola keluar lapangan"
   - efek samping baik: rata-rata gol naik ke **2,42 ± 0,21**, 0–0 8% — kini di dalam target 2,4–3,0. Kejutan 13 vs 11 13%
   - uji skema (200 laga per pilihan): selisih gol laga semua dalam +0,36…+0,48 (kontrol +0,42) — tidak ada skema dominan, karena bola mati masih jarang. Per pojok: gol 13% (campur), 19–20% (tiang dekat/jauh), 12% (pendek) dari ~155 pojok per uji — ketidakpastian ±5%, jadi belum bisa disimpulkan. Catatan: gol per pojok ~13% jauh di atas nyata (~3%); jendela 15 dtk ikut menghitung kelanjutan serangan. Tendangan bebas langsung masuk ~1 dari 60 (nyata ~5–7%) — kandidat penyetelan
8e. ✅ Bola lebih sering keluar lapangan (29 Okt):
   - diagnosis (30 laga): lemparan 2,7 / tendangan gawang 3,8 / pojok 1,4 per laga (nyata ~40 / ~16 / ~10). 86 operan gagal per laga tetapi hanya 0,2 yang keluar (semua dipotong lawan); bola lepas di ≤ 4 m dari garis samping hanya ~4 dtk per laga (permainan menumpuk di tengah); bek yang terdesak selalu dipaksa mengoper
   - perbaikan: (1) **sapuan aman** — bek/gelandang yang ditekan di 40 m sendiri tanpa opsi operan aman membuang bola ke arah garis samping (60–95% menurut Keputusan); (2) lebar menyerang 1,2 → 1,35 & tarikan ke bola 0,2 → 0,15 (pemain sayap dekat garis samping); (3) **umpan silang kelewatan** 8–25% (menurut Passing) melewati semua pemain; (4) umpan silang rendah yang diblok bek ≤ 16 m dari gawang sendiri kadang membelok (efek terukur kecil — umpan silang hampir selalu duel udara)
   - hasil (30 laga): lemparan **2,7 → 11,5**, tendangan gawang **3,8 → 4,9**, pojok tetap ~1,4. Masih jauh dari nyata; tiga percobaan, dihentikan. Sisa penyebab: tembakan terlalu akurat (sedikit yang melebar → sedikit tendangan gawang), operan gagal selalu dipotong (tidak ada operan yang kelewatan keluar)
   - kalibrasi 200 laga: **gol 2,61 ± 0,22** (tengah target 2,4–3,0), 0–0 8%, kejutan 13 vs 11 **20%** (batas atas target 10–20%) — tim lemah kini lebih sering mencuri hasil. Uji keseimbangan taktik (mentalitas, formasi) BELUM diulang setelah perubahan lebar
8f. ✅ Pemain keluar lewat garis terdekat & ball boy (31 Okt; masukan: "pemain keluar jalan lambat & transparan — bola menembusnya"):
   - aturan IFAB Law 3 (2019): pemain yang diganti / dikartu merah keluar lewat TITIK GARIS TERDEKAT (garis gawang hanya bila tidak di depan gawang), berjalan cepat (±3,3 m/s), digambar normal; jeda bola mati MENUNGGU ia keluar (paling lama 7 dtk). Uji 25 laga: 0 kejadian pemain keluar saat bola hidup; median 6,8 dtk; jeda per laga hanya +5 dtk (keluar bersamaan dengan jeda yang memang ada)
   - ball boy (tampilan saja): 5 di tiap garis samping, 2 di belakang tiap gawang. Bola keluar → bila ada pemain ≤ 5 m, ia membawa bola ke titik eksekusi; kalau tidak, ball boy terdekat melemparnya melambung (±1 dtk). Engine hanya mencatat titik keluar (`ball.outFrom`)
8g. ⚠️ Taktik empat kotak (31 Okt; keputusan pengguna: dibagi dengan bola / tanpa bola / kehilangan bola / merebut bola; counter-press adalah pilihan pengguna):
   - `tactics.js` menggantikan `mentality.js`: DENGAN BOLA (formasi, lebar, tempo, umpan silang), TANPA BOLA (formasi, garis bek rendah/normal/tinggi, tekanan rendah/sedang/tinggi), KEHILANGAN BOLA (counter-press: 2 pemain tambahan menekan ±5 dtk / seimbang / mundur ke posisi), MEREBUT BOLA (serangan balik / seimbang / bangun ulang). Tiap pemain punya slot & peran dengan bola dan tanpa bola; bentuk bergeser mulus (±1,5 dtk). Formasi baru: 3-2-5, 5-4-1, 3-4-3. Taktik bawaan = permainan lama (kalibrasi tidak berubah)
   - AI pelatih hanya untuk tim AI: kalah jumlah → garis rendah. Tim pengguna tidak diubah AI
   - kalibrasi 200 laga (taktik bawaan): gol 2,65 ± 0,23, 0–0 6%, kejutan 13 vs 11 14%
   - **uji keseimbangan (200 laga per pilihan, kontrol +0,65)**: dengan bola 3-2-5 **+1,58** ✗ (dominan), garis tinggi **+1,07** ✗ (lebih tajam DAN lebih aman), garis rendah −0,13 (lebih bocor — masalah lama), tekanan rendah −0,07, counter-press +0,35, mundur −0,01, serangan balik +0,13, bangun ulang +0,28, lebar +0,31, tanpa bola 5-4-1 −0,02
   - tiga percobaan menghukum bentuk menyerang (lari ke belakang bek sesuai luas ruang; transisi bertahan 4,5 dtk; serangan balik otomatis saat lawan terbuka) — **tidak berefek, dikembalikan**
   - **akar masalah ditemukan**: selisih 3-2-5 hampir seluruhnya dari TEMBAKAN LUAR KOTAK (gol 0,31 → 1,25 per laga; konversi 10,7% → 32%; nyata ~3–5%). Bukan karena kiper terhalang (uji tanpa efek "terhalang": tetap 35%). Model tembakan/kiper untuk tembakan dari tepi kotak tanpa tekanan terlalu tajam — kalibrasi tembakan & kiper adalah langkah berikutnya (juga akan menambah tendangan gawang)
8h. ⚠️ Kalibrasi tembakan jarak jauh (31 Okt):
   - diagnosis (60 laga): kiper menyelamatkan 70% tembakan tepat sasaran (wajar). Masalahnya simpangan tembakan berupa SUDUT TETAP di semua jarak, jadi tembakan 20 m sama terkontrolnya dengan 8 m: konversi 16–22 m 16% (nyata ~5–7%), 22–28 m 5% (nyata ~3%)
   - perbaikan: simpangan dikali `1 + 0,1 × (jarak − 12 m)` (`SHOT_RANGE` di shooting.js) — 19 m ×1,7, 25 m ×2,3, 30 m ×2,8. Percobaan 1 (0,06/m) masih 12% di 16–22 m; percobaan 2 (0,1/m) dipakai
   - hasil (60 laga): 16–22 m **16% → 9%**, 22–28 m **5% → 3%**, > 28 m 4% → 0%; melebar dari luar kotak 19–30% → 36%
   - kalibrasi 200 laga: gol **2,52 ± 0,20**, 0–0 5%, kejutan 13 vs 11 14%, tembakan 11,5/tim
   - keseimbangan taktik (200 laga, kontrol +0,47): 3-2-5 **+1,57** ✗, garis tinggi **+1,03** ✗ — TIDAK berubah. Gol jarak jauh 3-2-5 turun 1,25 → 0,32 per laga (perbaikan bekerja), tetapi keunggulannya pindah ke DALAM KOTAK: gol kaki di kotak 1,03 → 1,96 per laga. Diagnosis tembakan jauh sebelumnya hanya sebagian benar: masalah 3-2-5 sebenarnya 5 penyerang melawan 4 bek tanpa ada yang turun menjaga. Perlu tahap tersendiri (penjagaan orang di kotak / bek sayap ikut turun), bukan penyetelan tembakan lagi
   - sisa selisih dari nyata (lihat juga 8i): konversi total 16% (nyata ~10–11%) karena tembakan dekat < 11 m terlalu sering masuk (~30%) dan jumlah tembakan rendah (11,5 vs ~13 nyata per tim)
8i. ⚠️ Studi keseimbangan taktik: 3-2-5 & garis tinggi (31 Okt; keputusan pengguna: ukur dulu, baru perbaiki):
   - tiga percobaan penjagaan kotak (penyerang di zona bahaya dijemput; penjemput menempel penuh; penutup jalur tembak selalu ada di ≤ 22 m) — **tidak berefek, dikembalikan**. Pengukuran menunjukkan 82% penyerang di zona bahaya memang sudah dijaga
   - pembongkaran sumber tembakan kotak 3-2-5 (30 laga): yang membengkak adalah **operan lawan dari dekat gawangnya yang dipotong** (gol 0,20 → 1,00 per laga). Operan kiper lawan dipotong 22,8% (bawaan 6,9%), 65% dari bola mati
   - **akar: bug** — selama jeda bola mati `shapeBlend` dibekukan, jadi tim yang baru kehilangan bola tetap berbaris dalam bentuk DENGAN BOLA: lima penyerang 3-2-5 berdiri di jalur tendangan gawang lawan. Perbaikan `settleShapesAtStoppage`: selama jeda bentuk bergeser menuju pemilik bola mati
   - hasil 200 laga: 3-2-5 **+1,57 → +0,64…+0,69** (kontrol +0,47…+0,52; menang 49–52%) ✓. Kontrol & kalibrasi tidak berubah (formasi bawaan sama dengan dan tanpa bola)
   - garis tinggi: lawan hanya menembak ±7,5 kali per laga (bawaan ±12). Terobosan tanah lawan bertambah (1,7 → 4,2 per laga) tetapi 59% dipotong tepat di garis bek, dan lawan malah lebih jarang lolos 1 lawan 1 (1,70 → 0,93). Engine belum punya hukuman nyata garis tinggi
   - ditambahkan **bola lambung ke belakang garis** (`OVER_TOP` di attack.js): untuk pelari yang sedang berlari, bila terobosan tanah tidak aman, ruang di belakang garis ≥ 22 m, dan pelari bisa tiba ≥ 0,2 dtk lebih dulu dari pemain bertahan mana pun; peluang 60% per keputusan; meleset menurut Passing. Lawan garis tinggi: lambungan ±2,9 per laga (dimenangkan 33%), lolos 1 lawan 1 0,93 → 1,27, gol dari situ 0,10 → 0,27 (30 laga)
   - tetapi keseimbangan 200 laga TIDAK berubah: garis tinggi **+1,09** ✗ (lawan tetap ±7,7 tembakan). Percobaan 2 (lambungan lebih berani: 90%, tanpa selisih waktu) juga tidak berefek → dikembalikan. Bola lambung dipertahankan karena mekanismenya sendiri bekerja dan realistis
   - kalibrasi 200 laga dengan bola lambung: gol **2,44 ± 0,20** (batas bawah target), 0–0 6%, kejutan 13 vs 11 13%; tim 13 menang 72% (dulu 65%) — sedikit di atas rentang wajar 30–70%
   - yang belum diketahui: kenapa garis tinggi menekan tembakan lawan sebanyak itu. Yang terukur: lawan lebih sering kehilangan bola di sepertiga awalnya (rebutan di sepertiga lawan 9,9 → 13,4 per laga) dan lebih jarang memegang bola di sepertiga akhir (22% → 18%). Garis tinggi juga tidak menguras tenaga lebih (tenaga akhir sama)
   - studi lanjutan (1 Nov, 30 laga): corong serangan lawan — penguasaan lawan mulai di sepertiga awalnya 36% → 47%, sampai sepertiga akhir 48% → 39%, **direbut di sepertiga awal 4,7 → 7,4 per laga** (lonjakan terbesar). Saat direbut: lawan memegang bola ±0,5 dtk, pemain kita sudah ±2 m saat bola diterima, 60% masih punya operan aman; kiper ikut direbut. Penyebab langsung: pemain yang ditekan butuh 0,4 dtk sebelum boleh melepas bola, dan blok yang 5 m lebih tinggi sudah menempel saat bola tiba
   - percobaan 3: di sepertiga sendiri, pemain yang ditempel (≤ 3 m) melepas bola dengan sentuhan pertama — **memperburuk** (direbut 14,9 per laga, gol ±4 per laga: operan seketika banyak salah arah) → dikembalikan. Batas tiga percobaan tercapai
   - kemungkinan arah berikutnya (BELUM diuji): pengoper menghindari penerima yang akan langsung ditempel di sepertiga sendiri (kini hanya jalur bola yang dinilai, bukan tekanan di penerima); kiper membuang jauh saat penyerang lawan dekat
   - ronde pilihan operan (1 Nov): pengukuran "waktu luang penerima" operan dari sepertiga sendiri — melawan garis tinggi 19,6 operan per laga dilakukan walau lawan tiba < 0,15 dtk setelah bola (hilang 42%). Itu operan yang DIPAKSA (terlalu lama tanpa opsi aman), bukan salah pilih penerima. Jalan keluar yang hilang: bola panjang ke depan
   - percobaan 1: **bola panjang** (`LONG_BALL`, cabang `percobaan/bola-panjang`) — dipaksa di sepertiga sendiri tanpa operan aman → 60% tendang panjang ke penyerang terdepan (duel udara). Direbut di sepertiga awal lawan garis tinggi 7,5 → 4,2. Uji 200 laga: garis tinggi +0,67 vs kontrol +0,28 (kelebihan 0,57 → 0,39) — membaik, TETAPI gol 2,44 → **2,00**, 0–0 **13%**, tembakan 9,6 per tim (di luar target). Banyak gol selama ini lahir dari bola yang hilang di dekat kotak sendiri
   - percobaan 2 (bola panjang 30%): gol tetap ±2,25. Percobaan 3 (ambang tembak diturunkan 25%): tembakan tidak bertambah — ambang bukan penghambat. Keduanya dikembalikan
   - keputusan menunggu pengguna: bola panjang belum digabung ke main. Akar yang terlihat: engine menciptakan sedikit peluang dari serangan terbangun (±9–12 tembakan per tim, nyata ±13)
8j. ✅ Taktik 5 jalur (1 Nov; keputusan pengguna: lapangan dibagi kiri / half-space / tengah / half-space / kanan):
   - DENGAN BOLA: **fokus serangan** seimbang / kiri / tengah / kanan — gelandang & penyerang bergeser 3 m ke sisi itu (garis belakang tetap), "tengah" merapatkan lebar ×0,85. TANPA BOLA: **lindungi** seimbang / tengah (blok ×0,85, lawan dipaksa ke sayap) / sayap (blok ×1,15). PER PEMAIN (dengan bola): tetap di jalur / masuk half-space / melebar / naik ke kotak (`laneSlot` di tactics.js; kiper & pemain lawan ditolak; pemain masuk mewarisi instruksi). Bawaan = permainan lama
   - fokus memindahkan permainan (10 laga, bola di separuh lawan per jalur kiri→kanan): seimbang 23/18/14/21/24%, fokus kiri 26/20/17/20/17%
   - uji keseimbangan (100 laga per pilihan; kontrol +0,59, ketidakpastian ±0,17): fokus tengah +0,57, lindungi sayap +0,58, bek sayap ke half-space +0,35, fokus kiri (geser 3 m) +0,13, lindungi tengah −0,05, sayap ke half-space −0,18, enam pemain ke kotak −0,97. **Tidak ada pilihan yang dominan**, tetapi beberapa pilihan lebih lemah melawan lawan bawaan (pilihan "jebakan"). Fokus kiri dua percobaan: geser 6 m semua pemain −0,02; tanpa garis belakang −0,42; geser 3 m +0,13 (dipakai)
   - batasan uji: lawan selalu taktik bawaan, jadi nilai situasional sebuah pilihan (mis. lindungi tengah melawan tim yang main di tengah) belum terukur
8k. ⚠️ Layer posisi & tempel lawan (1 Nov; ide pengguna: "beberapa layer lapangan; di tiap layer menentukan arah gerak pemain — bukan kaku, tetapi bobot besar"):
   - gambar 5 jalur di tab Tim: dua lapangan (dengan bola / tanpa bola), posisi dihitung dengan rumus jangkar engine (bola di tengah). **Seret bulatan** → titik patokan pribadi (`customIn` / `customOut`, slot di bingkai tim). Titik → slot dengan bagi-dua memakai computeAnchor sendiri (`slotForPoint`, kembali ≤ 0,6 m). Tanpa bola tim merapat ke bola, jadi titik di pinggir ditarik ke dalam. Prioritas: posisi diseret > instruksi jalur > formasi. Ganti formasi di satu layer menghapus titik layer itu. "Kembali ke formasi" per layer
   - **tempel lawan** (`marking`, `MAN_MARK` di marking.js): penjaga orang lengket pada satu lawan (`team.manMarks`), radius 45 m, tarikan 0,9; tidak ikut penjagaan zona; bek yang menempel tidak menahan garis
   - pemain masuk mewarisi semua instruksi pribadi (jalur, posisi, penjagaan)
   - uji ekstrem (100 laga; kontrol +0,59): semua tempel lawan +0,56 ≈, penyerang ikut turun −0,38, semua parkir di depan kotak −0,79, semua di sayap kiri −1,15 — wajar. **Garis bek di garis tengah (tanpa bola) +2,20, menang 84%** ✗
   - penyebab: lawan yang terkurung tidak pernah memulai lari (syarat pemegang bola ≥ 37 m dari gawangnya), jadi ruang ±60 m di belakang garis tidak pernah dihukum. Perbaikan 1: lari boleh dimulai dari area sendiri bila ruang di belakang garis lawan ≥ 45 m (`DEEP_SPACE_RUN`). Perbaikan 2: bola lambung ke belakang garis sampai 60 m (dulu 45). Percobaan 3 (tembak satu lawan satu dari 18 m, dulu 14) tidak berefek → dikembalikan
   - hasil 200 laga: garis di garis tengah **+1,06** vs kontrol +0,34 (kelebihan ±1,6 → 0,72); garis tinggi +0,80 (kelebihan 0,57 → 0,46). Lawan kini lolos 1 lawan 1 ±6,7 kali per laga tetapi hanya 13% jadi gol (sering tersusul bek)
   - kalibrasi 200 laga: gol **2,32 ± 0,20** (sedikit di bawah target 2,4), 0–0 8%, kejutan 13 vs 11 12%
   - menunggu keputusan pengguna: batasi seberapa tinggi titik tanpa bola boleh diseret, atau biarkan
   - DICATAT UNTUK NANTI (permintaan pengguna): layer **lintasan/rute** — panah gerak pemain untuk skema rinci (mis. lari diagonal saat bola di sisi lain)
8m. ✅ Detail 8 zona (2 Nov, layer 3 dari rencana 8l):
   - engine: `zoneIn` / `zoneOut` = zona → { pemain → slot }. Zona bola di bingkai tim (sendiri/lawan × kiri/kanan); bobot campuran halus (`zoneWeights`, pita peralihan 16 m di garis tengah & 12 m di tengah lebar; jumlah bobot 1; di tengah zona = zona itu saja). Slot = campuran slot zona (bila diatur) atau slot layer biasa. Ganti formasi di satu layer menghapus detail zona layer itu; pemain masuk mewarisi; `mirrorZone` memetakan pemain ke pasangannya di sisi lain (bek kiri ↔ bek kanan) dengan penugasan optimal
   - tampilan: kotak ④ "Detail zona" — satu lapangan, saklar tanpa/dengan bola, pilih zona (zona lain digelapkan, pemain tetap terang & bisa diseret), bola contoh di tengah zona, bayangan posisi layer biasa, "Cermin ke …", "Kosongkan zona", penanda jumlah pemain diatur per zona
   - uji ekstrem (100 laga, kontrol +0,42): rest-defence (bek tetap di tengah saat menyerang di kubu lawan) +0,64; garis bek di garis tengah hanya saat bola di kubu lawan +0,83 (mirip masalah garis tinggi 8i/8k); tumpuk di kiri ala PSG **+0,11** (lebih lemah)
   - **temuan**: umpan pindah sisi hampir tidak pernah terjadi — 0,05 per laga, walau 85% waktu ada rekan bebas di sisi jauh saat bola di kiri kubu lawan. Skema menumpuk menciptakan celah yang tidak dimanfaatkan → langkah 2 rencana: mekanisme umpan pindah sisi
   - penalti (masukan pengguna: barisan kaku dua kolom): 2 bek tim penendang berjaga di ±50 m, 1 penyerang tim bertahan di ±40 m; sisanya tersebar di 3 baris depan kotak + sisi kotak (di belakang titik penalti), geseran tetap per pemain, dijaga tetap di luar busur; peluit tidak menunggu pemain yang berjaga jauh
8n. ✅ Umpan pindah sisi (2 Nov, langkah 2 rencana 8l):
   - `SWITCH` di attack.js: pemegang bola ≥ 45 m dari gawang sendiri & ≥ 10 m dari tengah lebar; penerima di sisi seberang (≥ 12 m dari tengah), bebas (tak ada lawan ≤ 10 m), 25–50 m, tidak offside, tidak mundur jauh → bola lambung diagonal, mendarat setinggi dada 3 m di depan penerima (tak bisa dipotong di jalan; meleset menurut Passing; diperebutkan saat mendarat). Peluang per keputusan 2,5–9% menurut Visi, ×1,5 bila operan terbaik tidak maju/tidak aman/ditekan. Statistik `switches`
   - percobaan 1 (12–40%): 21 per laga — terlalu sering, gol tim turun (menggantikan permainan yang lebih bagus). Percobaan 2 (dipakai): **±6 per laga per tim, ±50% sampai** (dulu < 0,1)
   - uji 100 laga: kontrol −0,09 (sebelumnya +0,34…+0,59 — keunggulan tim kandang demo hilang; tim tamu "cepat & mengalir" tampaknya lebih diuntungkan, belum diteliti), tumpuk kiri ala PSG −0,21 (selisih ke kontrol 0,31 → 0,12: celah kini dimanfaatkan)
   - kalibrasi 200 laga: gol **2,35 ± 0,21** (sedikit di bawah target 2,4), 0–0 **10%** (batas atas), kejutan 13 vs 11 16%, tembakan 11,1 per tim
8o. ⚠️ Strategi detil (2 Nov, layer 4 — rencana 8l, dimajukan atas keputusan pengguna):
   - engine `scripts.js`: SYARAT UTAMA = bola dipegang pemain yang ditentukan di zona skrip + pemain skrip di posisi zonanya (±4 m). Langkah: pemicu (mulai / operan dilepas / operan diterima / pemain sampai / waktu) + aksi (oper, lari ke titik, giring ke titik, umpan silang ke titik, tembak). Aksi pemegang bola MEMAKSA keputusan; hasilnya tetap fisika (operan bisa dipotong, umpan silang diperebutkan). Batal bila bola hilang / bola mati / batas waktu (12 dtk total, 6 dtk per pemicu); jeda 8 dtk sebelum skrip yang sama boleh lagi. Titik di bingkai tim (benar setelah ganti babak). Pemain masuk menggantikan id di semua skrip. Statistik per skema (aktif / selesai / batal / tembakan)
   - editor di papan Detail zona (fase dengan bola): nama, syarat utama (pemegang bola + chip pemain), langkah & aksi dari menu, titik dipilih dengan klik lapangan, panah bernomor (operan kuning, lari biru, giring hijau, umpan silang oranye, tembakan merah); penanda "🧩 Skema … · langkah n/m" saat laga
   - uji skrip ekstrem membongkar KELEMAHAN ENGINE yang tak terlihat di permainan AI biasa: (1) penggiring hampir tak dihadang (bek terdekat 3,7 m, ±4 tekel per laga dari ±113 dtk menggiring) — skrip "giring masuk kotak lalu tembak" +1,75 di atas pembanding; (2) umpan silang dari garis gawang + bola kedua — +1,87
   - ronde realisme (pengguna memilih "ikuti realistis"): bek kedua menghadang di zona bahaya (≤ 25 m dari gawang atau sedalam kotak penalti) walau kalah jumlah; tekel ×3 lebih sering & +10% berhasil saat penggiring datang lurus ke bek (`HEAD_ON`); pertahanan kotak (`BOX_DEFENSE`: bek & DM mengisi tiang dekat, tengah, tiang jauh, titik penalti, tepi kotak saat umpan silang / pojok); sundulan dibidik 1,2 m dari tiang (dulu 0,7) & simpangan 0,16/0,06 (dulu 0,2/0,08) — konversi sundulan 2–4% → ±5% (nyata ±10%). Percobaan "sundulan dikawal lebih buruk" tidak berefek → dikembalikan (sundulan bukan sumber masalah). Gol per umpan silang biasa 5% → ±3–4% (nyata ±2–3%)
   - pertahanan yang lebih realistis menurunkan gol ke 2,06; dikalibrasi dengan **zona umpan silang lebih lebar** (≤ 35 m dari garis gawang, ≥ 8 m dari tengah; umpan silang ±9 → ±12 per tim, nyata ±15–20)
   - kalibrasi 200 laga: gol **2,60 ± 0,23**, 0–0 8%, tembakan 12,6 per tim, kejutan 13 vs 11 13% ✓
   - operan skema TIDAK lagi batal diam-diam bila penerima di luar jarak pandang / < 4 m / terlihat offside (keputusan pengguna: "sampai atau tidaknya urusan stat pemain"): operan tetap dilepas ke arah lari penerima, laju dari jarak + stat Passing; makin jauh makin mudah dipotong / tak sampai. Uji bek → penyerang dari zona sendiri: batal 34 dari 50 → 6 dari 68. Nomor langkah di gambar dipindah ke ±5 m dari pangkal panah (dulu di tengah garis, terbaca seperti titik singgah)
   - saat mengedit skema papan TERKUNCI di zona skema (masukan pengguna: klik zona lain untuk menaruh titik di luar zona ikut memindahkan skema & bentuk formasi, jadi arah operan berubah). Zona skema diganti lewat "Zona awal" di editor; titik aksi boleh di mana saja lewat "Pilih titik"
   - aksi per langkah 4 → 6 (1 aksi pemegang bola + sampai 5 pelari); tombol "+ aksi" jadi "+ Pemain lain lari" dengan keterangan bahwa pemain mana pun boleh diberi lari (pengguna mengira hanya penerima yang bisa digerakkan)
   - MASALAH DIKETAHUI (60 laga, ketidakpastian ±0,35): skrip giring ±+1,45 di atas pembanding setelah kalibrasi (sebelum kalibrasi +0,60) dan skrip umpan silang dari garis gawang ±+0,9. Percobaan memicu pertahanan kotak hanya bila umpan silang dekat (≤ 22 m): skrip giring +1,05 tetapi gol turun ke 2,30 → dikembalikan. Hasil yang makin kecil — dilanjutkan di ronde beres-beres setelah lawan AI bervariasi
8p. ✅ Kelompok tahap 1 (2 Nov, ide pengguna — trio kecil ala PSG / "relationism"; riset: positional play = layer 2 kita, relationism = hubungan antarpemain di atasnya):
   - `groups.js`: KELOMPOK = { zona, 2–4 anggota } (maks 4 per zona, 16 total, kiper tidak boleh). AKTIF bila bola di zona itu & dipegang SIAPA SAJA anggota (pilihan B pengguna), dan tidak ada skema berjalan (skema menang)
   - efek (kecenderungan, bukan paksaan; syarat "operan aman" tidak berubah): rekan sekelompok +0,5 nilai operan; pemain ketiga (bola dari rekan sekelompok → anggota LAIN) +0,3 lagi
   - UI di papan Detail zona (dengan bola): "+ Kelompok baru" → klik pemain di lapangan untuk masuk/keluar → garis berwarna antar anggota; statistik laga (operan saat kelompok aktif, ke rekan sekelompok, pemain ketiga)
   - uji keseimbangan (tim kandang 4-4-2 vs AI, 180 laga per kelompok uji): tanpa kelompok selisih gol +0,09; 4 kelompok isi 4 (sayap+gelandang+penyerang) +0,34 → beda +0,25 ± ±0,17 (belum pasti, tidak tampak eksploit); operan sukses 66,5% → 67,6%. Trio di zona sendiri (60 laga): operan antaranggota 3,9 → 7,3 per laga, tembakan sedikit turun (lebih banyak operan pendek di belakang)
   - TAHAP 2 (belum): juru kunci (opsional) bergeser membentuk segitiga (batas ±15 m, utamakan jalurnya) + "oper lalu bergerak" (±8 m)
   - skema: saran "3 langkah atau kurang" + peringatan bila > 3 langkah; persentase selesai di daftar skema
8l. 📝 RENCANA (2 Nov, keputusan pengguna): detail 8 zona = BERIKUTNYA; Strategi detil = PALING AKHIR setelah semua yang lain selesai
   - **Layer 3 — detail 8 zona**: lapangan dibagi 4 zona bola (sendiri kiri/kanan, lawan kiri/kanan) × 2 layer (dengan bola / tanpa bola). Per zona: seret POSISI (bukan formasi baru — peran pemain tetap). Zona kosong memakai posisi layer biasa; pergantian antarzona dicampur halus menurut posisi bola; tombol "salin ke sisi lain (cermin)"; bayangan posisi layer biasa. Alasan pengguna: shape rusak karena jarak kembali ke posisi terlalu jauh (2 layer saja tidak cukup), menyiapkan serangan balik / rest-defence, skema menumpuk di satu sisi lalu memanfaatkan sisi jauh (contoh PSG). Kemungkinan perlu mekanisme **umpan pindah sisi** (lambung diagonal) — ukur dulu
   - **Layer 4 — "Strategi detil"** (nama dari pengguna), ada di tiap 8 zona: skrip yang MEMAKSA keputusan (oper ke siapa, lari ke mana, tembak), tetapi HASIL tetap fisika + kualitas pemain (operan bisa dipotong/meleset). Model syarat pengguna: SYARAT AWAL = pemain yang terlibat berada di posisi yang ditentukan (toleransi radius ±4 m, hanya pemain di skrip) + bola di pemain yang ditentukan; tiap langkah dipicu aksi sebelumnya — lari dimulai saat operan DILEPAS, operan berikutnya saat bola DITERIMA; batal bila syarat awal tak tercapai dalam beberapa detik atau bola hilang → pemain kembali memutuskan sendiri. Syarat "jalur terbuka" hanya opsional nanti. Catatan: lawan AI tidak belajar — skrip kuat bisa berulang; mungkin perlu lawan "membaca" pola berulang
   - lintasan/rute lari (8k) masuk ke Strategi detil
7. Baru setelah itu: layer manager (skuad, taktik, lalu liga).

## 7. Keputusan yang Masih Terbuka

- ~~Kepercayaan diri: murni nerf atau bisa memberi bonus?~~ Diputuskan 28 Okt pagi: murni nerf. **Dibalik 28 Okt siang atas permintaan: ada "on fire"** — percaya diri ≥ 0,9 memberi bonus kecil (blunder paling banyak −15%, ambang tembak ×0,9). Bonus dibatasi supaya tidak jadi bola salju.
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
- Catatan pengujian tahap 6 (32–64 laga): tenaga akhir pemain lapangan p10/p50/p90 = 0,42 / 0,52 / 0,64 (korelasi dengan Stamina 0,52); pemain berada di percaya diri < 0,4 sekitar 4% waktu; gol babak 1 vs babak 2 = 0,56 vs 0,81 (lelah membuka pertandingan di akhir); sapuan panik ~3,7 per laga, ~40% keluar lapangan. Titik nol 1,28 ± 0,29 (tidak berubah nyata). Kejutan 13 vs 11 turun sedikit ke 11% (dari 19–22%) — masih di dalam rentang sehat, belum disetel; awasi. Setelah on fire: titik nol 1,09 ± 0,23 dan kejutan 13% — selisih dengan sebelumnya masih di dalam rentang ketidakpastian (on fire hanya 0,3% waktu, jadi kemungkinan besar derau).
- Titik nol (1,8–1,9) masih di bawah target baru 2,4–3,0, dan laga 0–0 di pertandingan web ~20% (target ≤ 10%). Penyebab yang tersisa dari diagnosis: penilaian keamanan operan meleset, dan belum ada bola mati (pelanggaran, tendangan bebas, penalti — di sepak bola nyata sekitar seperempat gol). Dulu tertulis: titik nol sedikit di bawah target lama 2–4 (1,88). Percobaan ke-3 sengaja belum dilakukan; diputuskan setelah ditonton. Kandidat: operan dipotong di sepertiga akhir (penilaian keamanan operan juga meleset — operan yang dinilai "tidak aman" tetap sukses 61%, yang "aman" gagal 20%), tim kuat 15 vs 9 jadi lebih dominan (gol 4,2 vs 0,1).
- Belum ada: pelanggaran & kartu (dan Temperamen), tendangan bebas, pergantian pemain.

## 8. Aturan Anti-Melenceng

Sebelum menambah sesuatu, tanyakan:

1. Apakah ini membuat **pertandingan terlihat lebih hidup**, atau hanya menambah fitur?
2. Apakah tahap pengembangan sebelumnya sudah terasa benar saat ditonton?
3. Apakah ini masih **hitungan murni, berjalan di browser, tanpa biaya**?
4. Apakah ini melanggar batasan di bagian 2?

Kalau jawaban 1–3 "tidak" atau jawaban 4 "ya", tunda idenya dan catat di bagian 7 atau daftar ide terpisah.

Pengingat: setelah prototipe berjalan, **menonton dan menyetel angka lebih berharga daripada menambah sistem baru.**
