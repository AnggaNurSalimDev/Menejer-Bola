import { useEffect, useRef, useState } from 'react';
import { createDrill, DRILL, drillGain } from '../engine/drill.js';
import { PITCH } from '../engine/pitch.js';
import { MASTERY } from '../engine/simulation.js';
import { t, tk } from '../i18n.js';

// Latihan skema beranimasi (17 Nov). Pemain berlatih skema di zonanya, 10 ulangan, melawan formasi
// pilihan. Skema boleh diubah selama latihan (editor di bawah) — berlaku di ulangan berikutnya, dan
// hasilnya dicatat sebagai versi baru.
//
//   drill (dari App) = { home, getTactics(), gap, mastery{}, blocker, career, onFinish({scriptId,name,results}) }
//
//   requestAnimationFrame ─▶ kumpulkan waktu × kecepatan ─▶ drill.tick() tiap 0,1 dtk game
//                         └▶ gambar: posisi diinterpolasi antara dua bingkai terakhir (halus di 60 fps)

const REASON = { selesai: tk('berhasil'), bolaHilang: tk('bola direbut'), bolaMati: tk('bola keluar / pelanggaran'), batal: tk('skema batal'), tidakMulai: tk('skema tidak dimulai') };
const PHASE = { siap: tk('bersiap'), jalan: tk('berjalan'), sesudah: tk('hasil'), selesai: tk('selesai') };
const BLOCK = {
  keputusan: tk('Selesaikan dulu keputusan di tab Kompetisi.'),
  musim: tk('Musim sudah selesai.'),
  hariLaga: tk('Hari ini hari laga — latihan hanya di hari latihan.'),
  pemulihan: tk('Hari pemulihan setelah laga — latihan di hari latihan berikutnya.'),
  sudah: tk('Sudah latihan hari ini — majukan hari dulu.'),
  tanpaLaga: tk('Tidak ada laga terjadwal untuk membangun susunan — latihan belum tersedia.'),
  berjalan: tk('Laga sedang berjalan.'),
};

const lerp = (a, b, k) => a + (b - a) * k;

