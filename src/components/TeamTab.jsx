import { useState } from 'react';
import { SUBS, substitutionErrors, roleLine } from '../engine/substitution.js';
import { gameClock } from '../engine/state.js';
import { getPhilosophy } from '../engine/philosophy.js';
import { FORMATIONS } from '../engine/formations.js';
import {
  TEMPO_OPTIONS,
  CROSS_OPTIONS,
  WIDTH_OPTIONS,
  LINE_OPTIONS,
  PRESS_OPTIONS,
  ON_LOSS,
  ON_WIN,
  CORNER_SCHEMES,
  FREE_KICK_SCHEMES,
} from '../engine/tactics.js';

const WIDTH_LABEL = { sempit: 'Sempit', normal: 'Normal', lebar: 'Lebar' };
const LINE_LABEL = { rendah: 'Rendah', normal: 'Normal', tinggi: 'Tinggi' };
const PRESS_LABEL = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi' };
const LOSS_LABEL = { counterPress: 'Counter-press', seimbang: 'Seimbang', mundur: 'Mundur ke posisi' };
const WIN_LABEL = { seranganBalik: 'Serangan balik', seimbang: 'Seimbang', bangunUlang: 'Bangun ulang' };
const TEMPO_LABEL = { lambat: 'Lambat', normal: 'Normal', cepat: 'Cepat' };
const CROSS_LABEL = { jarang: 'Jarang', normal: 'Normal', sering: 'Sering' };
const CORNER_LABEL = { campur: 'Campur', tiangDekat: 'Tiang dekat', tiangJauh: 'Tiang jauh', pendek: 'Pendek' };
const FREE_KICK_LABEL = { otomatis: 'Otomatis', tembak: 'Tembak langsung', lambung: 'Lambung ke kotak', pendek: 'Pendek' };

