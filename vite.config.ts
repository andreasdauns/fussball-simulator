import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "single"-Modus baut alles in eine einzige HTML-Datei (für Vorschau-Links).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
}));
