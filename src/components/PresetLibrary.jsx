import { PRESETS, PRESET_KEYS, PRESET_MEASURED, SIDES, buildPreset, uniqueScriptId, zoneArea, zoneSide } from '../engine/scriptPresets.js';
import { starText } from './Status.jsx';
import { t } from '../i18n.js';

// Pustaka skema (15 Nov, masukan pengguna: membuat skema sendiri memusingkan bagi pemain baru).
// Menampilkan skema siap pakai untuk jenis zona yang sedang dibuka; menambahkannya = skema biasa
// yang tetap bisa diubah di editor.
//
//   zona lawanKiri ──▶ preset area 'lawan' ──▶ buildPreset(kunci, 'kiri', pemain)
//                                               ├─ { script } → [+ sisi ini] [+ kedua sisi]
//                                               └─ { error }  → "butuh: …"

export const MAX_SCRIPTS = 16;
const tk = (s) => s;
const SIDE_LABEL = { kiri: tk('kiri'), kanan: tk('kanan') };

export default function PresetLibrary({ zone, players, scripts, locked, onAdd, onClose, ownResult = null }) {
  const area = zoneArea(zone);
  const side = zoneSide(zone);
  const keys = PRESET_KEYS.filter((k) => PRESETS[k].area === area).sort((a, b) => PRESETS[a].level - PRESETS[b].level || a.localeCompare(b));
  const room = MAX_SCRIPTS - scripts.length;

  function add(key, sides) {
    let list = [...scripts];
    const added = [];
    for (const sd of sides) {
      const r = buildPreset(key, sd, players);
      if (!r.script) continue;
      const id = uniqueScriptId(`pre-${key}-${sd}`, list);
      const script = { ...r.script, id, name: `${t(PRESETS[key].label)} · ${t(SIDE_LABEL[sd])}` };
      list = [...list, script];
      added.push(script);
    }
    if (added.length === 0 || list.length > MAX_SCRIPTS) return;
    onAdd(list, added);
  }

  return (
    <div className="preset-lib">
      <div className="scripts__head">
        <h5>{t('Pustaka skema')} · {area === 'lawan' ? t('daerah lawan') : t('daerah sendiri')}</h5>
        <button type="button" className="lane-reset" onClick={onClose}>
          {t('Tutup')}
        </button>
      </div>
      <p className="tac-note">{t('Skema siap pakai, dipilih menurut peran pemain di formasimu. Setelah ditambahkan, skema bisa diubah seperti skema buatan sendiri. Angka "berhasil" = seberapa sering semua langkah jalan dalam uji kami (bukan peluang gol).')}</p>
      <ul className="preset-list">
        {keys.map((key) => {
          const pr = PRESETS[key];
          const here = buildPreset(key, side, players);
          const otherSide = SIDES.find((s) => s !== side);
          const there = buildPreset(key, otherSide, players);
          const rate = PRESET_MEASURED[key];
          return (
            <li key={key}>
              <div className="preset-row">
                <span className="pot-stars" title={t('Kerumitan')}>
                  {starText(pr.level)}
                </span>
                <b>{t(pr.label)}</b>
                {Number.isFinite(rate) && <span className={`template-meta ${rate < 0.1 ? 'neg' : ''}`}>{t('berhasil ±{p}%', { p: Math.round(rate * 100) })}</span>}
                {(() => {
                  const own = ownResult?.(key);
                  return own && own.started > 0 ? <span className="template-meta">· {t('uji timmu {p}% ({c}/{s})', { p: Math.round((100 * own.completed) / own.started), c: own.completed, s: own.started })}</span> : null;
                })()}
              </div>
              <p className="tac-note">{t(pr.idea)}</p>
              {here.error ? (
                <p className="tac-note neg">
                  {t('Butuh')}: {here.error.map((e) => t(e)).join(', ')}
                </p>
              ) : (
                <div className="script-actions">
                  <button type="button" className="lane-reset" disabled={locked || room < 1} onClick={() => add(key, [side])}>
                    + {t('Sisi ini')} ({t(SIDE_LABEL[side])})
                  </button>
                  <button type="button" className="lane-reset" disabled={locked || room < (there.script ? 2 : 1)} onClick={() => add(key, [side, otherSide])}>
                    + {t('Kedua sisi')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {room < 1 && <p className="tac-note neg">{t('Sudah {n} skema (batas). Hapus satu dulu.', { n: MAX_SCRIPTS })}</p>}
    </div>
  );
}
