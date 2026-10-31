// Prüft, dass build:single genau eine selbstständige HTML-Datei erzeugt hat
// (keine externen Skripte/Stylesheets außer der optionalen Google-Schrift).
import { readdirSync, readFileSync, statSync } from 'node:fs';

const dir = 'dist-single';
const files = readdirSync(dir);
const fail = (msg) => { console.error('check-single: ' + msg); process.exit(1); };

if (files.length !== 1 || files[0] !== 'index.html') fail(`erwartet nur index.html, gefunden: ${files.join(', ')}`);
const html = readFileSync(`${dir}/index.html`, 'utf8');
if (/<script[^>]*\ssrc=/i.test(html)) fail('externes <script src> gefunden');
const links = [...html.matchAll(/<link[^>]*href="([^"]+)"/gi)].map((m) => m[1]);
const fremd = links.filter((h) => /^https?:/.test(h) && !h.startsWith('https://fonts.g'));
if (fremd.length) fail(`externe Verweise: ${fremd.join(', ')}`);
if (!html.includes('Simulation')) fail('Hinweis „Simulation“ fehlt');
const kb = Math.round(statSync(`${dir}/index.html`).size / 1024);
if (kb > 5 * 1024) fail(`Datei zu groß (${kb} kB)`);
console.log(`check-single: ok (index.html, ${kb} kB)`);
