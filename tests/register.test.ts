import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Position, TeamSheet } from '../src/engine/types';
import { findRegisterEntry, playerRegister, playersForPosition } from '../src/data/players/register';
import bayern2001 from '../src/data/teams/bayern-2001.json';
import bayern2020 from '../src/data/teams/bayern-2020.json';

const teams = [bayern2001 as TeamSheet, bayern2020 as TeamSheet];
const POSITIONS: Position[] = ['GK', 'SW', 'CB', 'RB', 'LB', 'RWB', 'LWB', 'DM', 'CM', 'AM', 'RM', 'LM', 'RW', 'LW', 'CF', 'ST'];
const ROOT = join(__dirname, '..');

describe('Spielerstamm', () => {
  const players = playerRegister.players;

  it('hat eindeutige IDs im Slug-Format', () => {
    expect(new Set(players.map((e) => e.id)).size).toBe(players.length);
    for (const e of players) expect(e.id, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('enthält jeden Spieler aller TeamSheets mit passender Saison und gleichem Gesamtwert', () => {
    for (const t of teams) {
      for (const p of t.players) {
        const e = findRegisterEntry(p.id);
        expect(e, `${t.id}: ${p.id}`).toBeDefined();
        const s = e!.seasons.find((x) => x.teamSheet === t.id);
        expect(s, `${p.id} in ${t.id}`).toBeDefined();
        expect(s!.season).toBe(t.season);
        expect(s!.overall).toBe(p.overall);
        expect(e!.name).toBe(p.name);
        for (const pos of p.positions) expect(e!.positions).toContain(pos);
      }
    }
  });

  it('hat nur gültige Positionen und plausible Fakten', () => {
    for (const e of players) {
      expect(e.positions.length, e.id).toBeGreaterThan(0);
      for (const pos of e.positions) expect(POSITIONS, e.id).toContain(pos);
      if (e.bayernFrom !== null) expect(e.bayernFrom, e.id).toBeGreaterThanOrEqual(1945);
      if (e.bayernTo !== null) expect(e.bayernTo, e.id).toBeLessThanOrEqual(2030);
      if (e.bayernFrom !== null && e.bayernTo !== null) expect(e.bayernFrom, e.id).toBeLessThanOrEqual(e.bayernTo);
      if (e.leagueApps !== null) expect(e.leagueApps, e.id).toBeGreaterThanOrEqual(0);
      if (e.leagueGoals !== null && e.leagueApps !== null) {
        expect(e.leagueGoals, e.id).toBeLessThanOrEqual(e.leagueApps * 3);
      }
    }
  });

  it('markiert nur Einträge mit Jahren, Einsätzen und Quelle als vollständig', () => {
    for (const e of players) {
      const complete = e.bayernFrom !== null && e.bayernTo !== null && e.leagueApps !== null && e.sources.length > 0;
      expect(e.status, e.id).toBe(complete ? 'vollständig' : 'unvollständig');
    }
  });

  it('findet Spieler nach Position', () => {
    expect(playersForPosition('GK').map((e) => e.id)).toContain('oliver-kahn');
  });

  it('ist mit den TeamSheets abgeglichen (scripts/register.mjs check)', () => {
    expect(() => execFileSync('node', [join(ROOT, 'scripts/register.mjs'), 'check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('CSV-Import (scripts/register.mjs import)', () => {
  it('ergänzt Fakten, legt neue Personen an und lehnt Zeilen ohne Quelle ab', () => {
    // Das Skript arbeitet auf einer Kopie (REGISTER_PATH), die echte Datei bleibt unberührt.
    const dir = mkdtempSync(join(tmpdir(), 'reg-'));
    const regPath = join(dir, 'register.json');
    copyFileSync(join(ROOT, 'src/data/players/register.json'), regPath);
    const env = { ...process.env, REGISTER_PATH: regPath };
    try {
      const csv = join(dir, 'test.csv');
      writeFileSync(
        csv,
        'name;position;von;bis;spiele;tore;quelle\n' +
          'Oliver Kahn;TW;1994;2008;400;0;Testquelle\n' +
          'Erika Musterfrau;ZM/OM;1960;1965;;;Testquelle\n',
      );
      execFileSync('node', [join(ROOT, 'scripts/register.mjs'), 'import', csv], { stdio: 'pipe', env });
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const kahn = reg.players.find((e: { id: string }) => e.id === 'oliver-kahn');
      expect(kahn.bayernFrom).toBe(1994);
      expect(kahn.status).toBe('vollständig');
      expect(kahn.seasons.length).toBeGreaterThan(0);
      const neu = reg.players.find((e: { id: string }) => e.id === 'erika-musterfrau');
      expect(neu.positions).toEqual(['CM', 'AM']);
      expect(neu.status).toBe('unvollständig');
      // nach Jahr sortiert: 1960 vor 1994
      expect(reg.players.indexOf(neu)).toBeLessThan(reg.players.indexOf(kahn));

      writeFileSync(csv, 'name;position;von;bis;spiele;tore;quelle\nOhne Quelle;ST;1970;1971;3;1;\n');
      expect(() => execFileSync('node', [join(ROOT, 'scripts/register.mjs'), 'import', csv], { stdio: 'pipe', env })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