export default function DrillPanel({ script, drill, nameOf, onClose }) {
  const [formation, setFormation] = useState(DRILL.formations[0]);
  const [speed, setSpeed] = useState(1);
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState(null); // { a, b, k, phase, rep, step }
  const [results, setResults] = useState([]);
  const [versions, setVersions] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done
  const [lastEnd, setLastEnd] = useState(null);
  const [committed, setCommitted] = useState(null);
  const drillRef = useRef(null);
  const scriptRef = useRef(script);
  scriptRef.current = script;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const committedRef = useRef(false);

  const liveMastery = drill.mastery?.[script.id] ?? MASTERY.default;
  // Penguasaan saat sesi dimulai (prop ikut berubah setelah hasil disimpan).
  const [sessionStart, setSessionStart] = useState(null);
  const startMastery = sessionStart ?? liveMastery;

  function commit(res) {
    if (committedRef.current || res.length === 0) return;
    committedRef.current = true;
    const after = drill.onFinish({ scriptId: script.id, name: script.name, results: res });
    setCommitted({ before: startMastery, after: after ?? startMastery });
  }

  function start() {
    let d;
    try {
      d = createDrill({ home: drill.home, tactics: drill.getTactics(), getScript: () => scriptRef.current, formation, gap: drill.gap, mastery: drill.mastery, seed: (Date.now() % 100000) + 1 });
    } catch (e) {
      setLastEnd({ error: e.message.replace(/^createDrill: /, '') });
      return;
    }
    drillRef.current = d;
    setSessionStart(liveMastery);
    committedRef.current = false;
    setCommitted(null);
    setResults([]);
    setVersions(d.versions());
    setLastEnd(null);
    setPaused(false);
    setStatus('running');
  }

  // Putaran animasi.
  useEffect(() => {
    if (status !== 'running') return undefined;
    const d = drillRef.current;
    let raf = 0;
    let acc = 0;
    let lastT = performance.now();
    let prev = d.tick();
    let cur = prev;
    let frameNo = 0;
    const loop = (now) => {
      const dt = Math.min(0.25, (now - lastT) / 1000);
      lastT = now;
      if (!pausedRef.current) acc += dt * 10 * speedRef.current;
      let ended = null;
      while (acc >= 1) {
        acc -= 1;
        prev = cur;
        try {
          cur = d.tick();
        } catch (e) {
          setLastEnd({ error: e.message });
          setStatus('done');
          return;
        }
        for (const ev of cur.events) {
          if (ev.type === 'akhir') ended = ev;
          if (ev.type === 'selesai') ended = { ...(ended ?? {}), finished: true };
        }
      }
      if (ended) {
        setResults(d.results());
        setVersions(d.versions());
        if (ended.reason) setLastEnd(ended);
        if (ended.finished) {
          commit(d.results());
          setStatus('done');
        }
      }
      // Gambar ±30 kali/dtk (cukup halus berkat interpolasi; separuh beban dibanding tiap bingkai).
      frameNo += 1;
      if (frameNo % 2 === 1 && !ended && !d.done()) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const sameRep = prev.rep === cur.rep && Math.abs(cur.frame.t - prev.frame.t) <= 2;
      setView({ a: sameRep ? prev.frame : cur.frame, b: cur.frame, k: sameRep ? acc : 1, phase: d.done() ? 'selesai' : cur.phase, rep: cur.rep, step: cur.step });
      if (!d.done()) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Panel ditutup di tengah latihan: ulangan yang sudah selesai tetap dihitung.
  useEffect(
    () => () => {
      const d = drillRef.current;
      if (d && !committedRef.current && d.results().length > 0) commit(d.results());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const okCount = results.filter((r) => r.ok).length;
  const projected = Math.min(100, startMastery + drillGain(results) * (drill.learnRate ?? 1));
  const blocked = status === 'idle' ? drill.blocker : null;

  return (
    <div className="script-lab drill-panel">
      <div className="scripts__head">
        <h5>
          🏋️ {t('Latihan skema')}: {script.name}
        </h5>
        <button type="button" className="lane-reset" onClick={onClose}>
          {status === 'running' ? t('Akhiri latihan') : t('Tutup')}
        </button>
      </div>
      <p className="tac-note">
        {t('Penguasaan skema ini')}: <b>{Math.round(startMastery)}</b>/100.{' '}
        {t('Skema yang belum dikuasai lebih sering tidak dimulai atau batal di tengah jalan saat laga. {n} ulangan; tiap ulangan berhasil menambah penguasaan lebih banyak.', { n: DRILL.reps })}
        {drill.career && ` ${t('Satu sesi latihan per hari latihan; kondisi pemain inti −3%.')}`}
      </p>

      {status === 'idle' && (
        <div className="script-actions">
          <span className="tac-label">{t('Lawan latihan')}</span>
          {DRILL.formations.map((f) => (
            <button key={f} type="button" className={f === formation ? 'is-active' : undefined} aria-pressed={f === formation} onClick={() => setFormation(f)}>
              {f}
            </button>
          ))}
          <button type="button" className="break-button" disabled={Boolean(blocked)} onClick={start}>
            ▶ {t('Mulai latihan')}
          </button>
          {blocked && <small className="sub-warn">{t(BLOCK[blocked] ?? blocked)}</small>}
        </div>
      )}
      {lastEnd?.error && <small className="neg">{lastEnd.error}</small>}

      {status !== 'idle' && view && (
        <>
          <div className="script-actions">
            <b>
              {t('Ulangan {i}/{n}', { i: Math.min(DRILL.reps, view.rep + (status === 'done' ? 0 : 1)), n: DRILL.reps })}
            </b>
            <span className={`lab-phase ${view.phase === 'jalan' ? 'is-on' : ''}`}>{t(PHASE[view.phase] ?? view.phase)}</span>
            {view.phase === 'jalan' && view.step !== null && view.step !== undefined && <small>{t('langkah {s}/{n}', { s: Math.min(view.step + 1, script.steps.length), n: script.steps.length })}</small>}
            {status === 'running' && (
              <>
                <button type="button" className="lane-reset" onClick={() => setPaused(!paused)}>
                  {paused ? '▶' : '⏸'}
                </button>
                {[1, 2, 4].map((sp) => (
                  <button key={sp} type="button" className={sp === speed ? 'is-active' : undefined} aria-pressed={sp === speed} onClick={() => setSpeed(sp)}>
                    {sp}×
                  </button>
                ))}
              </>
            )}
            <small className="tac-note">{t('lawan {f}', { f: formation })}</small>
          </div>
          <DrillPitch view={view} script={scriptRef.current} nameOf={nameOf} />
          {lastEnd?.reason && (
            <p className={lastEnd.ok ? 'drill-result is-ok' : 'drill-result is-bad'}>
              {lastEnd.ok ? '✓' : '✗'} {t('Ulangan terakhir')}: {t(REASON[lastEnd.reason] ?? lastEnd.reason)}
            </p>
          )}
        </>
      )}

      {results.length > 0 && (
        <>
          <div className="drill-reps" aria-label={t('Hasil tiap ulangan')}>
            {results.map((r) => (
              <span key={r.rep} className={r.ok ? 'drill-rep is-ok' : 'drill-rep is-bad'} title={`${t('Ulangan {i}', { i: r.rep })} · ${t('versi {v}', { v: r.version + 1 })} · ${t(REASON[r.reason] ?? r.reason)}`}>
                {r.ok ? '✓' : '✗'}
                {versions.length > 1 && <sub>{r.version + 1}</sub>}
              </span>
            ))}
          </div>
          {versions.length > 1 && (
            <p className="tac-note">
              {versions.map((v, i) => {
                const rs = results.filter((r) => r.version === i);
                return rs.length ? `${t('versi {v}', { v: i + 1 })}: ${rs.filter((r) => r.ok).length}/${rs.length}` : null;
              })
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
          <p>
            {t('{ok} dari {n} berhasil', { ok: okCount, n: results.length })} · {t('penguasaan')} {Math.round(startMastery)} → <b>{Math.round(committed ? committed.after : projected)}</b>
            {committed && ' ✓'}
          </p>
          <p className="tac-note">{t('Di latihan skema selalu dimulai dari posisi rapi, jadi persentasenya lebih tinggi daripada di laga. Ubah skema di editor kapan saja — berlaku di ulangan berikutnya.')}</p>
        </>
      )}
      {status === 'done' && (
        <button
          type="button"
          className="lane-reset"
          onClick={() => {
            setStatus('idle');
            setSessionStart(null);
          }}
        >
          {t('Kembali')}
        </button>
      )}
    </div>
  );
}

// Lapangan latihan: titik pemain (kuning = pemain skema), bola, dan rencana skema (garis putus-putus).
function DrillPitch({ view, script, nameOf }) {
  const { a, b, k } = view;
  const prevPos = new Map(a.p.map((p) => [p[0], p]));
  const involved = new Set([script.holderId, ...(script.playerIds ?? [])]);
  const plan = [];
  for (const st of script.steps) {
    for (const act of st.actions) {
      if (act.to) involved.add(act.to);
      if (act.playerId) involved.add(act.playerId);
      if (act.point) plan.push({ ...act.point, kind: act.type, who: act.playerId ?? null });
    }
  }
  const pos = b.p.map(([id, home, x, y]) => {
    const p0 = prevPos.get(id);
    return [id, home, p0 ? lerp(p0[2], x, k) : x, p0 ? lerp(p0[3], y, k) : y];
  });
  const at = new Map(pos.map((p) => [p[0], p]));
  const bx = lerp(a.b[0], b.b[0], k);
  const by = lerp(a.b[1], b.b[1], k);
  return (
    <div className="lab-replay drill-pitch">
      <svg viewBox={`-2 -2 ${PITCH.length + 4} ${PITCH.width + 4}`} role="img" aria-label={t('Latihan skema')}>
        <rect x={0} y={0} width={PITCH.length} height={PITCH.width} className="lab-pitch" />
        <line x1={PITCH.length / 2} y1={0} x2={PITCH.length / 2} y2={PITCH.width} className="lab-line" />
        <circle cx={PITCH.length / 2} cy={PITCH.width / 2} r={9.15} className="lab-line" fill="none" />
        <rect x={PITCH.length - 16.5} y={(PITCH.width - 40.32) / 2} width={16.5} height={40.32} className="lab-line" fill="none" />
        <rect x={0} y={(PITCH.width - 40.32) / 2} width={16.5} height={40.32} className="lab-line" fill="none" />
        {plan.map((pt, i) => {
          const from = pt.who ? at.get(pt.who) : at.get(script.holderId);
          return (
            <g key={i} className="drill-plan">
              {from && <line x1={from[2]} y1={from[3]} x2={pt.x} y2={pt.y} />}
              <circle cx={pt.x} cy={pt.y} r={1.1} />
            </g>
          );
        })}
        {pos.map(([id, home, x, y]) => (
          <g key={id}>
            <circle cx={x} cy={y} r={involved.has(id) ? 1.6 : 1.2} className={home ? (involved.has(id) ? 'lab-dot lab-dot--key' : 'lab-dot lab-dot--home') : 'lab-dot lab-dot--away'} />
            {involved.has(id) && (
              <text x={x} y={y - 2.2} className="lab-label">
                {nameOf(id)}
              </text>
            )}
          </g>
        ))}
        <circle cx={bx} cy={by} r={0.8} className="lab-ball" />
      </svg>
    </div>
  );
}
