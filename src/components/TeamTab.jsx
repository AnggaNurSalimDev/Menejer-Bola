import { useState } from 'react';
import { LayerPitch } from './LaneDiagram.jsx';
import ZoneBoard from './ZoneBoard.jsx';
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
  FOCUS_OPTIONS,
  PROTECT_OPTIONS,
  LANE_INSTRUCTIONS,
  MARKING_OPTIONS,
} from '../engine/tactics.js';

const WIDTH_LABEL = { sempit: 'Sempit', normal: 'Normal', lebar: 'Lebar' };
const LINE_LABEL = { rendah: 'Rendah', normal: 'Normal', tinggi: 'Tinggi' };
const PRESS_LABEL = { rendah: 'Rendah', sedang: 'Sedang', tinggi: 'Tinggi' };
const LOSS_LABEL = { counterPress: 'Counter-press', seimbang: 'Seimbang', mundur: 'Mundur ke posisi' };
const WIN_LABEL = { seranganBalik: 'Serangan balik', seimbang: 'Seimbang', bangunUlang: 'Bangun ulang' };
const TEMPO_LABEL = { lambat: 'Lambat', normal: 'Normal', cepat: 'Cepat' };
const CROSS_LABEL = { jarang: 'Jarang', normal: 'Normal', sering: 'Sering' };
const CORNER_LABEL = { campur: 'Campur', tiangDekat: 'Tiang dekat', tiangJauh: 'Tiang jauh', pendek: 'Pendek' };
const FOCUS_LABEL = { seimbang: 'Seimbang', kiri: 'Kiri', tengah: 'Tengah', kanan: 'Kanan' };
const PROTECT_LABEL = { seimbang: 'Seimbang', tengah: 'Tengah', sayap: 'Sayap' };
const LANE_LABEL = { tetap: 'Tetap di jalur', halfSpace: 'Masuk half-space', melebar: 'Melebar ke sayap', kotak: 'Naik ke kotak' };
const MARK_LABEL = { zona: 'Jaga zona', tempel: 'Tempel lawan' };
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

// Bagian yang bisa dilipat (1 Nov, masukan pengguna: tampilan terlalu panjang, terutama di HP).
// Status buka/tutup diingat per bagian di browser (hanya kenyamanan; aman bila penyimpanan tidak tersedia).
const FOLD_KEY = 'menejer-bola:lipat';

function readFolds() {
  try {
    const raw = window.localStorage.getItem(FOLD_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveFold(id, open) {
  try {
    const all = readFolds();
    all[id] = open;
    window.localStorage.setItem(FOLD_KEY, JSON.stringify(all));
  } catch {
    // penyimpanan tidak tersedia: abaikan
  }
}

function isNarrowScreen() {
  try {
    return window.matchMedia('(max-width: 720px)').matches;
  } catch {
    return false;
  }
}

function Fold({ id, title, summary, className = '', sub = false, defaultOpen = true, children }) {
  const [open, setOpen] = useState(() => {
    const saved = readFolds()[id];
    return typeof saved === 'boolean' ? saved : defaultOpen;
  });
  return (
    <details
      className={`fold${sub ? ' fold--sub' : ''} ${className}`.trim()}
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now !== open) {
          setOpen(now);
          saveFold(id, now);
        }
      }}
    >
      <summary>
        <span className="fold__title">{title}</span>
        {summary && !open && <span className="fold__summary">{summary}</span>}
      </summary>
      <div className="fold__body">{children}</div>
    </details>
  );
}

