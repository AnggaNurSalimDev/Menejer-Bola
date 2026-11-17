import { useEffect, useRef, useState } from 'react';
import { logFileName, mmss } from '../recording/eventLog.js';
import { t } from '../i18n.js';

// Mode rekam (17 Nov): kode waktu di layar + unduh log (JSON) & subtitle (.srt).
//
//   ⏺ 03:12.4 · 132 kejadian   [⬇ JSON] [⬇ SRT] [📋]
//   kode waktu = tMs yang sama dengan di log → di video, bingkai "00:00.0" = titik nol subtitle.
//   Unduhan gagal (mis. dibatasi iframe) → pesan + tombol salin ke clipboard sebagai cadangan.

// Halaman artifact claude.ai melarang unduhan biasa: pakai kapabilitas "downloads" (penonton
// mengonfirmasi). .srt tidak ada di daftar ekstensi yang diizinkan → disimpan sebagai .srt.txt.
// Di luar artifact (itch, lokal) claude.use tidak ada → unduhan biasa.
let hostDownloadsPromise = null;
function hostDownloads() {
  if (!hostDownloadsPromise) {
    hostDownloadsPromise = (async () => {
      try {
        if (typeof window === 'undefined' || typeof window.claude?.use !== 'function') return null;
        return await window.claude.use('downloads');
      } catch {
        return null;
      }
    })();
  }
  return hostDownloadsPromise;
}

const HOST_ERROR = {
  declined: 'penyimpanan dibatalkan',
  rate_limited: 'masih ada konfirmasi yang terbuka — coba lagi sebentar',
  rejected_extension: 'jenis berkas tidak diizinkan di sini',
  extension_not_enabled: 'jenis berkas tidak tersedia di tampilan ini',
};

async function saveFile(name, text, type) {
  const host = await hostDownloads();
  if (host) {
    const filename = name.endsWith('.srt') ? `${name}.txt` : name;
    try {
      await host.save({ filename, data: text });
      return filename;
    } catch (e) {
      const why = HOST_ERROR[e?.code] ?? e?.message ?? 'tidak tersedia';
      throw new Error(why);
    }
  }
  download(name, text, type);
  return name;
}

function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export default function RecordControls({ log, meta }) {
  const clockRef = useRef(null);
  const [count, setCount] = useState(0);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    hostDownloads(); // mulai cari kapabilitas lebih awal (bisa makan waktu hingga 10 dtk)
  }, []);

  // Kode waktu & jumlah kejadian diperbarui tiap bingkai lewat ref (tanpa render ulang React tiap bingkai).
  useEffect(() => {
    let raf = 0;
    let lastCount = -1;
    const loop = () => {
      const el = clockRef.current;
      const ms = log.elapsed(performance.now());
      if (el) {
        const text = ms === null ? '--:--.-' : `${mmss(ms)}.${Math.floor((ms % 1000) / 100)}`;
        if (el.textContent !== text) el.textContent = text;
      }
      const n = log.size();
      if (n !== lastCount) {
        lastCount = n;
        setCount(n);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [log]);

  function build(ext) {
    const m = meta();
    const name = logFileName({ home: m.timKandang, away: m.timTandang, seed: m.seed }, ext);
    const text = ext === 'json' ? JSON.stringify(log.toJSON(m), null, 2) : log.toSRT();
    return { name, text };
  }

  async function save(ext) {
    setMsg(null);
    try {
      if (!log.started()) throw new Error(t('Belum kick-off — log masih kosong.'));
      const { name, text } = build(ext);
      const saved = await saveFile(name, text, ext === 'json' ? 'application/json' : 'application/x-subrip');
      setMsg({ ok: true, text: saved.endsWith('.srt.txt') ? t('Diunduh: {n} — ganti ekstensinya jadi .srt sebelum diimpor.', { n: saved }) : t('Diunduh: {n}', { n: saved }) });
    } catch (e) {
      setMsg({ ok: false, text: `${t('Unduhan gagal')}: ${e?.message ?? e}. ${t('Coba tombol 📋 salin.')}` });
    }
  }

  async function copy() {
    setMsg(null);
    try {
      if (!log.started()) throw new Error(t('Belum kick-off — log masih kosong.'));
      await navigator.clipboard.writeText(build('json').text);
      setMsg({ ok: true, text: t('Log JSON disalin ke clipboard.') });
    } catch (e) {
      setMsg({ ok: false, text: `${t('Gagal menyalin')}: ${e?.message ?? e}` });
    }
  }

  const ready = log.started();
  return (
    <span className="rec-controls" aria-label={t('Mode rekam')}>
      <span className="rec-dot" aria-hidden="true">
        ⏺
      </span>
      <b ref={clockRef} className="rec-clock" title={t('Waktu sejak peluit kick-off (sama dengan tMs di log)')}>
        --:--.-
      </b>
      <small>{t('{n} kejadian', { n: count })}</small>
      <button type="button" disabled={!ready} onClick={() => save('json')}>
        ⬇ JSON
      </button>
      <button type="button" disabled={!ready} onClick={() => save('srt')}>
        ⬇ SRT
      </button>
      <button type="button" disabled={!ready} title={t('Salin log JSON')} onClick={copy}>
        📋
      </button>
      {msg && <small className={msg.ok ? 'rec-msg' : 'rec-msg neg'}>{msg.text}</small>}
    </span>
  );
}
