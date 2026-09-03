# LifeCheck

Mobile-first Life-Dashboard für Habits, Wochenziele und ein selbst definiertes Belohnungssystem.

## Enthalten

- Zwei-Spalten-Startseite mit fixer Kachelhöhe
- Tagesnavigation mit nachträglichem Bearbeiten
- Statuslogik Grau → Grün → Rot
- Zeit-Habits mit eigener Zeiteingabe
- Harte Wochenziele ohne gelbe Zwischenstufen
- Fester Rhythmus mit Ankertag und Zeitfenster, ohne Terminverschiebung
- Versionshistorie für Habit-Änderungen
- Kalender mit Wochenbewertungen
- Individuelle Abwertungsfaktoren pro Habit
- Monats-Maximum → Wochen-Maximum (auf 5 € abgerundet)
- Virtuelles Belohnungskonto + echte Überweisungen eintragen
- JSON-Backup/Import
- PWA-Grundsetup für Installation auf dem Homescreen
- Speicherung lokal im Browser via `localStorage`

## Lokal starten

Einfach `index.html` öffnen. Für Service Worker/PWA besser einen kleinen lokalen Webserver nutzen, z. B.:

```bash
python -m http.server 8000
```

Dann `http://localhost:8000` öffnen.

## GitHub Pages

1. Neues GitHub-Repository erstellen, z. B. `lifecheck`.
2. Alle Dateien aus diesem Ordner in das Repository kopieren.
3. Committen und auf den Branch `main` pushen.
4. Auf GitHub: **Settings → Pages**.
5. Unter **Build and deployment** bei **Source**: `Deploy from a branch` wählen.
6. Branch `main` und Ordner `/(root)` auswählen und speichern.
7. GitHub zeigt danach die veröffentlichte Pages-Adresse an.

Wichtig: Die App-Daten liegen lokal im Browser des Geräts und werden nicht über GitHub synchronisiert. Für mehrere Geräte sollte später ein Backend wie Supabase ergänzt werden.
