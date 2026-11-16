import { useState } from 'react';
import { t } from '../i18n.js';

// Panduan awal & tombol masukan (15 Nov, rencana uji ke 5–10 orang; masukan lewat komentar itch).
//
//   pertama kali masuk layar game ──▶ kartu panduan 6 langkah (Lanjut / Lewati)
//   tombol "? Panduan" di bar atas ──▶ buka lagi kapan saja
//   tombol "💬 Masukan"             ──▶ halaman komentar itch (tab baru)

const tk = (s) => s;
const SEEN_KEY = 'menejer-bola:panduan:v1';

// Alamat halaman game di itch (tanpa garis miring akhir). Kosong = ditebak dari document.referrer
// (game di itch berjalan di iframe; referrer = halaman game). Isi bila sudah tahu alamatnya.
export const ITCH_PAGE = '';

const STEPS = [
  { title: tk('Selamat datang, Manajer'), body: tk('Kamu meracik taktik, lalu menonton laga berjalan sendiri. Pemain bergerak menurut posisi, instruksi, dan stat mereka — kamu tidak mengendalikan pemain langsung.') },
  { title: tk('1 · Tonton laga'), body: tk('Hari berjalan di tab Kompetisi: tekan ▶ Lanjut ke laga — berhenti sendiri saat ada kejadian (cedera, tawaran klub) atau hari laga. Di hari laga, tab Pertandingan: tekan Lanjut, pilih kecepatan 1×–8×; saat jeda babak taktik & pemain bisa diubah.') },
  { title: tk('2 · Mulai dari template'), body: tk('Tab Taktik → Template taktik. Pilih yang ★ sedikit dulu (mis. 4-4-2 Klasik). Template rumit butuh pemahaman tim yang tinggi; kalau belum paham, rencana sering tidak jalan.') },
  { title: tk('3 · Strategi detil itu opsional'), body: tk('Di bawah papan zona ada Strategi detil. Tidak wajib. Kalau mau mencoba, pakai 📚 Pustaka skema — skema siap pakai yang tinggal ditambahkan.') },
  { title: tk('4 · Rawat skuad'), body: tk('Tab Skuad: pemain lelah, cedera, dan kontrak. Tombol istirahatkan memindahkan pemain lelah ke cadangan. Tab Bursa untuk membeli pemain.') },
  { title: tk('5 · Kejar gelar'), body: tk('Tab Kompetisi: jadwal, klasemen, top skor, dan piala. Satu musim 38 pekan liga plus piala. Karier tersimpan otomatis di browser ini.') },
  { title: tk('Bantu aku memperbaiki game ini'), body: tk('Game ini masih tahap uji. Ada yang membingungkan, aneh, atau rusak? Tulis di komentar halaman itch lewat tombol 💬 Masukan di bar atas. Sertakan apa yang kamu lakukan dan apa yang terjadi.') },
];

function seen() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // penyimpanan tidak tersedia: jangan memaksa panduan muncul tiap kali
  }
}
function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* abaikan */
  }
}

// Halaman komentar itch, atau null bila tidak diketahui.
export function feedbackUrl(referrer = typeof document !== 'undefined' ? document.referrer : '') {
  const fromConst = ITCH_PAGE.trim();
  if (fromConst) return `${fromConst.replace(/\/+$/, '')}/comments`;
  const m = /^https:\/\/([a-z0-9-]+)\.itch\.io(?:\/([a-z0-9_-]+))?/i.exec(referrer ?? '');
  if (!m) return null;
  // Browser sering hanya mengirim asal (https://nama.itch.io/) untuk iframe lintas situs → halaman profil.
  return m[2] ? `https://${m[1]}.itch.io/${m[2]}/comments` : `https://${m[1]}.itch.io/`;
}

export function FeedbackLink() {
  const url = feedbackUrl();
  if (!url) return null;
  return (
    <a className="feedback-link" href={url} target="_blank" rel="noopener noreferrer" title={t('Tulis masukan di komentar halaman itch')}>
      💬 {t('Masukan')}
    </a>
  );
}

export function useGuide() {
  const [open, setOpen] = useState(() => !seen());
  return {
    open,
    show: () => setOpen(true),
    close: () => {
      markSeen();
      setOpen(false);
    },
  };
}

export default function Guide({ onClose }) {
  const [i, setI] = useState(0);
  if (i < 0 || i >= STEPS.length) throw new RangeError(`Guide: langkah ${i} di luar 0–${STEPS.length - 1}`);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const url = feedbackUrl();
  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="guide-card">
        <p className="guide-count">
          {i + 1} / {STEPS.length}
        </p>
        <h2 id="guide-title">{t(step.title)}</h2>
        <p>{t(step.body)}</p>
        {last && url && (
          <p>
            <a className="feedback-link" href={url} target="_blank" rel="noopener noreferrer">
              💬 {t('Buka halaman komentar')}
            </a>
          </p>
        )}
        <div className="guide-actions">
          <button type="button" className="link-btn" onClick={onClose}>
            {t('Lewati')}
          </button>
          {i > 0 && (
            <button type="button" className="lane-reset" onClick={() => setI(i - 1)}>
              {t('Kembali')}
            </button>
          )}
          <button type="button" className="break-button" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? t('Mulai main') : t('Lanjut')}
          </button>
        </div>
      </div>
    </div>
  );
}
