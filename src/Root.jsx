import { useState } from 'react';
import App from './App.jsx';
import MainMenu from './components/MainMenu.jsx';
import { readSaves, writeSlot, deleteSlot } from './saves.js';
import { seasonOver, userFixture, simulateToUserMatch } from './engine/league.js';

const atRest = (l) => (seasonOver(l) || userFixture(l) ? l : simulateToUserMatch(l));
import { readLang, setLang, LANGS } from './i18n.js';

// Akar aplikasi (14 Nov): menu utama dulu, lalu layar permainan untuk satu slot karier (atau laga
// persahabatan tanpa slot). Bahasa dipegang di sini supaya berlaku di menu dan di permainan.
export default function Root() {
  const [lang, setLangState] = useState(() => {
    const l = readLang();
    setLang(l);
    return l;
  });
  const [saves, setSaves] = useState(() => readSaves());
  // game = null (menu) | { slot: nomor | null, league: liga | null, key }
  const [game, setGame] = useState(null);

  function chooseLang(l) {
    setLang(l);
    setLangState(l);
  }
  const refresh = () => setSaves(readSaves());

  function start(slot, created) {
    const league = atRest(created);
    writeSlot(slot, league);
    refresh();
    setGame({ slot, league, key: Date.now() });
  }
  function load(slot) {
    const s = readSaves().slots[slot];
    const loaded = s?.league ?? null; // dimuat malas; null = rusak
    if (!loaded) return setSaves({ ...readSaves(), broken: [slot] });
    const league = atRest(loaded);
    writeSlot(slot, league); // jadikan slot terakhir
    refresh();
    setGame({ slot, league, key: Date.now() });
  }
  function remove(slot) {
    deleteSlot(slot);
    refresh();
  }

  if (!game) {
    return (
      <MainMenu
        saves={saves}
        onStart={start}
        onLoad={load}
        onDelete={remove}
        onFriendly={() => setGame({ slot: null, league: null, key: Date.now() })}
        lang={lang}
        onLang={chooseLang}
        langs={LANGS}
      />
    );
  }
  return (
    <App
      key={game.key}
      initialLeague={game.league}
      onSaveLeague={(league) => (game.slot === null ? true : writeSlot(game.slot, league))}
      onExitToMenu={() => {
        refresh();
        setGame(null);
      }}
      lang={lang}
      onChooseLang={chooseLang}
    />
  );
}
