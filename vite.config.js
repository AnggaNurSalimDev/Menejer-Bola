import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Rekaman suara (src/audio/samples) disisipkan sebagai data URI supaya game tetap satu berkas HTML
  // (artifact & itch). Batas 4 MB per berkas.
  build: { assetsInlineLimit: 4 * 1024 * 1024 },
});
