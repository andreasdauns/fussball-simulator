# Spiel ansehen (Vorschau)

Nach jeder Änderung baut GitHub das ganze Spiel automatisch als **eine einzige Datei** (`index.html`). Sie braucht keine Installation und läuft im Browser – auch ohne Internet (dann nur mit einer einfacheren Schrift).

## Am Laptop
1. Im Repository oben auf **Actions** gehen.
2. Den obersten grünen Lauf öffnen (bei einem Pull Request: im PR unten bei den Prüfungen auf **Details**, dann **Summary**).
3. Ganz unten unter **Artifacts** auf **fussball-simulator-vorschau** klicken – es lädt eine ZIP-Datei.
4. ZIP öffnen, `index.html` doppelklicken. Das Spiel öffnet sich im Browser.

Oben links neben dem Titel steht **„Stand …“** mit Datum und einem Kürzel. Daran siehst du, welche Version du gerade anschaust.

## Am Handy
Das geht mit der Datei leider nur umständlich: Die Vorschau in der „Dateien“-App (iPhone) bzw. im Datei-Manager (Android) startet das Spiel oft nicht, weil sie keine Programme in Webseiten ausführt. Für das Handy ist ein richtiger Link nötig – dazu gibt es eine offene Frage an dich im Pull Request (Möglichkeiten siehe unten).

## Möglichkeiten für einen echten Link (Entscheidung von Andreas)
| Weg | Kosten | Wer kann es sehen |
|---|---|---|
| Privater Link über dein Claude-Konto (claude.ai) | kostenlos | nur du, bis du ihn teilst |
| GitHub Pages bei privatem Repository | GitHub Pro, ca. 4 $/Monat | jeder mit dem Link |
| GitHub Pages bei öffentlichem Repository | kostenlos | jeder (auch der Code wird öffentlich) |
| Netlify / Cloudflare Pages (Gratis-Stufe) | kostenlos, eigenes Konto nötig | jeder mit dem Link |

Die Vorschau-Dateien werden 30 Tage aufbewahrt.

## Für Entwickler
- `npm run build:single` → `dist-single/index.html`
- `npm run check:single [-- bild.png]` → öffnet die Datei im Headless-Browser (Laptop- und Handy-Größe), prüft auf Fehler, Hinweis „Simulation“, Spielfeld und Mannschaftsauswahl; braucht Playwright.
