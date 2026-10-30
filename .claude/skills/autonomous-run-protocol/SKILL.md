---
name: autonomous-run-protocol
description: Use at the start of every scheduled or unattended run on this repository, and whenever deciding what to work on next.
---

# Ablauf eines selbstständigen Laufs

1. **Lesen:** `FEEDBACK.md` (Andreas' Rückmeldungen, haben Vorrang), dann `features.json`, die letzten Einträge in `PROGRESS.md`, offene PRs (`gh pr list`).
2. **Auswählen:** genau **eine** Aufgabe: zuerst offenes Feedback, sonst das erste Feature in `features.json` mit `"status": "todo"`, dessen Abhängigkeiten erledigt sind. Nicht an etwas arbeiten, das schon ein offener PR abdeckt.
3. **Umsetzen:** auf einem neuen Branch `claude/<kurzname>`. Kleine, nachvollziehbare Commits.
4. **Prüfen:** `npm run typecheck`, `npm test`, `npm run build`. Bei Darstellungsänderungen zusätzlich `npm run build:single` und die Seite per Skript/Headless-Browser rendern, falls möglich. Nichts als erledigt markieren, was nicht geprüft ist.
5. **Dokumentieren:** in `features.json` den Status setzen (`done` nur bei bestandenen Abnahmekriterien), `PROGRESS.md` (technisch) und `CHANGELOG.md` (für Andreas: 1–3 Sätze, was er Neues sehen kann, ohne Fachbegriffe) ergänzen.
6. **Vorschlagen:** PR öffnen mit deutscher Kurzbeschreibung oben („Was ist neu“, „Worauf du achten kannst“), Fragen an Andreas als Liste am Ende.
7. **Stoppen**, wenn: Tests nach zwei ernsthaften Versuchen rot bleiben (dann Entwurf-PR mit Problembeschreibung), eine Entscheidung Andreas betrifft (Geld, rechtliche Fragen, Stil-/Produktfragen), oder Daten/Werte unsicher sind.

Nie: auf `main` direkt pushen, Kosten verursachen, Rohdaten fremder Datenbanken einchecken, Vereinswappen/Fotos einbinden, Geheimnisse in Code schreiben.
