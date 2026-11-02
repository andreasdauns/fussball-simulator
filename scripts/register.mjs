#!/usr/bin/env node
/**
 * Pflege des Bayern-Spielerstamms (src/data/players/register.json).
 *
 *   node scripts/register.mjs sync            – übernimmt alle Spieler aus src/data/teams/*.json
 *   node scripts/register.mjs check           – Exit 1, wenn der Stamm nicht zu den TeamSheets passt
 *   node scripts/register.mjs import <datei>  – übernimmt Fakten aus einer CSV (Semikolon-getrennt):
 *       name;position;von;bis;spiele;tore;quelle
 *       Oliver Kahn;TW;1994;2008;429;0;de.wikipedia "Liste der Fußballspieler des FC Bayern München" (abgerufen 2026-11-02)
 *     position: TW, LIB, IV, RV, LV, RWB, LWB, DM, ZM, OM, RM, LM, RA, LA, MS, ST (mehrere mit "/").
 *     Leere Felder lassen vorhandene Werte unverändert. Werte ohne Quelle werden abgelehnt.
 *
 * Nur Fakten (Jahre, Einsätze, Tore) mit Quelle – keine Rohdaten aus Spiele-Datenbanken.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// REGISTER_PATH nur für Tests (Arbeitskopie statt der echten Datei)
const REGISTER = process.env.REGISTER_PATH ?? join(ROOT, 'src/data/players/register.json');
const TEAMS = join(ROOT, 'src/data/teams');

const POS = {
  TW: 'GK', LIB: 'SW', LIBERO: 'SW', IV: 'CB', RV: 'RB', LV: 'LB', RWB: 'RWB', LWB: 'LWB', DM: 'DM', ZM: 'CM',
  OM: 'AM', RM: 'RM', LM: 'LM', RA: 'RW', LA: 'LW', HS: 'CF', MS: 'ST', ST: 'ST',
};
const VALID_POS = new Set(Object.values(POS));

function slug(name) {
  return name
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .replace(/ł/gi, 'l')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadRegister() {
  if (!existsSync(REGISTER)) {
    return {
      hinweis:
        'Bayern-Spielerstamm: eine Zeile pro Person. Fakten nur mit Quelle, null = noch nicht erfasst. Gepflegt mit scripts/register.mjs.',
      stand: '',
      players: [],
    };
  }
  return JSON.parse(readFileSync(REGISTER, 'utf8'));
}

function loadTeams() {
  return readdirSync(TEAMS)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(TEAMS, f), 'utf8')));
}

function emptyEntry(p) {
  return {
    id: p.id,
    name: p.name,
    shortName: p.shortName,
    positions: [...p.positions],
    bayernFrom: null,
    bayernTo: null,
    leagueApps: null,
    leagueGoals: null,
    seasons: [],
    status: 'unvollständig',
    sources: [],
  };
}

function firstSeason(e) {
  return e.seasons.length ? e.seasons.map((s) => s.season).sort()[0] : '9999';
}

function sortPlayers(players) {
  players.sort((a, b) => {
    const fa = a.bayernFrom ?? Number(firstSeason(a).slice(0, 4));
    const fb = b.bayernFrom ?? Number(firstSeason(b).slice(0, 4));
    return fa - fb || a.name.localeCompare(b.name, 'de');
  });
}

function updateStatus(e) {
  const complete = e.bayernFrom !== null && e.bayernTo !== null && e.leagueApps !== null && e.sources.length > 0;
  e.status = complete ? 'vollständig' : 'unvollständig';
}

/** Gleicht den Stamm mit den TeamSheets ab (Saisons, Werte, fehlende Spieler). Gibt die Anzahl Änderungen zurück. */
function sync(reg, teams) {
  const before = JSON.stringify(reg.players);
  const byId = new Map(reg.players.map((e) => [e.id, e]));
  for (const e of reg.players) e.seasons = [];
  for (const t of teams) {
    for (const p of t.players) {
      let e = byId.get(p.id);
      if (!e) {
        e = emptyEntry(p);
        byId.set(p.id, e);
        reg.players.push(e);
      }
      for (const pos of p.positions) if (!e.positions.includes(pos)) e.positions.push(pos);
      e.seasons.push({ season: t.season, teamSheet: t.id, overall: p.overall, confidence: p.confidence });
    }
  }
  for (const e of reg.players) {
    e.seasons.sort((a, b) => a.season.localeCompare(b.season));
    updateStatus(e);
  }
  sortPlayers(reg.players);
  return before !== JSON.stringify(reg.players);
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = lines.shift().split(';').map((h) => h.trim().toLowerCase());
  const need = ['name', 'position', 'von', 'bis', 'spiele', 'tore', 'quelle'];
  for (const n of need) if (!head.includes(n)) throw new Error(`Spalte "${n}" fehlt in der CSV`);
  return lines.map((l, i) => {
    const cells = l.split(';').map((c) => c.trim());
    const row = Object.fromEntries(head.map((h, j) => [h, cells[j] ?? '']));
    row.zeile = i + 2;
    return row;
  });
}

