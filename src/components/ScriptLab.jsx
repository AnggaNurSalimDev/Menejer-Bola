import { useEffect, useRef, useState } from 'react';
import { createLab, margin, scriptKey, LAB } from '../engine/scriptLab.js';
import { PITCH } from '../engine/pitch.js';
import { TICK_RATE } from '../engine/constants.js';
import { t, tk } from '../i18n.js';

// Uji skema (16 Nov): tombol 🧪 di daftar skema → panel ini. Menjalankan createLab per potongan
// (setTimeout) supaya layar tidak membeku, lalu menampilkan tabel per formasi lawan + tayangan ulang.
//
//   lab (dari App) = { home, getTactics(), gap, blocker: null|kode, onSession(nama) → bool,
//                      saved(key) → hasil|null, onSave(key, hasil) }
//
//   [Mulai uji] ─▶ onSession (karier: sesi latihan) ─▶ step(1500) … ─▶ gabung dengan hasil lama ─▶ onSave

const CHUNK = 1500;
const REASON_LABEL = { selesai: tk('selesai'), bolaHilang: tk('bola direbut'), bolaMati: tk('bola mati / keluar'), batal: tk('batal (waktu habis / kurang paham)') };
const BLOCK_LABEL = {
  keputusan: tk('Selesaikan dulu keputusan di tab Kompetisi.'),
  musim: tk('Musim sudah selesai.'),
  hariLaga: tk('Hari ini hari laga — uji skema hanya di hari latihan.'),
  pemulihan: tk('Hari pemulihan setelah laga — uji skema di hari latihan berikutnya.'),
  sudah: tk('Sudah latihan uji skema hari ini — majukan hari dulu.'),
  tanpaLaga: tk('Tidak ada laga terjadwal untuk membangun susunan — uji skema belum tersedia.'),
  berjalan: tk('Laga sedang berjalan.'),
};

const pct = (x) => `${Math.round(x * 100)}%`;

function merge(old, add) {
  if (!old) return add;
  return {
    ...add,
    started: old.started + add.started,
    completed: old.completed + add.completed,
    matches: old.matches + add.matches,
    rows: add.rows.map((r) => {
      const o = old.rows.find((x) => x.formation === r.formation);
      if (!o) return r;
      return { ...r, started: r.started + o.started, completed: r.completed + o.completed, reasons: Object.fromEntries(Object.keys(r.reasons).map((k) => [k, r.reasons[k] + (o.reasons[k] ?? 0)])) };
    }),
  };
}

