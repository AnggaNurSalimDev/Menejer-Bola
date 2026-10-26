// Uji engine tanpa tampilan (prinsip arsitektur no. 5).
// Jalankan: npm run check

import { FORMATIONS, validateFormation } from '../src/engine/formations.js';
import { createDemoTeams } from '../src/engine/teams.js';
import { createMatchState, validateMatchState } from '../src/engine/state.js';
import { createRng } from '../src/engine/rng.js';

let failures = 0;

function check(label, errors) {
  if (errors.length === 0) {
    console.log(`  OK   ${label}`);
  } else {
    failures += 1;
    console.log(`  GAGAL ${label}`);
    for (const e of errors) console.log(`        - ${e}`);
  }
}

console.log('Formasi');
for (const name of Object.keys(FORMATIONS)) check(name, validateFormation(name));

console.log('State awal');
const { home, away } = createDemoTeams(2026);
const state = createMatchState(home, away);
check('22 pemain, invariant lengkap', validateMatchState(state, [home, away]));

console.log('Seed');
const a = createRng(42);
const b = createRng(42);
const sameSequence = Array.from({ length: 50 }, () => a.next() === b.next()).every(Boolean);
check('seed sama menghasilkan urutan sama', sameSequence ? [] : ['urutan berbeda']);

const teamsAgain = createDemoTeams(2026);
const sameTeams = JSON.stringify(teamsAgain) === JSON.stringify({ home, away });
check('tim yang sama dari seed yang sama', sameTeams ? [] : ['tim berbeda']);

if (failures > 0) {
  console.log(`\n${failures} pemeriksaan gagal.`);
  process.exit(1);
}
console.log('\nSemua pemeriksaan lolos.');
