# Menejer Bola

Game manajer sepak bola berbasis web. Kamu meracik taktik, lalu menonton laganya berjalan sendiri dari sudut pandang atas. Setiap pemain tampil sebagai jersey bernomor punggung dengan nama di bawahnya, dan bergerak dengan "otak" dari hitungan murni (tanpa AI/ML): posisi, instruksi, stat, kondisi fisik, dan psikologi. Termasuk blunder manusiawi.

**Main sekarang:** [versi web](https://claude.ai/artifact/FYF5oCDn7brWZ7158iJdFX), tanpa instalasi, bahasa Indonesia & English. Karier tersimpan otomatis di browser.

> Status: **tahap uji.** Semua fitur di bawah sudah bisa dimainkan, tetapi angka keseimbangannya (perkembangan pemain, pemecatan, tawaran klub, kekuatan taktik) baru diuji lewat simulasi, belum oleh pemain sungguhan. Masukan sangat ditunggu.

```
racik taktik ──▶ hari demi hari (latihan, istirahat, kejadian) ──▶ laga disimulasikan ──▶ klasemen, karier
     ▲                                                                                       │
     └──────────────────────── ubah taktik, latih skema, atur skuad ◀────────────────────────┘
```

## Fitur

### Pertandingan
- 22 pemain bergerak dengan inersia, 10 tick per detik; 2 babak × 5 menit nyata (jam 0'–90'), kecepatan 1×–8×.
- Operan, giringan, tembakan, sundulan, umpan silang, umpan terobosan, bola lambung ke belakang garis bek, umpan pindah sisi.
- Offside dengan hakim garis yang bisa salah, pelanggaran, keuntungan, kartu kuning/merah, penalti, protes dan pertikaian, tim 10 orang, kiper darurat.
- Stat teknis (kecepatan, operan, penyelesaian, duel udara, dll.) dan psikologis (ketenangan, determinasi, kecerobohan, insting gol, dll.). Stat psikologis bekerja sebagai pengurang stat teknis; kelelahan dan kepercayaan diri berubah sepanjang laga.
- Rata-rata ±2,4–2,6 gol per laga (patokan liga besar Eropa 2,6–3,2).

### Taktik (dari sederhana sampai rumit)
- **Template taktik** ★1–★5 (mis. 4-4-2 Klasik, Blok rendah, Gegenpress, Posisional). Tiap template menunjukkan kecocokan skuad dan saran pemain. Tim butuh waktu untuk **memahami** template: kurang paham → posisi melenceng, skema batal, pressing longgar.
- Lapisan manual: formasi, mentalitas, tempo, empat fase (dengan/tanpa bola, transisi), 5 jalur, posisi seret per pemain, tempel lawan, detail per zona, bola mati.
- **Strategi detil**: skema per zona (pemicu → oper / lari / giring / umpan silang / tembak).
  - **Pustaka skema** berisi 7 skema siap pakai.
  - **🏋️ Latihan skema**: animasi 10 ulangan melawan formasi pilihan. Skema bisa diubah saat latihan berjalan, dan hasilnya menambah **penguasaan** skema itu. Skema yang belum dikuasai lebih sering batal di laga.
  - **🧪 Uji cepat**: % keberhasilan melawan 4 formasi.

### Karier
- 3 kasta × 20 klub, musim 38 pekan, promosi/degradasi + play-off. Ajang tambahan: Piala Nasional, Piala Liga, Piala Super, Kejuaraan Elite. Bebas memilih klub mana pun.
- **Hari demi hari**: hari berjalan otomatis dan berhenti saat ada kejadian penting atau hari laga.
  - Kejadian: sakit, izin, cedera latihan, sesi taktik terjadwal, tawaran melatih klub lain.
  - **Porsi latihan vs istirahat** (slider persen): latihan menaikkan stat sedikit demi sedikit tiap hari; istirahat memulihkan kondisi.
- Skuad: umur & potensi (bintang), perkembangan dan penurunan, cedera/sakit/skors, kontrak & gaji, bursa transfer, rotasi pemain lelah.
- **Profil manajer**: reputasi, rekam jejak per klub, trofi. Dewan direksi punya target dan kepercayaan; hasil buruk bisa berujung **dipecat**. Klub yang lebih besar menawarimu pekerjaan kalau reputasimu cukup.
- Statistik: top skor/assist per ajang, rating per laga, penghargaan musim.

### Suara
- Musik latar orisinal yang disintesis langsung oleh game (Web Audio), peluit wasit (pendek untuk pelanggaran, panjang untuk mulai/akhir), dan penonton yang makin riuh saat serangan berbahaya dan meledak saat gol.
- Komentar teks di atas lapangan.

## Mode rekam (untuk video promosi)

Aktifkan dengan `?rekam=1` di alamat, atau ⚙️ → **Mode rekam**. Pemain biasa tidak melihat apa pun.
- Di bar kontrol muncul `⏺ 03:12.4 · 132 kejadian [⬇ JSON] [⬇ SRT] [📋]`. Kode waktu itu sama persis dengan `tMs` di log, dihitung dari jam dinding sejak banner "PRIIIT! Kick-off" babak 1. Jeda dan kecepatan 1×–8× tetap terhitung.
- **JSON** berisi semua kejadian (gol, tembakan, penyelamatan, blunder beserta perkiraan penyebabnya, tekel, pelanggaran, kartu, offside, pojok, pergantian, on fire, kepercayaan diri turun, babak/laga selesai, jeda/lanjut/kecepatan). Tiap kejadian punya bobot 1–3 untuk memilih sorotan; blunder yang dibalas gol lawan ≤ 15 detik naik jadi bobot 3.
- **SRT** berisi komentar sebagai subtitle (3 detik atau sampai komentar berikutnya). Subtitle pertama adalah penanda kick-off di 00:00: geser trek subtitle ke bingkai video yang menunjukkan `⏺ 00:00.0`.
- Log hanya membaca state, jadi seed yang sama menghasilkan laga dan log yang sama, mode rekam aktif atau tidak (diuji di `scripts/check-recording.js`).

## Menjalankan

```bash
npm install
npm run dev        # buka di browser (tambahkan ?seed=13 untuk memutar ulang laga tertentu)
npm run check      # kamus terjemahan + uji engine (invariant & angka kewajaran) + uji log rekaman
npm run calibrate  # ukur rata-rata gol & dinamika kualitas tim
npm run build      # build produksi
```

Versi web dan itch.io dibuat sebagai **satu berkas HTML**: hasil `vite build` (JS & CSS) disisipkan ke `index.html`, termasuk rekaman suara sebagai data URI (`assetsInlineLimit` 4 MB di `vite.config.js`).

## Struktur

```
src/
├─ engine/            simulasi murni (meter, tanpa tampilan) — bisa diuji di Node
│  ├─ simulation.js   memajukan laga satu tick; drill (setupDrill), pemahaman & penguasaan skema
│  ├─ passing / shooting / tackle / keeper / aerial / attack / marking / shape / movement / ball / touch / roles
│  ├─ fouls / officials / scuffle / sendoff / substitution          aturan & wasit
│  ├─ skill.js · condition.js · philosophy.js                       blunder, kondisi, gaya
│  ├─ tactics.js · tacticTemplates.js · scripts.js · scriptPresets.js · groups.js   taktik & strategi detil
│  ├─ scriptLab.js · drill.js                                       uji cepat & latihan skema
│  ├─ league.js · calendar.js · clubs.js · market.js · injury.js · development.js · playerStats.js   liga & skuad
│  └─ career.js       hari demi hari, latihan/istirahat, reputasi, dewan, tawaran, pindah klub
├─ render/            menggambar state ke canvas (hanya membaca state)
├─ components/        UI React (tab Pertandingan, Taktik, Skuad, Bursa, Kompetisi, panel hari, latihan, dll.)
├─ audio/             musik (music.js), penonton & peluit (crowd.js), komentar (commentary.js), rekaman (samples/)
├─ recording/         log kejadian & subtitle untuk mode rekam (eventLog.js, recordMode.js)
└─ i18n.js, i18n.en.js, saves.js (3 slot simpanan di localStorage)
scripts/              check-engine.js, check-i18n.js, check-recording.js, calibrate.js
docs/                 dokumen arah game (riwayat keputusan & catatan keseimbangan)
```

Aturan kode: fungsi engine murni (state lama → state baru), guard clause di setiap fungsi publik, dan pemeriksaan invariant (`validateMatchState`, `leagueErrors`, `careerErrors`) yang dijalankan di uji dan di titik-titik rawan.

## Dokumen penting

Arah, batasan, logika gerak, statistik pemain, urutan pengembangan, dan **semua catatan keseimbangan yang masih terbuka** ada di [docs/dokumen-arah-game.md](docs/dokumen-arah-game.md). Baca dokumen itu sebelum menambah fitur.

## Kredit & lisensi aset

- Musik dan peluit: dibuat dalam kode untuk game ini (tanpa rekaman).
- Rekaman penonton: "Crowd Cheering 66" dari [sfxmint.com](https://sfxmint.com/sounds/crowd-cheer), lisensi CC0 1.0. Sumber dan olahannya dicatat di [src/audio/samples/SUMBER.md](src/audio/samples/SUMBER.md).
- Nama pemain, klub, dan logo: fiktif, dibuat acak oleh game.
