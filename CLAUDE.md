# Fußball-Simulator – Arbeitsregeln für Claude

Private Web-App: historische FC-Bayern-Mannschaften (1950–heute) spielen gegeneinander, als animiertes Spiel im TV-Look (Ziel: 3D mit Three.js). Produktchef und Tester ist Andreas (kein Programmierer). Er liest nur Kurzfassungen auf Deutsch.

## Befehle
- `npm ci` – Abhängigkeiten installieren
- `npm run typecheck` – Typprüfung (muss grün sein)
- `npm test` – alle Tests inkl. Determinismus und Kalibrierung (muss grün sein)
- `npm run build` – Produktions-Build
- `npm run build:single` – Build als eine einzige HTML-Datei (Vorschau-Link)

## Aufbau
- `src/engine/` – Simulations-Engine (reine Logik, kein DOM). Entscheidet alles, was im Spiel passiert.
- `src/data/teams/` – Mannschaftsdateien (`TeamSheet`, JSON) mit eigenen Spielerwerten.
- `src/data/players/` – Spielerstamm und Signale (nur eigene, abgeleitete Werte).
- `src/viewer2d/` – 2D-Testansicht (Canvas), Positions-Synthese aus Ereignissen.
- `src/viewer3d/` – 3D-TV-Ansicht (Three.js), kommt in Phase 2.
- `tests/` – Vitest-Tests.
- Typen in `src/engine/types.ts` sind der Vertrag zwischen Engine, Daten und Darstellung.

## Feste Regeln
1. Engine ist deterministisch: nur `createRng(seed)` aus `src/engine/rng.ts`, nie `Math.random`, keine `Date`-Abhängigkeit, keine `Math.sin/cos/exp/pow` in Entscheidungslogik (Darstellung darf sie nutzen). Gleicher Seed + gleiche Teams + gleiche Engine-Version = exakt gleiches Spiel.
2. Engine entscheidet, Darstellung animiert. Die Darstellung darf nie das Ergebnis beeinflussen.
3. Jede Änderung an der Engine: `npm test` inkl. Kalibrierung (Tore, Schüsse, Karten, Favoritensiege im Zielkorridor). Bei Änderung des Verhaltens `ENGINE_VERSION` erhöhen.
4. Keine Vereinswappen/Logos, keine echten Gesichter, keine Stimmen realer Personen. Trikotfarben ja. Hinweis „Simulation“ sichtbar.
5. Rohdaten aus Spiele-Datenbanken (FIFA, CM/FM, PES) nie ins Repository. Nur eigene, abgeleitete Werte mit Quellenvermerk.
6. Kleine Schritte: pro Lauf eine Aufgabe aus `features.json`, mit Tests, als eigener Branch/PR mit deutscher Kurzbeschreibung für Andreas.
7. `PROGRESS.md` (technisches Protokoll) und `CHANGELOG.md` (für Andreas, ein bis drei Sätze, was er Neues sehen kann) nach jedem Lauf aktualisieren.
8. `FEEDBACK.md` enthält Andreas' Rückmeldungen – die haben Vorrang vor neuen Funktionen.
9. Bei Unsicherheit über Andreas' Wünsche: nicht raten, Frage in den PR schreiben und eine vertretbare Annahme dokumentieren.
10. Keine Kosten verursachen: keine kostenpflichtigen Dienste oder APIs ohne Andreas' Zustimmung.
