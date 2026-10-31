/**
 * Prüft die Einzeldatei-Vorschau (dist-single/index.html) im Headless-Browser:
 * öffnet sie direkt als Datei (wie nach dem Herunterladen), wartet, bis das
 * Spiel läuft, und meldet Fehler. Optional: Screenshot-Pfad als 1. Argument.
 *
 * Aufruf: npm run build:single && npm run check:single [-- bild.png]
 * Braucht Playwright mit Chromium (nicht Teil der Projekt-Abhängigkeiten).
 */
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright nicht gefunden – Prüfung übersprungen.');
  process.exit(2);
}

const file = path.resolve(__dirname, '..', 'dist-single', 'index.html');
if (!fs.existsSync(file)) {
  console.error('dist-single/index.html fehlt – zuerst `npm run build:single`.');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const vp of [
    { name: 'Laptop', width: 1366, height: 820 },
    { name: 'Handy', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      // Schrift aus dem Netz darf offline fehlen.
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/ERR_/.test(m.text())) errors.push(m.text());
    });
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(4000);
    const text = await page.evaluate(() => document.body.innerText);
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? { w: c.width, h: c.height } : null;
    });
    const teams = await page.evaluate(() => Array.from(document.querySelectorAll('select option')).map((o) => o.textContent));
    const report = {
      ansicht: vp.name,
      fehler: errors,
      hinweisSimulation: text.includes('Simulation'),
      stand: (text.match(/Stand [^\n]+/) || [null])[0],
      spielfeld: canvas,
      mannschaften: [...new Set(teams)].length,
    };
    console.log(JSON.stringify(report));
    if (errors.length) problems.push(`${vp.name}: ${errors.length} Fehler`);
    if (!report.hinweisSimulation) problems.push(`${vp.name}: Hinweis „Simulation“ fehlt`);
    if (!canvas || canvas.w < 100) problems.push(`${vp.name}: Spielfeld fehlt`);
    if (report.mannschaften < 2) problems.push(`${vp.name}: keine Mannschaftsauswahl`);
    const shot = process.argv[2];
    if (shot) await page.screenshot({ path: shot.replace(/\.png$/, `-${vp.name.toLowerCase()}.png`) });
    await ctx.close();
  }
  await browser.close();
  if (problems.length) {
    console.error('PROBLEME:\n- ' + problems.join('\n- '));
    process.exit(1);
  }
  console.log('Vorschau-Datei in Ordnung.');
})();
