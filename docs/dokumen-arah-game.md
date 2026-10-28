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
7b. Rencana (disepakati 28 Okt): pelanggaran dari tekel, keuntungan (advantage), tendangan bebas, kartu kuning, stat Temperamen, Ketegasan wasit (wasit bisa tidak melihat), ~12–16 pelanggaran per laga. Tambahan permintaan: **pertikaian antarpemain** dan **kartu untuk protes berlebihan** — desain disepakati saat 7b dimulai
7c. Rencana: penalti, kartu merah (tim main dengan 10 orang)
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