// Satu baris pilihan (tombol bersegmen).
function Choice({ label, value, options, labels, onPick, disabled, hint }) {
  return (
    <div className="tac-row">
      <span className="tac-label" title={hint}>
        {label}
      </span>
      <div className="tac-options" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" className={o === value ? 'is-active' : undefined} onClick={() => onPick(o)} disabled={disabled}>
            {labels?.[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  );
}

// Tab "Tim" (layer manajer 8a): susunan pemain, kondisi, bangku cadangan, antrian pergantian.
// Simulasi TETAP berjalan saat tab ini dibuka (keputusan 29 Okt). Pergantian hanya diantrikan:
//   babak 1 / jeda → dijalankan saat babak 2 dimulai; babak 2 → pada bola mati berikutnya.

const RATING_KEYS = [
  'kecepatan',
  'stamina',
  'kekuatan',
  'passing',
  'kontrol',
  'dribbling',
  'finishing',
  'tackling',
  'visi',
  'keputusan',
  'posisi',
];

function rating(skills) {
  const values = RATING_KEYS.map((k) => skills[k]).filter(Number.isFinite);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

function whenText(state) {
  if (state.period === 'first' || state.period === 'halftime') return 'Dijalankan saat babak 2 dimulai.';
  if (state.period === 'second') return 'Dijalankan pada bola mati berikutnya.';
  return 'Pertandingan sudah selesai.';
}

function EnergyBar({ value }) {
  const pct = Math.round(value * 100);
  const tone = value < 0.45 ? 'low' : value < 0.65 ? 'mid' : 'ok';
  return (
    <span className={`energy energy--${tone}`} title={`Tenaga ${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

export default function TeamTab({ state, teamId, simulation, onChange, namesById }) {
  const [outId, setOutId] = useState(null);
  const [inId, setInId] = useState(null);
  const [message, setMessage] = useState(null);

  if (!state) return <p className="team-empty">Memuat…</p>;
  const team = state.teams[teamId];
  if (!team) return <p className="team-empty">Tim tidak ditemukan.</p>;

  const onPitch = state.players.filter((p) => p.teamId === teamId);
  const queuedOut = new Set(team.subQueue.map((q) => q.outId));
  const queuedIn = new Set(team.subQueue.map((q) => q.inId));
  const used = team.subsUsed;
  const left = SUBS.max - used - team.subQueue.length;
  const sentOff = state.sentOff.filter((p) => p.teamId === teamId);
  const subbedOff = (state.subbedOff ?? []).filter((p) => p.teamId === teamId);
  const errors = outId && inId ? substitutionErrors(state, teamId, outId, inId) : [];
  const name = (id) => namesById.get(id) ?? id;

  function queue() {
    // Guard: state bisa sudah berubah sejak tombol ditekan (simulasi tetap berjalan).
    const fresh = simulation.getState();
    const problems = substitutionErrors(fresh, teamId, outId, inId);
    if (problems.length > 0) {
      setMessage({ tone: 'error', text: problems.join('; ') });
      return;
    }
    const next = simulation.queueSubstitution(teamId, outId, inId);
    setMessage({ tone: 'info', text: `${name(outId)} ➜ ${name(inId)} diantrikan. ${whenText(next)}` });
    setOutId(null);
    setInId(null);
    onChange(next);
  }

  function setTactic(changes, label) {
    try {
      onChange(simulation.setTactics(teamId, changes));
      setMessage({ tone: 'info', text: `${label} — diterapkan sekarang.` });
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
    }
  }

  function cancel(index) {
    onChange(simulation.cancelSubstitution(teamId, index));
  }

  const locked = state.period === 'fulltime';
  const minute = state.period === 'halftime' ? 'Jeda' : state.period === 'fulltime' ? 'Selesai' : `${gameClock(state).minute}'`;

  return (
    <section className="team-tab" aria-label="Pengaturan tim">
      <header className="team-tab__head">
        <div>
          <h2>{team.name}</h2>
          <p className="team-tab__meta">
            {minute} · Bentuk: {team.tactics.outOfPossession.formation} tanpa bola / {team.tactics.inPossession.formation} dengan bola ·
            Pergantian {used}/{SUBS.max}
            {team.subQueue.length > 0 ? ` (+${team.subQueue.length} antre)` : ''}
          </p>
        </div>
        <p className="team-tab__live">● Pertandingan tetap berjalan</p>
      </header>

      <div className="tactics">
        <h3>Taktik · berlaku seketika</h3>
        <div className="tac-boxes">
          <fieldset className="tac-box">
            <legend>Dengan bola</legend>
            <Choice
              label="Formasi"
              value={team.tactics.inPossession.formation}
              options={Object.keys(FORMATIONS)}
              onPick={(v) => setTactic({ inPossession: { formation: v } }, `Dengan bola: ${v}`)}
              disabled={locked}
              hint={onPitch.length < 11 ? 'Kurang orang: slot paling depan dikosongkan' : undefined}
            />
            <Choice
              label="Lebar"
              value={team.tactics.inPossession.width}
              options={Object.keys(WIDTH_OPTIONS)}
              labels={WIDTH_LABEL}
              onPick={(v) => setTactic({ inPossession: { width: v } }, `Lebar ${WIDTH_LABEL[v]}`)}
              disabled={locked}
            />
            <Choice
              label="Tempo"
              value={team.tactics.inPossession.tempo}
              options={Object.keys(TEMPO_OPTIONS)}
              labels={TEMPO_LABEL}
              onPick={(v) => setTactic({ inPossession: { tempo: v } }, `Tempo ${TEMPO_LABEL[v]}`)}
              disabled={locked}
              hint="Seberapa lama pemain menahan bola sebelum mengoper"
            />
            <Choice
              label="Umpan silang"
              value={team.tactics.inPossession.cross}
              options={Object.keys(CROSS_OPTIONS)}
              labels={CROSS_LABEL}
              onPick={(v) => setTactic({ inPossession: { cross: v } }, `Umpan silang ${CROSS_LABEL[v]}`)}
              disabled={locked}
            />
          </fieldset>
          <fieldset className="tac-box">
            <legend>Tanpa bola</legend>
            <Choice
              label="Formasi"
              value={team.tactics.outOfPossession.formation}
              options={Object.keys(FORMATIONS)}
              onPick={(v) => setTactic({ outOfPossession: { formation: v } }, `Tanpa bola: ${v}`)}
              disabled={locked}
            />
            <Choice
              label="Garis bek"
              value={team.tactics.outOfPossession.line}
              options={Object.keys(LINE_OPTIONS)}
              labels={LINE_LABEL}
              onPick={(v) => setTactic({ outOfPossession: { line: v } }, `Garis bek ${LINE_LABEL[v]}`)}
              disabled={locked}
              hint="Rendah: rapat & menutup tembakan. Tinggi: merebut di depan, ruang di belakang terbuka"
            />
            <Choice
              label="Tekanan"
              value={team.tactics.outOfPossession.press}
              options={Object.keys(PRESS_OPTIONS)}
              labels={PRESS_LABEL}
              onPick={(v) => setTactic({ outOfPossession: { press: v } }, `Tekanan ${PRESS_LABEL[v]}`)}
              disabled={locked}
              hint="Tinggi: menekan di mana saja (menguras tenaga). Rendah: hanya dekat gawang sendiri"
            />
          </fieldset>
          <fieldset className="tac-box">
            <legend>Saat kehilangan bola</legend>
            <Choice
              label="Reaksi"
              value={team.tactics.onLoss}
              options={ON_LOSS}
              labels={LOSS_LABEL}
              onPick={(v) => setTactic({ onLoss: v }, `Kehilangan bola: ${LOSS_LABEL[v]}`)}
              disabled={locked}
              hint="Counter-press: 2 pemain tambahan menekan ±5 dtk (menguras tenaga). Mundur: langsung ke bentuk bertahan"
            />
          </fieldset>
          <fieldset className="tac-box">
            <legend>Saat merebut bola</legend>
            <Choice
              label="Reaksi"
              value={team.tactics.onWin}
              options={ON_WIN}
              labels={WIN_LABEL}
              onPick={(v) => setTactic({ onWin: v }, `Merebut bola: ${WIN_LABEL[v]}`)}
              disabled={locked}
              hint="Serangan balik: langsung ke depan ±5 dtk. Bangun ulang: aman & sabar"
            />
          </fieldset>
        </div>
        <h3 className="tac-sub">Skema bola mati</h3>
        <Choice
          label="Sepak pojok"
          value={team.tactics.corner}
          options={CORNER_SCHEMES}
          labels={CORNER_LABEL}
          onPick={(v) => setTactic({ corner: v }, `Sepak pojok: ${CORNER_LABEL[v]}`)}
          disabled={locked}
          hint="Campur: ke penyundul terbaik. Pendek: dimainkan ke rekan yang mendekat"
        />
        <Choice
          label="Tendangan bebas"
          value={team.tactics.freeKick}
          options={FREE_KICK_SCHEMES}
          labels={FREE_KICK_LABEL}
          onPick={(v) => setTactic({ freeKick: v }, `Tendangan bebas: ${FREE_KICK_LABEL[v]}`)}
          disabled={locked}
          hint="Otomatis: tembak bila ≤ 30 m (70%), kalau tidak dilambungkan"
        />
        <p className="tac-note">
          Pojok laga ini: {state.stats.corners[teamId].taken} · tembakan dari pojok {state.stats.corners[teamId].shots} · gol{' '}
          {state.stats.corners[teamId].goals}
        </p>
        <p className="tac-note">
          Filosofi: <strong>{getPhilosophy(team.philosophy).label}</strong> — identitas tim dari latihan, tidak bisa diubah di tengah laga.
        </p>
      </div>

      {message && <p className={`team-msg team-msg--${message.tone}`}>{message.text}</p>}

      <div className="team-columns">
        <div className="team-col">
          <h3>Di lapangan ({onPitch.length})</h3>
          <ul className="roster">
            {onPitch.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`roster-row${outId === p.id ? ' is-selected' : ''}${queuedOut.has(p.id) ? ' is-queued' : ''}`}
                  onClick={() => setOutId(outId === p.id ? null : p.id)}
                  disabled={queuedOut.has(p.id) || state.period === 'fulltime'}
                >
                  <span className="roster-num">{p.number}</span>
                  <span className="roster-name">
                    {p.shortName}
                    {p.discipline.yellows > 0 && <span className="card-chip" title="Kartu kuning" />}
                    {queuedOut.has(p.id) && <span className="roster-tag">keluar</span>}
                  </span>
                  <span className="roster-role">{p.role}</span>
                  <EnergyBar value={p.condition.energy} />
                </button>
              </li>
            ))}
          </ul>
          {(sentOff.length > 0 || subbedOff.length > 0) && (
            <p className="roster-note">
              {sentOff.map((p) => `🟥 ${p.shortName}`).join(', ')}
              {sentOff.length && subbedOff.length ? ' · ' : ''}
              {subbedOff.length > 0 ? `Sudah keluar: ${subbedOff.map((p) => p.shortName).join(', ')}` : ''}
            </p>
          )}
        </div>

        <div className="team-col">
          <h3>Cadangan ({team.bench.length})</h3>
          <ul className="roster">
            {team.bench.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`roster-row${inId === p.id ? ' is-selected' : ''}${queuedIn.has(p.id) ? ' is-queued' : ''}`}
                  onClick={() => setInId(inId === p.id ? null : p.id)}
                  disabled={queuedIn.has(p.id) || state.period === 'fulltime'}
                >
                  <span className="roster-num">{p.number}</span>
                  <span className="roster-name">
                    {p.shortName}
                    {queuedIn.has(p.id) && <span className="roster-tag">masuk</span>}
                  </span>
                  <span className="roster-role">{p.naturalRole}</span>
                  <span className="roster-rating" title="Rata-rata stat utama">
                    {rating(p.skills)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sub-panel">
        <p className="sub-pick">
          {outId ? `Keluar: ${name(outId)}` : 'Pilih pemain keluar'} ➜ {inId ? `Masuk: ${name(inId)}` : 'pilih cadangan'}
          {outId &&
            inId &&
            roleLine(onPitch.find((p) => p.id === outId)?.role ?? '') !==
              roleLine(team.bench.find((p) => p.id === inId)?.naturalRole ?? '') && <span className="sub-warn"> (beda posisi asli)</span>}
        </p>
        <button type="button" className="break-button" onClick={queue} disabled={!outId || !inId || errors.length > 0 || left <= 0}>
          Antrikan pergantian
        </button>
        {errors.length > 0 && <p className="team-msg team-msg--error">{errors.join('; ')}</p>}
        <p className="sub-when">{whenText(state)}</p>
        {team.subQueue.length > 0 && (
          <ul className="sub-queue">
            {team.subQueue.map((q, i) => (
              <li key={`${q.outId}-${q.inId}`}>
                ⏳ {name(q.outId)} ➜ {name(q.inId)}
                <button type="button" onClick={() => cancel(i)}>
                  Batal
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
