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
