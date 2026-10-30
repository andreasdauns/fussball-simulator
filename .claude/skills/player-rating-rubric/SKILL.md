---
name: player-rating-rubric
description: Use whenever creating, changing or checking player ratings (overall or attributes) for any team or player in src/data/, or when turning collected signals (kicker-Rangliste, FIFA/CM/FM/PES values, stats) into the app's own 1–99 values.
---

# Bewertungsrubrik für Spielerwerte

Ziel: konsistente, epochenübergreifend vergleichbare Werte auf eigener Skala 1–99. Jeder Wert beschreibt, wie gut ein Spieler **im Vergleich zu seinen Zeitgenossen** war (Bundesliga/europäische Spitze derselben Jahre), in **seiner Saison**, die im TeamSheet abgebildet ist.

## Grundsätze
1. **Niveau** kommt aus der kicker-Rangliste (und Rolle im Team), **Profil** (Stärken/Schwächen) aus Spiele-Datenbanken und Faktenbeschreibungen.
2. Nie Werte aus dem Gedächtnis „erinnern“. Immer von gesammelten Signalen mit Quelle ausgehen (`/home/claude/fussball-data/` bzw. `src/data/players/signals/`). Fehlt ein Signal: Faktenblatt (Position, Einsätze, Tore, Länderspiele, Auszeichnungen, Spielweise laut Quelle) und Schätzung mit Vertrauensstufe `geschätzt`.
3. Rohdaten fremder Datenbanken nie ins Repo – nur die eigenen Ergebniswerte plus Quellenvermerk.

## Schritt 1 – Gesamtniveau (overall)
kicker-Einstufung der betreffenden Halbjahre (Mittel der beiden Halbjahre der Saison, bessere zählt doppelt):

| Einstufung | overall |
|---|---|
| Weltklasse, Positionsrang 1 | 92–95 |
| Weltklasse | 89–92 |
| Internationale Klasse | 84–88 |
| Im weiteren Kreis / Nationale Klasse | 79–83 |
| Blickfeld | 75–79 |
| Bayern-Stammspieler ohne Einstufung | 72–77 |
| Rotationsspieler | 66–72 |
| Ergänzungs-/Nachwuchsspieler | 58–66 |

Ausländische Spieler sind in der Rangliste enthalten, sofern sie in der Bundesliga spielten. Zusätzliche Korrekturen (je max. ±2): internationale Auszeichnungen in der Saison (Ballon-d'Or-Top-10, UEFA-Team des Jahres, Fußballer des Jahres) nach oben; viele Verletzungsausfälle nicht nach unten (Wert = Leistungsfähigkeit, nicht Verfügbarkeit).

Fehlt die Rangliste (z. B. ab 2017 lückenhaft, oder vor 1956): Leistungsdaten (Einsätze/Minuten-Anteil, kicker-Notenschnitt: 2,0 ≈ 88, 2,5 ≈ 84, 3,0 ≈ 79, 3,5 ≈ 74), Nationalmannschaftsstatus, Marktwert-Rang im Kader (ab 2004) und Spielewerte (FIFA-Gesamt-Perzentil in der Bundesliga dieser Ausgabe) kombinieren.

## Schritt 2 – Profil aus Spielequellen
Für jede verfügbare Quelle (FIFA-Ausgabe der Saison, CM/FM-Datenbank der Saison, PES-Stats-DB-Eintrag des Karriereabschnitts):
1. Attribut der Quelle in **Perzentil** umrechnen – innerhalb derselben Quelle/Ausgabe und derselben Positionsgruppe (TW, IV, AV, ZM, OM/Flügel, ST), möglichst unter Bundesliga- bzw. Top-Liga-Spielern.
2. Zuordnung der Attribute:

| eigenes Attribut | FIFA | CM/FM (1–20) | PES |
|---|---|---|---|
| pace | sprint_speed | Pace | Top Speed |
| acceleration | acceleration | Acceleration | Acceleration |
| stamina | stamina | Stamina | Stamina |
| strength | strength | Strength | Body Balance / Physical Contact |
| firstTouch | ball_control | Technique / First Touch | Dribble Accuracy |
| dribbling | dribbling | Dribbling | Dribble Speed/Accuracy |
| shortPassing | short_passing | Passing | Short Pass Accuracy |
| longPassing | long_passing | Passing (+Vision) | Long Pass Accuracy |
| crossing | crossing | Crossing | Long Pass Accuracy (Flügel) |
| finishing | finishing | Shooting / Finishing | Shot Accuracy |
| longShots | long_shots | Long Shots | Shot Power/Technique |
| heading | heading_accuracy | Heading | Heading |
| tackling | standing_tackle | Tackling | Defence |
| marking | defensive_awareness / marking | Marking / Positioning | Defence |
| positioning | positioning | Off the Ball / Positioning | Attack |
| vision | vision | Creativity / Vision | Response / Technique |
| composure | composure | Composure / Big Matches | Mentality |
| workRate | work_rate, aggression | Work Rate / Teamwork | Teamwork |
| gkReflexes | gk_reflexes | Reflexes | Goalkeeping |
| gkHandling | gk_handling | Handling | Goalkeeping |
| gkPositioning | gk_positioning | Positioning / One on Ones | Goalkeeping |
| gkDistribution | gk_kicking | Kicking / Throwing | Long Pass |

3. Mehrere Quellen: Perzentile mitteln; Abweichung > 30 Perzentilpunkte markieren und in `notes` begründen.

## Schritt 3 – Werte bilden
`attribut = overall + (perzentil − 50) × 0,32`, dann auf 1–99 begrenzen. Positionsfremde Attribute dürfen deutlich unter overall liegen (Torwart: Feldspieler-Attribute 20–50; Feldspieler: Torwartattribute 5–15).
Danach prüfen: Der positionsgewichtete Mittelwert der relevanten Attribute (Gewichte in `src/engine/ratings.ts`, falls vorhanden) muss ±2 um overall liegen; sonst Profil-Werte gleichmäßig verschieben.

Ohne Spielequelle: Profil aus Faktenbeschreibung („schnell“, „kopfballstark“, „Standardspezialist“) – drei unabhängige Schätzdurchläufe, Median, `confidence: "geschätzt"`.

## Schritt 4 – Plausibilität
- EA-Icons/Legenden-Werte (falls vorhanden) als grobe Anker für die Spitze: große Abweichungen in der Reihenfolge der Legenden prüfen.
- Innerhalb einer Mannschaft muss die Hackordnung zur Rolle passen (Stammspieler > Bankspieler, außer begründet).
- Reproduzierbarkeit: Werte und Herleitung in `src/data/players/<id>.json` bzw. im TeamSheet mit `sources` und `confidence` dokumentieren.

## Epochenmodus
Standard ist **Fair-Modus**: alle Epochen gleichwertig (Werte relativ zur Zeit). Ein späterer **Realismus-Modus** zieht für frühere Epochen Tempo/Antritt/Ausdauer ab – das passiert zur Laufzeit in der Engine, nie in den gespeicherten Werten.
