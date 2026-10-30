---
name: match-engine-conventions
description: Use whenever changing anything in src/engine/ (simulation logic, tactics, ratings weights, events) or tests/calibration.test.ts.
---

# Konventionen für die Simulations-Engine

## Determinismus (nicht verhandelbar)
- Zufall nur über `createRng(seed)` aus `src/engine/rng.ts`; neue Teilbereiche bekommen einen eigenen Strom via `rng.fork('name')`, damit neue Features nicht alle bestehenden Spiele verändern.
- Verboten in Entscheidungslogik: `Math.random`, `Date`, `performance.now`, `Math.sin/cos/tan/atan2/exp/log/pow`. Erlaubt: + − × ÷, `Math.sqrt`, `Math.abs/min/max/floor/round`. Logistik/Exponential über die vorhandenen Näherungen in der Engine.
- Iteration nur über Arrays in fester Reihenfolge; keine Abhängigkeit von Objekt-Schlüsselreihenfolge aus externen Daten.
- Verhalten geändert → `ENGINE_VERSION` erhöhen (gespeicherte Spiele verweisen auf die Version).

## Architektur
- Engine entscheidet, was passiert (Ereignisse mit Ballpositionen). Die Darstellung erzeugt Spielerbewegungen nur daraus und darf das Ergebnis nie beeinflussen.
- Ereignisse sind lückenlos verkettet: `from` eines Ereignisses = `to` des vorigen, außer bei Spielfortsetzungen.
- Taktik wirkt über `Tactic`-Parameter und Rollen (`Role`), nicht über Mannschafts-Sonderfälle. Keine `if (team.id === 'bayern-2001')`.

## Kalibrierung
- `npm run calibrate` muss grün sein. Zielkorridore stehen in `tests/calibration.test.ts` (Tore/Spiel, Schüsse, Karten, Ecken, Passquote, Favoritensiege 65–85 %).
- Bei jeder Änderung die gemessenen Werte in `PROGRESS.md` notieren (vorher/nachher).
- Epochen-Unterschiede (Kartenhäufigkeit, Wechselzahl, Rückpassregel vor 1992) laufen über `era` im TeamSheet.

## Tests
- Jede neue Regel bekommt einen Test, der sie isoliert prüft (z. B. „hohe Abwehrlinie → mehr Abseits des Gegners“).
- Golden-Master: `tests/fixtures` enthält feste Seeds; bewusste Änderungen aktualisieren die Erwartung zusammen mit `ENGINE_VERSION`.