// Daftar perintah per pemain di dalam kolom fase (satu pilihan per pemain lapangan).
function PlayerOrders({ title, players, value, options, labels, onPick, disabled, isAvailable = () => true }) {
  return (
    <div className="orders">
      <span className="tac-label">{title}</span>
      <ul className="orders__list">
        {players.map((p) => (
          <li key={p.id}>
            <span className="orders__num">{p.number}</span>
            <span className="orders__name">{p.shortName}</span>
            <select
              className="lane-select"
              aria-label={`${title} ${p.shortName}`}
              value={value(p)}
              disabled={disabled}
              onChange={(e) => onPick(p, e.target.value)}
            >
              {options
                .filter((v) => isAvailable(p, v))
                .map((v) => (
                  <option key={v} value={v}>
                    {labels[v] ?? v}
                  </option>
                ))}
            </select>
          </li>
        ))}
      </ul>
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
  const shirt = team.colors?.shirt ?? '#4dabf7';
  const outfield = onPitch.filter((p) => p.role !== 'GK').sort((a, b) => a.number - b.number);
  const clearMap = () => Object.fromEntries(outfield.map((p) => [p.id, null]));
  const tempelCount = Object.values(team.tactics.marking ?? {}).filter((v) => v === 'tempel').length;
  const laneCount = new Set([...Object.keys(team.tactics.customIn ?? {}), ...Object.keys(team.tactics.playerLanes ?? {})]).size;
  const dragOut = Object.keys(team.tactics.customOut ?? {}).length;
  const op = team.tactics.outOfPossession;
  const ip = team.tactics.inPossession;
  const summaryOut = [
    op.formation,
    `garis ${LINE_LABEL[op.line]}`,
    `tekan ${PRESS_LABEL[op.press]}`,
    `lindungi ${PROTECT_LABEL[op.protect ?? 'seimbang']}`,
    tempelCount ? `${tempelCount} tempel` : null,
    dragOut ? `${dragOut} posisi diseret` : null,
  ].filter(Boolean).join(' · ');
  const summaryIn = [
    ip.formation,
    `lebar ${WIDTH_LABEL[ip.width]}`,
    `tempo ${TEMPO_LABEL[ip.tempo]}`,
    `fokus ${FOCUS_LABEL[ip.focus ?? 'seimbang']}`,
    laneCount ? `${laneCount} instruksi pribadi` : null,
  ].filter(Boolean).join(' · ');
  const narrow = isNarrowScreen();
  const zonesSet = (k) => Object.values(team.tactics[k] ?? {}).filter((m) => Object.keys(m).length > 0).length;
  const zoneSummary =
    zonesSet('zoneIn') + zonesSet('zoneOut') > 0
      ? `${zonesSet('zoneOut')} zona tanpa bola · ${zonesSet('zoneIn')} zona dengan bola diatur`
      : 'belum diatur — memakai posisi layer biasa';
  const summaryAll = `${op.formation === ip.formation ? op.formation : `${op.formation} / ${ip.formation}`} · garis ${LINE_LABEL[op.line]} · fokus ${FOCUS_LABEL[ip.focus ?? 'seimbang']}${tempelCount + laneCount + dragOut ? ` · ${tempelCount + laneCount + dragOut} instruksi pribadi` : ''}`;
  // Formasi dasar disimpan sendiri (2 Nov); "sama di dua fase" bila kedua fase memakainya.
  const baseFormation = team.tactics.baseFormation ?? team.tactics.outOfPossession.formation;
  const phasesMatchBase = team.tactics.inPossession.formation === baseFormation && team.tactics.outOfPossession.formation === baseFormation;
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

      <Fold
        id="strategy"
        className="strategy"
        title={
          <>
            <span className="strategy__title">Racik strategi</span> <span className="strategy__note">berlaku seketika</span>
          </>
        }
        summary={summaryAll}
        defaultOpen
      >

        <Fold
          id="base"
          className="strategy__base"
          title={
            <>
              <span className="step">1</span> Formasi dasar
            </>
          }
          summary={phasesMatchBase ? baseFormation : `${baseFormation} (tanpa bola ${team.tactics.outOfPossession.formation}, dengan bola ${team.tactics.inPossession.formation})`}
          defaultOpen
        >
          <div className="tac-options" role="group" aria-label="Formasi dasar">
            {Object.keys(FORMATIONS).map((f) => (
              <button
                key={f}
                type="button"
                className={baseFormation === f ? 'is-active' : undefined}
                disabled={locked}
                onClick={() => setTactic({ baseFormation: f, inPossession: { formation: f }, outOfPossession: { formation: f } }, `Formasi dasar ${f}`)}
              >
                {f}
              </button>
            ))}
          </div>
          <p className="strategy__hint">
            {phasesMatchBase
              ? 'Dipakai saat dengan bola dan tanpa bola. Ubah per fase di kolom bawah bila perlu; nyalakan "Bayangan" di gambar untuk melihat perpindahan pemain.'
              : `Berbeda per fase: ${team.tactics.outOfPossession.formation} tanpa bola, ${team.tactics.inPossession.formation} dengan bola.`}
          </p>
        </Fold>

        <div className="strategy__phases">
          <Fold
            id="out"
            className="phase phase--out"
            title={
              <>
                <span className="step">2</span> Tanpa bola
              </>
            }
            summary={summaryOut}
            defaultOpen={!narrow}
          >
            <Fold id="out-pos" sub title="Posisi (gambar)" defaultOpen>
            <LayerPitch
              title="Seret pemain untuk mengatur posisi bertahan"
              showLaneNames
              phase="defend"
              players={onPitch}
              tactics={team.tactics}
              color={shirt}
              highlightId={outId}
              locked={locked}
              onSet={(changes, id) => setTactic(changes, `${name(id)}: posisi tanpa bola diubah`)}
              onReset={() => setTactic({ customOut: clearMap() }, 'Tanpa bola: kembali ke formasi')}
            />
            </Fold>
            <Fold id="out-opt" sub title="Pilihan tim" defaultOpen>
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
            <Choice
              label="Lindungi"
              value={team.tactics.outOfPossession.protect ?? 'seimbang'}
              options={Object.keys(PROTECT_OPTIONS)}
              labels={PROTECT_LABEL}
              onPick={(v) => setTactic({ outOfPossession: { protect: v } }, `Lindungi ${PROTECT_LABEL[v]}`)}
              disabled={locked}
              hint="Tengah: blok sempit, lawan dipaksa ke sayap. Sayap: blok lebar, tengah lebih renggang"
            />
            <Choice
              label="Saat kehilangan bola"
              value={team.tactics.onLoss}
              options={ON_LOSS}
              labels={LOSS_LABEL}
              onPick={(v) => setTactic({ onLoss: v }, `Kehilangan bola: ${LOSS_LABEL[v]}`)}
              disabled={locked}
              hint="Counter-press: 2 pemain tambahan menekan ±5 dtk (menguras tenaga). Mundur: langsung ke bentuk bertahan"
            />
            </Fold>
            <Fold id="out-players" sub title="Per pemain" summary={tempelCount ? `${tempelCount} tempel lawan` : 'semua jaga zona'} defaultOpen={!narrow}>
            <PlayerOrders
              title="Penjagaan per pemain"
              players={outfield}
              value={(p) => team.tactics.marking?.[p.id] ?? 'zona'}
              options={MARKING_OPTIONS}
              labels={MARK_LABEL}
              disabled={locked}
              onPick={(p, v) => setTactic({ marking: { [p.id]: v === 'zona' ? null : v } }, `${p.shortName}: ${MARK_LABEL[v]}`)}
            />
            </Fold>
          </Fold>

          <Fold
            id="in"
            className="phase phase--in"
            title={
              <>
                <span className="step">3</span> Dengan bola
              </>
            }
            summary={summaryIn}
            defaultOpen={!narrow}
          >
            <Fold id="in-pos" sub title="Posisi (gambar)" defaultOpen>
            <LayerPitch
              title="Seret pemain untuk mengatur posisi menyerang"
              phase="attack"
              players={onPitch}
              tactics={team.tactics}
              color={shirt}
              highlightId={outId}
              locked={locked}
              showLaneNames
              onSet={(changes, id) => setTactic(changes, `${name(id)}: posisi dengan bola diubah`)}
              onReset={() => setTactic({ customIn: clearMap(), playerLanes: clearMap() }, 'Dengan bola: kembali ke formasi')}
            />
            </Fold>
            <Fold id="in-opt" sub title="Pilihan tim" defaultOpen>
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
            <Choice
              label="Fokus serangan"
              value={team.tactics.inPossession.focus ?? 'seimbang'}
              options={Object.keys(FOCUS_OPTIONS)}
              labels={FOCUS_LABEL}
              onPick={(v) => setTactic({ inPossession: { focus: v } }, `Fokus serangan ${FOCUS_LABEL[v]}`)}
              disabled={locked}
              hint="Kiri/kanan: gelandang & penyerang bergeser ke sisi itu (dilihat dari arah serang tim). Tengah: merapat ke tengah"
            />
            <Choice
              label="Saat merebut bola"
              value={team.tactics.onWin}
              options={ON_WIN}
              labels={WIN_LABEL}
              onPick={(v) => setTactic({ onWin: v }, `Merebut bola: ${WIN_LABEL[v]}`)}
              disabled={locked}
              hint="Serangan balik: langsung ke depan ±5 dtk. Bangun ulang: aman & sabar"
            />
            </Fold>
            <Fold id="in-players" sub title="Per pemain" summary={laneCount ? `${laneCount} instruksi pribadi` : 'semua tetap di jalur'} defaultOpen={!narrow}>
            <PlayerOrders
              title="Jalur per pemain"
              players={outfield}
              value={(p) => (team.tactics.customIn?.[p.id] ? 'diseret' : (team.tactics.playerLanes?.[p.id] ?? 'tetap'))}
              options={team.tactics.customIn && Object.keys(team.tactics.customIn).length ? ['diseret', ...LANE_INSTRUCTIONS] : LANE_INSTRUCTIONS}
              labels={{ ...LANE_LABEL, diseret: 'Posisi diseret' }}
              isAvailable={(p, v) => v !== 'diseret' || Boolean(team.tactics.customIn?.[p.id])}
              disabled={locked}
              onPick={(p, v) => {
                if (v === 'diseret') return; // hanya penanda: posisi diubah lewat gambar
                setTactic({ playerLanes: { [p.id]: v === 'tetap' ? null : v }, customIn: { [p.id]: null } }, `${p.shortName}: ${LANE_LABEL[v]}`);
              }}
            />
            </Fold>
          </Fold>
        </div>

        <Fold
          id="zones"
          className="strategy__zones"
          title={
            <>
              <span className="step">4</span> Detail zona
            </>
          }
          summary={zoneSummary}
          defaultOpen={!narrow}
        >
          <ZoneBoard players={onPitch} tactics={team.tactics} color={shirt} locked={locked} onSetTactics={setTactic} nameOf={name} scriptStats={state.stats.scriptById?.[teamId] ?? {}} />
        </Fold>

        <Fold id="setpieces" className="strategy__setpieces" title="Bola mati" summary={`pojok ${CORNER_LABEL[team.tactics.corner]} · tendangan bebas ${FREE_KICK_LABEL[team.tactics.freeKick]}`} defaultOpen={!narrow}>
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
            {state.stats.corners[teamId].goals} · Filosofi: <strong>{getPhilosophy(team.philosophy).label}</strong> (identitas tim, tidak bisa diubah
            di tengah laga)
          </p>
        </Fold>
        <p className="lane-legend">
          Bulatan bisa diseret: itu titik patokan pemain, bukan rel kaku — pemain tetap bergeser mengikuti bola dan menjaga lawan. Cincin kuning =
          posisi/jalur pribadi · cincin merah putus-putus = tempel lawan · lapangan selalu digambar menyerang ke kanan (jalur kiri di atas). Tanpa
          bola tim merapat ke arah bola, jadi titik di pinggir ditarik ke dalam.
        </p>
      </Fold>

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
