import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Bau-Stempel für die Anzeige „Stand …“ in der App, damit Andreas sieht,
 * welche Version er gerade geöffnet hat. Nur Darstellung, nie Engine-Logik.
 */
function buildStamp(): string {
  let sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      sha = '';
    }
  }
  const d = new Date();
  const datum = `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  return sha ? `${datum} · ${sha}` : datum;
}

// "single"-Modus baut alles in eine einzige HTML-Datei (für Vorschau-Links).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  define: {
    __BUILD_STAMP__: JSON.stringify(mode === 'test' ? 'test' : buildStamp()),
  },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
}));
