import { useEffect, useRef, useState } from 'react';
import { logFileName, mmss } from '../recording/eventLog.js';
import { t } from '../i18n.js';

// Mode rekam (17 Nov): kode waktu di layar + unduh log (JSON) & subtitle (.srt).
//
//   ⏺ 03:12.4 · 132 kejadian   [⬇ JSON] [⬇ SRT] [📋]
//   kode waktu = tMs yang sama dengan di log → di video, bingkai "00:00.0" = titik nol subtitle.
//   Unduhan gagal (mis. dibatasi iframe) → pesan + tombol salin ke clipboard sebagai cadangan.

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

  function save(ext) {
    setMsg(null);
    try {
      if (!log.started()) throw new Error(t('Belum kick-off — log masih kosong.'));
      const { name, text } = build(ext);
      download(name, text, ext === 'json' ? 'application/json' : 'application/x-subrip');
      setMsg({ ok: true, text: t('Diunduh: {n}', { n: name }) });
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
