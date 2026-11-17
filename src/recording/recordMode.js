// Mode rekam (17 Nov): aktif lewat ?rekam=1 di alamat ATAU toggle di pengaturan (⚙️). Pemain biasa
// tidak melihat apa pun. Toggle disimpan di localStorage; ?rekam=1 tidak mengubah toggle.

const KEY = 'menejer-bola:rekam:v1';
const listeners = new Set();

function fromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('rekam') === '1';
  } catch {
    return false;
  }
}
function fromToggle() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export const recordViaUrl = () => (typeof window !== 'undefined' ? fromUrl() : false);
export const recordToggle = () => (typeof window !== 'undefined' ? fromToggle() : false);
export const isRecordMode = () => recordViaUrl() || recordToggle();

export function setRecordToggle(on) {
  try {
    if (on) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* penyimpanan tidak tersedia: hanya ?rekam=1 yang berlaku */
  }
  listeners.forEach((fn) => fn(isRecordMode()));
}

export function subscribeRecordMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
