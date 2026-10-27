# Dokumen Arah Pengembangan — Web Manager Bola

Dokumen ini adalah pegangan utama proyek. Sebelum menambah fitur atau mengubah sistem, cek dulu ke sini. Kalau sebuah ide bertentangan dengan dokumen ini, ubah dokumennya secara sadar dulu, jangan diam-diam di kode.

Terakhir disepakati: 26 Oktober 2026

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
4. Tembakan dan gol; tekel ke pemain yang sedang menggiring → pertandingan bisa selesai dengan skor.
5. Noise berdasarkan stat teknis (blunder).
6. Lapisan psikologis dan kelelahan.
7. Baru setelah itu: layer manager (skuad, taktik, lalu liga).

## 7. Keputusan yang Masih Terbuka

- **Kepercayaan diri: murni nerf, atau bisa memberi bonus kecil** (pemain "on fire")? Murni nerf lebih mudah diseimbangkan; bonus menambah drama. Belum diputuskan.
- Stat kiper: dimasukkan sejak awal atau menyusul.
- Angka detail (bobot tarikan, jumlah tick per detik, batas nerf) — ditentukan lewat pengujian prototipe, bukan diskusi.
- Catatan pengujian tahap 3: jumlah operan (~1.100/tim/90 menit) dan pergantian penguasaan (~580) masih sedikit di atas rentang wajar. Penyebab utamanya tekanan lawan yang selalu berhasil mendekat; ditinjau ulang setelah tekel dan noise stat ada.

## 8. Aturan Anti-Melenceng

Sebelum menambah sesuatu, tanyakan:

1. Apakah ini membuat **pertandingan terlihat lebih hidup**, atau hanya menambah fitur?
2. Apakah tahap pengembangan sebelumnya sudah terasa benar saat ditonton?
3. Apakah ini masih **hitungan murni, berjalan di browser, tanpa biaya**?
4. Apakah ini melanggar batasan di bagian 2?

Kalau jawaban 1–3 "tidak" atau jawaban 4 "ya", tunda idenya dan catat di bagian 7 atau daftar ide terpisah.

Pengingat: setelah prototipe berjalan, **menonton dan menyetel angka lebih berharga daripada menambah sistem baru.**
