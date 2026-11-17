import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Versi game untuk log rekaman: versi package.json + hash commit pendek (bila git tersedia).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  commit = '';
}

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(commit ? `${pkg.version}+${commit}` : pkg.version) },
  // Rekaman suara (src/audio/samples) disisipkan sebagai data URI supaya game tetap satu berkas HTML
  // (artifact & itch). Batas 4 MB per berkas.
  build: { assetsInlineLimit: 4 * 1024 * 1024 },
});