export default function ScriptLab({ script, lab, nameOf, onClose }) {
  const key = scriptKey(script);
  const saved = lab.saved(key);
  const [run, setRun] = useState(null); // { progress } saat berjalan
  const [replays, setReplays] = useState(null);
  const [show, setShow] = useState(null); // 'ok' | 'fail'
  const [error, setError] = useState(null);
  const labRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  function start() {
    setError(null);
    let l;
    try {
      l = createLab({ home: lab.home, tactics: lab.getTactics(), script, gap: lab.gap, mastery: lab.mastery ?? null, seed: (Date.now() % 100000) + 1 });
    } catch (e) {
      setError(e.message.replace(/^createLab: /, ''));
      return;
    }
    if (!lab.onSession(script.name)) return;
    labRef.current = l;
    cancelled.current = false;
    setRun({ progress: 0 });
    const tick = () => {
      if (cancelled.current) return;
      const done = l.step(CHUNK);
      if (!done) {
        setRun({ progress: l.progress() });
        setTimeout(tick, 0);
        return;
      }
      const r = l.result();
      const entry = merge(lab.saved(key), { name: script.name, preset: script.preset ?? null, started: r.started, completed: r.completed, matches: r.matches, rows: r.rows });
      lab.onSave(key, entry);
      setReplays(r.replays);
      setRun(null);
    };
    setTimeout(tick, 0);
  }

  const res = saved;
  const m = res ? margin(res.completed, res.started) : null;
  const blocked = lab.blocker;
  return (
    <div className="script-lab">
      <div className="scripts__head">
        <h5>
          🧪 {t('Uji cepat')}: {script.name}
        </h5>
        <button type="button" className="lane-reset" onClick={onClose}>
          {t('Tutup')}
        </button>
      </div>
      <p className="tac-note">
        {t('Skema ini saja yang dipasang, dengan skuad & taktikmu sekarang, melawan {f} ({n} laga tiap formasi, ±{s} detik). Pemahaman tim ikut dihitung.', { f: LAB.formations.join(', '), n: LAB.matchesPer, s: LAB.formations.length * LAB.matchesPer })}
        {` ${t('Uji cepat hanya mengukur (tanpa efek latihan, bisa kapan saja). Untuk meningkatkan skema, pakai 🏋️ latih.')}`}
      </p>
      {run ? (
        <div className="lab-progress">
          <span className="fit-bar fit-bar--ok">
            <span className="fit-bar__track">
              <span style={{ width: `${Math.round(run.progress * 100)}%` }} />
            </span>
          </span>{' '}
          {t('menguji… {p}%', { p: Math.round(run.progress * 100) })}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              cancelled.current = true;
              setRun(null);
            }}
          >
            {t('batalkan')}
          </button>
        </div>
      ) : (
        <div className="script-actions">
          <button type="button" className="break-button" disabled={Boolean(blocked)} onClick={start}>
            {res ? t('Uji lagi (tambah data)') : t('Mulai uji')}
          </button>
          {blocked && <small className="sub-warn">{t(BLOCK_LABEL[blocked] ?? blocked)}</small>}
          {error && <small className="neg">{error}</small>}
        </div>
      )}

      {res && (
        <>
          <p>
            {t('Berhasil')}: <b>{res.started ? pct(res.completed / res.started) : '–'}</b>
            {m !== null && ` ± ${Math.round(m * 100)}`} · {t('{c} dari {s} percobaan dalam {n} laga', { c: res.completed, s: res.started, n: res.matches })}
          </p>
          <div className="table-wrap">
            <table className="career-table lab-table">
              <thead>
                <tr>
                  <th>{t('Lawan')}</th>
                  <th>{t('Berhasil')}</th>
                  {LAB.reasons.slice(1).map((r) => (
                    <th key={r}>{t(REASON_LABEL[r])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {res.rows.map((r) => (
                  <tr key={r.formation}>
                    <td>{r.formation}</td>
                    <td>
                      {r.started ? <b>{pct(r.completed / r.started)}</b> : '–'} <small>({r.completed}/{r.started})</small>
                    </td>
                    {LAB.reasons.slice(1).map((k) => (
                      <td key={k}>{r.reasons[k]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tac-note">{t('Angka per formasi berasal dari sedikit percobaan, jadi bisa meleset jauh (lihat ±). Uji lagi menambah data dan mempersempit selisihnya. "Berhasil" = semua langkah jalan tanpa bola hilang, bukan berarti gol.')}</p>
        </>
      )}

      {replays && (
        <div className="script-actions">
          <button type="button" className="lane-reset" disabled={!replays.ok} onClick={() => setShow(show === 'ok' ? null : 'ok')}>
            ▶ {t('Tonton yang berhasil')}
          </button>
          <button type="button" className="lane-reset" disabled={!replays.fail} onClick={() => setShow(show === 'fail' ? null : 'fail')}>
            ▶ {t('Tonton yang gagal')}
          </button>
        </div>
      )}
      {replays && show && replays[show] && <LabReplay key={show} rec={replays[show]} script={script} nameOf={nameOf} reasonText={t(REASON_LABEL[replays[show].reason])} />}
    </div>
  );
}

// Tayangan ulang sederhana: titik pemain (biru = timmu, merah = lawan), bola putih, pemain skema berlabel.
function LabReplay({ rec, script, nameOf, reasonText }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = rec.frames;
  if (frames.length === 0) throw new RangeError('LabReplay: tanpa bingkai');
  useEffect(() => {
    if (!playing) return undefined;
    if (i >= frames.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const dt = ((frames[i + 1].t - frames[i].t) / TICK_RATE) * 1000;
    const id = setTimeout(() => setI(i + 1), Math.max(40, dt));
    return () => clearTimeout(id);
  }, [i, playing, frames]);
  const f = frames[Math.min(i, frames.length - 1)];
  const involved = new Set([script.holderId, ...(script.playerIds ?? [])]);
  for (const st of script.steps) {
    if (st.trigger?.playerId) involved.add(st.trigger.playerId);
    for (const a of st.actions) {
      if (a.to) involved.add(a.to);
      if (a.playerId) involved.add(a.playerId);
    }
  }
  const startIndex = rec.startIndex ?? 0;
  const endIndex = rec.endIndex ?? frames.length - 1;
  const secs = ((f.t - frames[startIndex].t) / TICK_RATE).toFixed(1);
  const phase = i < startIndex ? t('sebelum skema') : i <= endIndex ? t('skema berjalan') : t('sesudahnya');
  return (
    <div className="lab-replay">
      <svg viewBox={`-2 -2 ${PITCH.length + 4} ${PITCH.width + 4}`} role="img" aria-label={t('Tayangan ulang skema')}>
        <rect x={0} y={0} width={PITCH.length} height={PITCH.width} className="lab-pitch" />
        <line x1={PITCH.length / 2} y1={0} x2={PITCH.length / 2} y2={PITCH.width} className="lab-line" />
        <circle cx={PITCH.length / 2} cy={PITCH.width / 2} r={9.15} className="lab-line" fill="none" />
        <rect x={PITCH.length - 16.5} y={(PITCH.width - 40.32) / 2} width={16.5} height={40.32} className="lab-line" fill="none" />
        <rect x={0} y={(PITCH.width - 40.32) / 2} width={16.5} height={40.32} className="lab-line" fill="none" />
        {f.p.map(([id, home, x, y]) => (
          <g key={id}>
            <circle cx={x} cy={y} r={involved.has(id) ? 1.6 : 1.2} className={home ? (involved.has(id) ? 'lab-dot lab-dot--key' : 'lab-dot lab-dot--home') : 'lab-dot lab-dot--away'} />
            {involved.has(id) && (
              <text x={x} y={y - 2.2} className="lab-label">
                {nameOf(id)}
              </text>
            )}
          </g>
        ))}
        <circle cx={f.b[0]} cy={f.b[1]} r={0.8} className="lab-ball" />
      </svg>
      <div className="script-actions">
        <button type="button" className="lane-reset" onClick={() => (i >= frames.length - 1 ? (setI(0), setPlaying(true)) : setPlaying(!playing))}>
          {playing ? '⏸' : '▶'}
        </button>
        <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} aria-label={t('Waktu')} />
        <small>
          <span className={i >= startIndex && i <= endIndex ? 'lab-phase is-on' : 'lab-phase'}>{phase}</span> {secs} {t('dtk')} · {t('lawan {f}', { f: rec.formation })} · {t('akhir')}: <b>{reasonText}</b>
        </small>
      </div>
    </div>
  );
}