function num(v, row, field) {
  if (v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Zeile ${row.zeile}: "${field}" ist keine ganze Zahl: ${v}`);
  return n;
}

function importCsv(reg, file) {
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const byId = new Map(reg.players.map((e) => [e.id, e]));
  const byName = new Map(reg.players.map((e) => [e.name, e]));
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (!row.name) throw new Error(`Zeile ${row.zeile}: Name fehlt`);
    if (!row.quelle) throw new Error(`Zeile ${row.zeile}: Quelle fehlt (${row.name})`);
    const positions = row.position
      ? row.position.split('/').map((p) => {
          const m = POS[p.trim().toUpperCase()] ?? (VALID_POS.has(p.trim()) ? p.trim() : undefined);
          if (!m) throw new Error(`Zeile ${row.zeile}: unbekannte Position "${p}"`);
          return m;
        })
      : [];
    const id = slug(row.name);
    let e = byName.get(row.name) ?? byId.get(id);
    if (!e) {
      if (!positions.length) throw new Error(`Zeile ${row.zeile}: neue Person ohne Position (${row.name})`);
      const last = row.name.split(' ').pop();
      e = emptyEntry({ id, name: row.name, shortName: last, positions });
      reg.players.push(e);
      byId.set(id, e);
      byName.set(row.name, e);
      created++;
    } else {
      updated++;
      for (const pos of positions) if (!e.positions.includes(pos)) e.positions.push(pos);
    }
    const von = num(row.von, row, 'von');
    const bis = num(row.bis, row, 'bis');
    const spiele = num(row.spiele, row, 'spiele');
    const tore = num(row.tore, row, 'tore');
    if (von !== undefined) e.bayernFrom = von;
    if (bis !== undefined) e.bayernTo = bis;
    if (spiele !== undefined) e.leagueApps = spiele;
    if (tore !== undefined) e.leagueGoals = tore;
    if (!e.sources.includes(row.quelle)) e.sources.push(row.quelle);
    updateStatus(e);
  }
  sortPlayers(reg.players);
  return { created, updated };
}

/** Eine Zeile pro Spieler: gut lesbare Diffs auch bei mehreren hundert Einträgen. */
function serialize(reg) {
  const rows = reg.players.map((e) => '    ' + JSON.stringify(e));
  return (
    '{\n' +
    `  "hinweis": ${JSON.stringify(reg.hinweis)},\n` +
    `  "stand": ${JSON.stringify(reg.stand)},\n` +
    '  "players": [\n' +
    rows.join(',\n') +
    '\n  ]\n}\n'
  );
}

function today() {
  // Nur Werkzeug, nicht Teil der Engine – Datum darf hier verwendet werden.
  return new Date().toISOString().slice(0, 10);
}

const [cmd, arg] = process.argv.slice(2);
const reg = loadRegister();
const teams = loadTeams();

if (cmd === 'sync') {
  if (sync(reg, teams) || !existsSync(REGISTER)) reg.stand = today();
  writeFileSync(REGISTER, serialize(reg));
  const done = reg.players.filter((e) => e.status === 'vollständig').length;
  console.log(`Spielerstamm: ${reg.players.length} Personen, davon ${done} vollständig erfasst.`);
} else if (cmd === 'check') {
  const copy = JSON.parse(JSON.stringify(reg));
  if (sync(copy, teams)) {
    console.error('Spielerstamm passt nicht zu den TeamSheets – bitte "node scripts/register.mjs sync" ausführen.');
    process.exit(1);
  }
  console.log('Spielerstamm passt zu den TeamSheets.');
} else if (cmd === 'import' && arg) {
  const { created, updated } = importCsv(reg, arg);
  sync(reg, teams);
  reg.stand = today();
  writeFileSync(REGISTER, serialize(reg));
  console.log(`Import: ${created} neu, ${updated} ergänzt. Gesamt ${reg.players.length}.`);
} else {
  console.log('Aufruf: node scripts/register.mjs sync | check | import <datei.csv>');
  process.exit(2);
}
